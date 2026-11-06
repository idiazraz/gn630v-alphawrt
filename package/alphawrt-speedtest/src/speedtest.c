// SPDX-License-Identifier: GPL-2.0-only
/*
 * alphawrt-speedtest: internet speed test against Speedtest.net (Ookla)
 * servers, using their plain TCP test protocol on port 8080:
 *   HI -> HELLO ...           PING <ms> -> PONG <ms>
 *   DOWNLOAD <n> -> n bytes   UPLOAD <n> 0\n + rest of n bytes -> OK <n> <ms>
 *
 * usage: alphawrt-speedtest [-o status.json] [-t seconds] [-n streams] host:port...
 * Picks the candidate with the lowest ping, then measures ping/jitter,
 * download and upload. Progress and results go to the status file as JSON
 * (rewritten atomically about 4 times a second) and the final result to stdout.
 *
 * Note: this is our own client; it isn't Ookla's app and doesn't use their name.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <netdb.h>
#include <poll.h>
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

#ifndef MSG_NOSIGNAL
#define MSG_NOSIGNAL 0	/* SIGPIPE is ignored anyway */
#endif

#define MAXS 16
#define CHUNK 25000000		/* bytes per DOWNLOAD/UPLOAD request */
#define WARMUP 1.5		/* seconds left out while TCP ramps up */

static const char *out = "/tmp/alphawrt-speedtest.json";
static const char *server = "";
static double ping = -1, jitter = -1, down = -1, up = -1;
static volatile sig_atomic_t stop;

static double now(void)
{
	struct timespec t;
	clock_gettime(CLOCK_MONOTONIC, &t);
	return t.tv_sec + t.tv_nsec / 1e9;
}

static void status(const char *state, double progress, const char *err)
{
	char tmp[256];
	snprintf(tmp, sizeof(tmp), "%s.tmp", out);
	FILE *f = fopen(tmp, "w");
	if (!f)
		return;
	fprintf(f, "{\"state\":\"%s\",\"server\":\"%s\",\"progress\":%.2f", state, server, progress);
	if (ping >= 0)
		fprintf(f, ",\"ping\":%.1f,\"jitter\":%.1f", ping, jitter);
	if (down >= 0)
		fprintf(f, ",\"download\":%.1f", down);
	if (up >= 0)
		fprintf(f, ",\"upload\":%.1f", up);
	if (err)
		fprintf(f, ",\"error\":\"%s\"", err);
	fprintf(f, "}\n");
	fclose(f);
	rename(tmp, out);
}

static void die(const char *err)
{
	status("error", 0, err);
	fprintf(stderr, "%s\n", err);
	exit(1);
}

/* blocking connect with a timeout; host:port, IPv6 literal as [addr]:port */
static int dial(const char *hostport, int timeout_ms)
{
	char host[256], *port;
	snprintf(host, sizeof(host), "%s", hostport);
	port = strrchr(host, ':');
	if (!port)
		return -1;
	*port++ = 0;
	char *h = host;
	if (*h == '[') {
		h++;
		h[strlen(h) - 1] = 0;
	}
	struct addrinfo hints = { .ai_socktype = SOCK_STREAM }, *res, *ai;
	if (getaddrinfo(h, port, &hints, &res))
		return -1;
	int fd = -1;
	for (ai = res; ai && fd < 0; ai = ai->ai_next) {
		fd = socket(ai->ai_family, ai->ai_socktype, 0);
		if (fd < 0)
			continue;
		fcntl(fd, F_SETFL, O_NONBLOCK);
		if (connect(fd, ai->ai_addr, ai->ai_addrlen) && errno != EINPROGRESS)
			goto fail;
		struct pollfd p = { fd, POLLOUT, 0 };
		int e = 0;
		socklen_t l = sizeof(e);
		if (poll(&p, 1, timeout_ms) == 1 && !getsockopt(fd, SOL_SOCKET, SO_ERROR, &e, &l) && !e)
			break;
fail:
		close(fd);
		fd = -1;
	}
	freeaddrinfo(res);
	return fd;
}

/* send a command and read one reply line (non-blocking fd, with timeout) */
static int ask(int fd, const char *cmd, char *line, size_t len, int timeout_ms)
{
	if (send(fd, cmd, strlen(cmd), MSG_NOSIGNAL) != (ssize_t)strlen(cmd))
		return -1;
	size_t n = 0;
	double end = now() + timeout_ms / 1000.0;
	while (n < len - 1) {
		struct pollfd p = { fd, POLLIN, 0 };
		int left = (int)((end - now()) * 1000);
		if (left <= 0 || poll(&p, 1, left) != 1)
			return -1;
		ssize_t r = recv(fd, line + n, 1, 0);
		if (r <= 0)
			return -1;
		if (line[n++] == '\n')
			break;
	}
	line[n] = 0;
	return 0;
}

static int hello(int fd)
{
	char line[128];
	return ask(fd, "HI\n", line, sizeof(line), 3000) || strncmp(line, "HELLO", 5) ? -1 : 0;
}

/* one round trip in ms, or -1 */
static double rtt(int fd)
{
	char cmd[64], line[128];
	double t = now();
	snprintf(cmd, sizeof(cmd), "PING %lld\n", (long long)(t * 1000));
	if (ask(fd, cmd, line, sizeof(line), 3000) || strncmp(line, "PONG", 4))
		return -1;
	return (now() - t) * 1000;
}

static int cmp(const void *a, const void *b)
{
	double x = *(const double *)a, y = *(const double *)b;
	return x < y ? -1 : x > y;
}

/*
 * One transfer phase: n streams, each looping over CHUNK-sized requests.
 * Returns Mbit/s over the time after WARMUP. Limit: bytes are counted when
 * the kernel takes or gives them, not end to end, so the warm-up window
 * also hides the send buffer filling on upload.
 */
static double transfer(const char *state, int upload, int n, double secs)
{
	static char buf[65536], rbuf[65536];	/* payload, replies */
	struct pollfd p[MAXS];
	long long left[MAXS];	/* bytes still to read or write in the current request */
	int nl[MAXS];		/* upload: waiting for the server's OK line */
	long long total = 0, base = 0;
	int open = 0;

	memset(buf, 'A', sizeof(buf));
	for (int i = 0; i < n; i++) {
		p[i].fd = dial(server, 3000);
		if (p[i].fd >= 0 && hello(p[i].fd)) {
			close(p[i].fd);
			p[i].fd = -1;
		}
		left[i] = 0;
		nl[i] = 0;
		open += p[i].fd >= 0;
	}
	if (!open)
		die("Couldn't open a test connection to the server.");

	double t0 = now(), tw = t0 + WARMUP, tend = t0 + WARMUP + secs, last = 0, seen = t0;
	int warm = 0;
	while (!stop) {
		double t = now();
		if (t >= tend)
			break;
		if (!warm && t >= tw) {
			warm = 1;
			base = total;
		}
		for (int i = 0; i < n; i++) {
			if (p[i].fd < 0)
				continue;
			if (!left[i] && !nl[i]) {
				char cmd[64];
				int l = upload ? snprintf(cmd, sizeof(cmd), "UPLOAD %d 0\n", CHUNK)
					       : snprintf(cmd, sizeof(cmd), "DOWNLOAD %d\n", CHUNK);
				if (send(p[i].fd, cmd, l, MSG_NOSIGNAL) != l)
					goto drop;
				left[i] = upload ? CHUNK - l : CHUNK;
				total += upload ? l : 0;
			}
			p[i].events = upload && left[i] ? POLLOUT : POLLIN;
			continue;
drop:
			close(p[i].fd);
			p[i].fd = -1;
		}
		if (poll(p, n, 250) < 0 && errno != EINTR)
			break;
		for (int i = 0; i < n; i++) {
			if (p[i].fd < 0 || !(p[i].revents & (POLLIN | POLLOUT | POLLERR | POLLHUP)))
				continue;
			ssize_t r;
			if (upload && left[i]) {
				size_t want = left[i] < (long long)sizeof(buf) ? (size_t)left[i] : sizeof(buf);
				if (want == (size_t)left[i])
					buf[want - 1] = '\n';	/* each request ends with a newline */
				r = send(p[i].fd, buf, want, MSG_NOSIGNAL);
				buf[want - 1] = 'A';
				if (r > 0 && !(left[i] -= r))
					nl[i] = 1;
			} else {
				r = recv(p[i].fd, rbuf, sizeof(rbuf), 0);
				if (r > 0 && upload) {
					if (memchr(rbuf, '\n', r))
						nl[i] = 0;	/* "OK <n> <ms>": next request */
					continue;
				}
				if (r > 0)
					left[i] -= r < left[i] ? r : left[i];
				else if (!r)
					r = -1, errno = ECONNRESET;	/* closed by the server */
			}
			if (r < 0 && (errno == EAGAIN || errno == EINTR))
				continue;
			if (r < 0) {
				close(p[i].fd);
				p[i].fd = -1;
				continue;
			}
			total += r;
			seen = now();
		}
		t = now();
		if (t - seen > 5)
			die("The server stopped answering during the test.");
		if (t - last >= 0.25 && t - tw >= 0.5) {	/* a short window reads high */
			double mbps = (total - base) * 8 / 1e6 / (t - tw);
			if (upload)
				up = mbps;
			else
				down = mbps;
			status(state, (t - t0) / (tend - t0), NULL);
			last = t;
		}
	}
	for (int i = 0; i < n; i++)
		if (p[i].fd >= 0)
			close(p[i].fd);
	double t = now();
	return warm && t > tw ? (total - base) * 8 / 1e6 / (t - tw) : 0;
}

static void onsig(int s)
{
	(void)s;
	stop = 1;
}

int main(int argc, char **argv)
{
	double secs = 10;
	int n = 8, c;
	while ((c = getopt(argc, argv, "o:t:n:")) != -1) {
		if (c == 'o')
			out = optarg;
		else if (c == 't')
			secs = atof(optarg);
		else if (c == 'n')
			n = atoi(optarg);
		else
			return 2;
	}
	if (optind >= argc || secs <= 0 || n < 1 || n > MAXS) {
		fprintf(stderr, "usage: %s [-o status.json] [-t seconds] [-n streams 1-%d] host:port...\n", argv[0], MAXS);
		return 2;
	}
	signal(SIGTERM, onsig);
	signal(SIGINT, onsig);
	signal(SIGPIPE, SIG_IGN);

	/* the closest candidate by one ping each */
	double best = 1e9;
	status("select", 0, NULL);
	for (int i = optind; i < argc; i++) {
		int fd = dial(argv[i], 2000);
		double r = fd >= 0 && !hello(fd) ? rtt(fd) : -1;
		if (fd >= 0)
			close(fd);
		if (r >= 0 && r < best) {
			best = r;
			server = argv[i];
		}
	}
	if (!*server)
		die("None of the test servers answered.");

	/* ping and jitter: median and mean change over 10 round trips */
	int fd = dial(server, 3000);
	if (fd < 0 || hello(fd))
		die("Couldn't connect to the test server.");
	double r[10];
	int k = 0;
	for (int i = 0; i < 10 && !stop; i++) {
		double x = rtt(fd);
		if (x >= 0)
			r[k++] = x;
		status("ping", (i + 1) / 10.0, NULL);
	}
	close(fd);
	if (!k)
		die("The test server didn't answer pings.");
	jitter = 0;
	for (int i = 1; i < k; i++)
		jitter += (r[i] > r[i - 1] ? r[i] - r[i - 1] : r[i - 1] - r[i]) / (k > 1 ? k - 1 : 1);
	qsort(r, k, sizeof(*r), cmp);
	ping = r[k / 2];

	down = transfer("download", 0, n, secs);
	if (!stop)
		up = transfer("upload", 1, n, secs);
	if (stop)
		die("Stopped.");
	status("done", 1, NULL);
	printf("{\"server\":\"%s\",\"ping\":%.1f,\"jitter\":%.1f,\"download\":%.1f,\"upload\":%.1f}\n", server, ping, jitter, down, up);
	return 0;
}
