-- Fibre line metrics from alphawrt-linemon's files in /tmp/alphawrt (the
-- last 60 s history line and the OLT's thresholds), plus the WAN uptime.
local ubus = require "ubus"

local function last_line(path)
  local f = io.open(path)
  if not f then return end
  f:seek("set", math.max(0, f:seek("end") - 512))
  local last
  for l in f:lines() do
    if l ~= "" then last = l end
  end
  f:close()
  return last
end

-- nW -> dBm
local function dbm(nw)
  nw = tonumber(nw)
  if nw and nw > 0 then return 10 * math.log10(nw / 1e6) end
end

local function scrape()
  local h = last_line("/tmp/alphawrt/line.hist")
  if h then
    -- ts state rx_nw tx_nw bias_ua temp_mc hec1 hec2 hecu crc bip lof
    -- fec_cw fec_ucw ping_ms loss_pct rx_frames
    local v = space_split(h)
    metric("alphawrt_line_sample_timestamp_seconds", "gauge", nil, tonumber(v[1]))
    metric("alphawrt_pon_state", "gauge", nil, tonumber(v[2]))
    metric("alphawrt_rx_dbm", "gauge", nil, dbm(v[3]))
    metric("alphawrt_tx_dbm", "gauge", nil, dbm(v[4]))
    metric("alphawrt_laser_bias_amperes", "gauge", nil, tonumber(v[5]) and v[5] / 1e6)
    metric("alphawrt_optics_temp_celsius", "gauge", nil, tonumber(v[6]) and v[6] / 1000)
    local errs = metric("alphawrt_line_errors_total", "counter")
    for i, name in ipairs({ "hec_corrected_1bit", "hec_corrected_2bit", "hec_uncorrectable",
        "crc", "bip", "lof", "fec_corrected_codewords", "fec_uncorrectable_codewords" }) do
      if tonumber(v[6 + i]) then errs({ type = name }, v[6 + i]) end
    end
    metric("alphawrt_rx_frames_total", "counter", nil, tonumber(v[17]))
    metric("alphawrt_gateway_ping_ms", "gauge", nil, tonumber(v[15]))
    metric("alphawrt_gateway_loss_percent", "gauge", nil, tonumber(v[16]))
  end

  -- sf sd rx_low rx_high (BER 10^-x; dBm x 10)
  local t = last_line("/tmp/alphawrt/thresholds")
  if t then
    t = space_split(t)
    local thr = metric("alphawrt_olt_threshold", "gauge")
    if tonumber(t[1]) then thr({ type = "sf_ber_exp" }, t[1]) end
    if tonumber(t[2]) then thr({ type = "sd_ber_exp" }, t[2]) end
    if tonumber(t[3]) then thr({ type = "rx_low_dbm" }, t[3] / 10) end
    if tonumber(t[4]) then thr({ type = "rx_high_dbm" }, t[4] / 10) end
  end

  local u = ubus.connect()
  if u then
    local s = u:call("network.interface.wan", "status", {})
    if s and s.up then metric("alphawrt_wan_uptime_seconds", "gauge", nil, s.uptime) end
    u:close()
  end
end

return { scrape = scrape }
