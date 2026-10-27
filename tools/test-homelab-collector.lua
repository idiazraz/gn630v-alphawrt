-- Host check for the Prometheus fibre collector (alphawrt.lua): stubs the
-- exporter's helpers and ubus, feeds it one linemon sample.
--   lua tools/test-homelab-collector.lua
local dir = os.tmpname(); os.remove(dir); os.execute("mkdir -p " .. dir)
io.open(dir .. "/line.hist", "w"):write(
  "1793033249 5 17100 1640000 10158 33665 0 0 0 0 0 0 0 0 - - 110587297\n",
  "1793033309 5 17100 1640000 10208 33665 1 0 0 2 0 0 7 0 - - 114161001\n"):close()
io.open(dir .. "/thresholds", "w"):write("5 9 -280 -80\n"):close()

package.preload.ubus = function() return { connect = function() return {
  call = function() return { up = true, uptime = 3600 } end, close = function() end } end } end
function space_split(s) local e = {} for x in s:gmatch("%S+") do e[#e + 1] = x end return e end
local buf = {}
out = { write = function(_, ...) for _, v in ipairs({ ... }) do buf[#buf + 1] = tostring(v) end end }
function metric(n, _, l, v)
  local f = function(l, v)
    if v == nil then return end
    local t = {}
    for k, x in pairs(l or {}) do t[#t + 1] = k .. '="' .. x .. '"' end
    out:write(n, #t > 0 and "{" .. table.concat(t, ",") .. "}" or "", " ", v, "\n")
  end
  if v then f(l, v) end
  return f
end
math.log10 = math.log10 or function(x) return math.log(x, 10) end -- Lua 5.1 has it

local path = arg[0]:gsub("tools/[^/]*$", "") ..
  "package/luci-app-alphawrt/root/usr/lib/lua/prometheus-collectors/alphawrt.lua"
local src = io.open(path):read("*a"):gsub("/tmp/alphawrt", dir)
;(loadstring or load)(src)().scrape()
local s = table.concat(buf)
os.execute("rm -r " .. dir)

assert(s:find("alphawrt_rx_dbm %-17%.67"), "rx dBm")
assert(s:find("alphawrt_tx_dbm 2%.14"), "tx dBm")
assert(s:find("alphawrt_optics_temp_celsius 33%.665"), "temp")
assert(s:find('alphawrt_line_errors_total{type="crc"} 2'), "last line wins")
assert(s:find('alphawrt_olt_threshold{type="rx_low_dbm"} %-28'), "threshold")
assert(s:find("alphawrt_wan_uptime_seconds 3600"), "uptime")
assert(not s:find("alphawrt_gateway_ping_ms "), "'-' is skipped")
print("ok")
