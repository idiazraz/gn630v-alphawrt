/*
 * fxs: baresip module that makes the TEL port (an FXS line on the
 * airoha_voip driver, /dev/en75xx-fxsN) a plain home phone.
 *
 * - Audio: the line is baresip's audio source and player ("fxs,0"),
 *   s16 8 kHz mono, 80-sample (10 ms) frames.
 * - Lift the handset: dial tone. Digits are detected in software from
 *   the line audio (the SLIC has no DTMF receiver), then dialled 4 s
 *   after the last digit or on '#'. During a call they go out as RFC 2833.
 * - Incoming call: the phone rings (Malaysian double ring); lifting it answers. Hanging up ends
 *   the call. A call that ends while the handset is up gives busy tone.
 *
 * One I/O thread polls the line: line events and dialled digits go to
 * the main thread through an mqueue; captured audio goes to the audio
 * source while a call runs. The player has its own thread, paced by
 * the driver (poll for room, then write).
 *
 * Limit: no echo canceller and no tone fallback for SLICs without
 * oscillators (EN75XX_VOICE_CAP_TONE); in-band digits also stay in the
 * call audio next to RFC 2833.
 *
 * This is free software, licensed under the GNU General Public License v2.
 */
#include <fcntl.h>
#include <poll.h>
#include <unistd.h>
#include <string.h>
#include <sys/ioctl.h>
#include <re_atomic.h>
#include <re.h>
#include <rem.h>
#include <baresip.h>
#include "en75xx_voice.h"

enum { EV_LINE, EV_DIGIT };
enum { SRATE = 8000, FRAME = EN75XX_VOICE_FRAME_SAMPLES, DIAL_WAIT = 4000 };

/* Malaysia (MCMC): 425 Hz for dial, busy and ringback */
static const struct en75xx_voice_tone TONE_DIAL = { 425, 0, -10, 0, 0, 0 };
static const struct en75xx_voice_tone TONE_BUSY = { 425, 0, -10, 500, 500, 0 };
static const struct en75xx_voice_tone TONE_RINGBACK = { 425, 0, -12, 1000, 3000, 0 };
static const struct en75xx_voice_tone TONE_OFF = { 0 };

struct ausrc_st {
	struct ausrc_prm prm;
	ausrc_read_h *rh;
	void *arg;
	int16_t *buf;
	size_t sampc, n;
};

struct auplay_st {
	thrd_t thread;
	RE_ATOMIC bool run;
	struct auplay_prm prm;
	auplay_write_h *wh;
	void *arg;
	int16_t *buf;
	size_t sampc;
};

static struct {
	int fd;
	char dev[64];
	thrd_t thread;
	RE_ATOMIC bool run;
	mtx_t *lock;              /* guards src */
	struct ausrc_st *src;
	struct dtmf_dec *dtmf;
	struct mqueue *mq;
	struct tmr tmr_dial, tmr_rel, tmr_ring;
	bool offhook;
	char digits[32];
	size_t ndigits;
	struct ausrc *ausrc;
	struct auplay *auplay;
} fxs = { .fd = -1 };

static struct ua *line_ua(void)
{
	struct le *le = list_head(uag_list());
	return le ? le->data : NULL;
}

static void tone(const struct en75xx_voice_tone *t)
{
	if (ioctl(fxs.fd, EN75XX_VOICE_SET_TONE, t) < 0 && t->freq1_hz)
		debug("fxs: tone %u Hz: %m\n", t->freq1_hz, errno);
}

static void ring_set(bool on)
{
	struct en75xx_voice_ring r = { on, 400, 200, 0 };
	if (ioctl(fxs.fd, EN75XX_VOICE_SET_RING, &r) < 0)
		warning("fxs: ring: %m\n", errno);
}

/*
 * Malaysian double ring: 0.4 s on, 0.2 off, 0.4 on, 2 s off. The driver
 * takes one on/off pair, so it rings 400/200 for 1 s, then a timer stops
 * it for 2 s.
 */
static void ring_burst(void *arg);

static void ring_pause(void *arg)
{
	(void)arg;
	ring_set(false);
	tmr_start(&fxs.tmr_ring, 2000, ring_burst, NULL);
}

static void ring_burst(void *arg)
{
	(void)arg;
	ring_set(true);
	tmr_start(&fxs.tmr_ring, 1000, ring_pause, NULL);
}

static void ring(bool on)
{
	if (on) {
		ring_burst(NULL);
		return;
	}
	tmr_cancel(&fxs.tmr_ring);
	ring_set(false);
}

/* --- audio source and player --- */

static void src_destructor(void *arg)
{
	struct ausrc_st *st = arg;
	mtx_lock(fxs.lock);
	if (fxs.src == st)
		fxs.src = NULL;
	mtx_unlock(fxs.lock);
	mem_deref(st->buf);
}

static int src_alloc(struct ausrc_st **stp, const struct ausrc *as, struct ausrc_prm *prm,
		     const char *device, ausrc_read_h *rh, ausrc_error_h *errh, void *arg)
{
	struct ausrc_st *st;
	(void)as; (void)device; (void)errh;

	if (!stp || !prm || !rh)
		return EINVAL;
	if (prm->fmt != AUFMT_S16LE || prm->srate != SRATE || prm->ch != 1) {
		warning("fxs: source needs s16le 8000 Hz mono\n");
		return ENOTSUP;
	}
	st = mem_zalloc(sizeof(*st), src_destructor);
	if (!st)
		return ENOMEM;
	st->prm = *prm;
	st->rh = rh;
	st->arg = arg;
	st->sampc = prm->srate * prm->ptime / 1000;
	st->buf = mem_alloc(st->sampc * sizeof(int16_t), NULL);
	if (!st->buf) {
		mem_deref(st);
		return ENOMEM;
	}
	mtx_lock(fxs.lock);
	fxs.src = st;
	mtx_unlock(fxs.lock);
	*stp = st;
	return 0;
}

static int play_thread(void *arg)
{
	struct auplay_st *st = arg;
	struct auframe af;

	auframe_init(&af, AUFMT_S16LE, st->buf, st->sampc, SRATE, 1);
	while (re_atomic_rlx(&st->run)) {
		st->wh(&af, st->arg);
		for (size_t off = 0; off < st->sampc && re_atomic_rlx(&st->run); off += FRAME) {
			struct pollfd p = { fxs.fd, POLLOUT, 0 };
			if (poll(&p, 1, 100) <= 0)
				continue;
			if (write(fxs.fd, st->buf + off, FRAME * sizeof(int16_t)) < 0 && errno != EAGAIN)
				warning("fxs: write: %m\n", errno);
		}
	}
	return 0;
}

static void play_destructor(void *arg)
{
	struct auplay_st *st = arg;
	if (re_atomic_rlx(&st->run)) {
		re_atomic_rlx_set(&st->run, false);
		thrd_join(st->thread, NULL);
	}
	mem_deref(st->buf);
}

static int play_alloc(struct auplay_st **stp, const struct auplay *ap, struct auplay_prm *prm,
		      const char *device, auplay_write_h *wh, void *arg)
{
	struct auplay_st *st;
	int err;
	(void)ap; (void)device;

	if (!stp || !prm || !wh)
		return EINVAL;
	if (prm->fmt != AUFMT_S16LE || prm->srate != SRATE || prm->ch != 1) {
		warning("fxs: player needs s16le 8000 Hz mono\n");
		return ENOTSUP;
	}
	st = mem_zalloc(sizeof(*st), play_destructor);
	if (!st)
		return ENOMEM;
	st->prm = *prm;
	st->wh = wh;
	st->arg = arg;
	/* whole 10 ms frames, as the driver takes them */
	st->sampc = (prm->srate * prm->ptime / 1000 + FRAME - 1) / FRAME * FRAME;
	st->buf = mem_zalloc(st->sampc * sizeof(int16_t), NULL);
	if (!st->buf) {
		mem_deref(st);
		return ENOMEM;
	}
	re_atomic_rlx_set(&st->run, true);
	err = thrd_create(&st->thread, play_thread, st);
	if (err) {
		re_atomic_rlx_set(&st->run, false);
		mem_deref(st);
		return err;
	}
	*stp = st;
	return 0;
}

/* --- line I/O thread --- */

static void on_digit(char digit, void *arg)
{
	(void)arg;
	mqueue_push(fxs.mq, EV_DIGIT, (void *)(intptr_t)digit);
}

static int io_thread(void *arg)
{
	int16_t frame[FRAME];
	(void)arg;

	while (re_atomic_rlx(&fxs.run)) {
		struct pollfd p = { fxs.fd, POLLIN | POLLPRI, 0 };
		if (poll(&p, 1, 100) <= 0)
			continue;
		if (p.revents & POLLPRI)
			mqueue_push(fxs.mq, EV_LINE, NULL);
		if (!(p.revents & POLLIN) || read(fxs.fd, frame, sizeof(frame)) != sizeof(frame))
			continue;

		dtmf_dec_probe(fxs.dtmf, frame, FRAME);

		mtx_lock(fxs.lock);
		struct ausrc_st *st = fxs.src;
		if (st) {
			for (size_t i = 0; i < FRAME; i++) {
				st->buf[st->n++] = frame[i];
				if (st->n == st->sampc) {
					struct auframe af;
					auframe_init(&af, AUFMT_S16LE, st->buf, st->sampc, SRATE, 1);
					st->rh(&af, st->arg);
					st->n = 0;
				}
			}
		}
		mtx_unlock(fxs.lock);
	}
	return 0;
}

/* --- phone logic, main thread --- */

static void dial(void *arg)
{
	struct ua *ua = line_ua();
	char *uri = NULL;
	struct pl pl;
	(void)arg;

	tmr_cancel(&fxs.tmr_dial);
	if (!fxs.ndigits || !ua)
		return;
	fxs.digits[fxs.ndigits] = '\0';
	pl_set_str(&pl, fxs.digits);
	fxs.ndigits = 0;
	if (account_uri_complete_strdup(ua_account(ua), &uri, &pl) || ua_connect(ua, NULL, NULL, uri, VIDMODE_OFF)) {
		warning("fxs: dialling %s failed\n", fxs.digits);
		tone(&TONE_BUSY);
	}
	else {
		info("fxs: dialling %s\n", uri);
	}
	mem_deref(uri);
}

static void digit_release(void *arg)
{
	struct call *call = arg;
	call_send_digit(call, KEYCODE_REL);
}

static void line_changed(void)
{
	struct en75xx_voice_line_state s;
	struct ua *ua = line_ua();
	struct call *in;

	if (ioctl(fxs.fd, EN75XX_VOICE_GET_STATE, &s) < 0 || (s.hook == EN75XX_VOICE_OFFHOOK) == fxs.offhook)
		return;
	fxs.offhook = s.hook == EN75XX_VOICE_OFFHOOK;
	tmr_cancel(&fxs.tmr_dial);
	fxs.ndigits = 0;

	if (!fxs.offhook) {
		tone(&TONE_OFF);
		if (ua && ua_call(ua))
			ua_hangup(ua, NULL, 0, NULL);
		return;
	}
	in = ua ? ua_find_call_state(ua, CALL_STATE_INCOMING) : NULL;
	if (in) {
		ring(false);
		ua_answer(ua, in, VIDMODE_OFF);
	}
	else if (!ua || !ua_call(ua)) {
		tone(&TONE_DIAL);
	}
}

static void got_digit(char d)
{
	struct ua *ua = line_ua();
	struct call *call = ua ? ua_find_call_state(ua, CALL_STATE_ESTABLISHED) : NULL;

	if (!fxs.offhook)
		return;
	if (call) {
		call_send_digit(call, d);
		tmr_start(&fxs.tmr_rel, 100, digit_release, call);
		return;
	}
	if (ua && ua_call(ua))
		return;
	tone(&TONE_OFF);
	if (d == '#') {
		dial(NULL);
		return;
	}
	if (fxs.ndigits < sizeof(fxs.digits) - 1)
		fxs.digits[fxs.ndigits++] = d;
	tmr_start(&fxs.tmr_dial, DIAL_WAIT, dial, NULL);
}

static void mq_handler(int id, void *data, void *arg)
{
	(void)arg;
	if (id == EV_LINE)
		line_changed();
	else if (id == EV_DIGIT)
		got_digit((char)(intptr_t)data);
}

static void event_handler(enum ua_event ev, struct bevent *event, void *arg)
{
	struct call *call = bevent_get_call(event);
	(void)arg;

	switch (ev) {
	case UA_EVENT_CALL_INCOMING:
		if (fxs.offhook)   /* handset already up: one line, so busy */
			ua_hangup(call_get_ua(call), call, 486, "Busy Here");
		else
			ring(true);
		break;
	case UA_EVENT_CALL_RINGING:
		tone(&TONE_RINGBACK);
		break;
	case UA_EVENT_CALL_PROGRESS:
	case UA_EVENT_CALL_ESTABLISHED:
		tone(&TONE_OFF);
		break;
	case UA_EVENT_CALL_CLOSED:
		ring(false);
		if (fxs.offhook)
			tone(&TONE_BUSY);
		break;
	default:
		break;
	}
}

/* --- module --- */

static int module_init(void)
{
	struct en75xx_voice_info inf;
	uint32_t active = EN75XX_VOICE_LINEFEED_ACTIVE;
	int err;

	str_ncpy(fxs.dev, "/dev/en75xx-fxs0", sizeof(fxs.dev));
	conf_get_str(conf_cur(), "fxs_device", fxs.dev, sizeof(fxs.dev));

	fxs.fd = open(fxs.dev, O_RDWR | O_NONBLOCK);
	if (fxs.fd < 0) {
		warning("fxs: %s: %m\n", fxs.dev, errno);
		return errno;
	}
	if (ioctl(fxs.fd, EN75XX_VOICE_GET_INFO, &inf) < 0 || inf.abi_version != EN75XX_VOICE_ABI_VERSION) {
		warning("fxs: %s: driver ABI not %u\n", fxs.dev, EN75XX_VOICE_ABI_VERSION);
		close(fxs.fd);
		fxs.fd = -1;
		return ENOTSUP;
	}
	info("fxs: %s: %s, line %u\n", fxs.dev, inf.slic, inf.line);
	ioctl(fxs.fd, EN75XX_VOICE_SET_LINEFEED, &active);

	tmr_init(&fxs.tmr_dial);
	tmr_init(&fxs.tmr_rel);
	tmr_init(&fxs.tmr_ring);
	err = mutex_alloc(&fxs.lock);
	err |= mqueue_alloc(&fxs.mq, mq_handler, NULL);
	err |= dtmf_dec_alloc(&fxs.dtmf, SRATE, 1, on_digit, NULL);
	err |= ausrc_register(&fxs.ausrc, baresip_ausrcl(), "fxs", src_alloc);
	err |= auplay_register(&fxs.auplay, baresip_auplayl(), "fxs", play_alloc);
	err |= bevent_register(event_handler, NULL);
	if (err)
		return ENOMEM;

	re_atomic_rlx_set(&fxs.run, true);
	err = thrd_create(&fxs.thread, io_thread, NULL);
	if (err) {
		re_atomic_rlx_set(&fxs.run, false);
		return err;
	}
	/* the handset may already be up */
	mqueue_push(fxs.mq, EV_LINE, NULL);
	return 0;
}

static int module_close(void)
{
	if (re_atomic_rlx(&fxs.run)) {
		re_atomic_rlx_set(&fxs.run, false);
		thrd_join(fxs.thread, NULL);
	}
	bevent_unregister(event_handler);
	tmr_cancel(&fxs.tmr_dial);
	tmr_cancel(&fxs.tmr_rel);
	fxs.ausrc = mem_deref(fxs.ausrc);
	fxs.auplay = mem_deref(fxs.auplay);
	fxs.dtmf = mem_deref(fxs.dtmf);
	fxs.mq = mem_deref(fxs.mq);
	fxs.lock = mem_deref(fxs.lock);
	if (fxs.fd >= 0) {
		ring(false);
		tone(&TONE_OFF);
		close(fxs.fd);
		fxs.fd = -1;
	}
	return 0;
}

EXPORT_SYM const struct mod_export DECL_EXPORTS(fxs) = {
	"fxs",
	"sound",
	module_init,
	module_close
};
