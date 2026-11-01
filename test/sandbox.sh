#!/bin/bash
# Песочница для испытаний: отдельный X-дисплей :77 (Xvfb) и непривилегированный пользователь ivtest (без sudo).
# Ограничения: время (timeout), память (ulimit -v не годится для Electron, поэтому systemd-run/prlimit по RSS не используется;
# следим монитором), nice 10. Все процессы убиваются в конце.
set -u
ACT=${1:-start}
D=:77
if [ "$ACT" = start ]; then
  pgrep -f "Xvfb $D" >/dev/null || (Xvfb $D -screen 0 1920x1080x24 -nolisten tcp > /tmp/xvfb77.log 2>&1 &)
  sleep 1
  DISPLAY=$D xhost +SI:localuser:ivtest >/dev/null
  pgrep -u ivtest xfwm4 >/dev/null || sudo -u ivtest DISPLAY=$D setsid xfwm4 --compositor=off >/dev/null 2>&1 &
  echo started
elif [ "$ACT" = stop ]; then
  sudo pkill -u ivtest 2>/dev/null; sleep 1; sudo pkill -9 -u ivtest 2>/dev/null
  pkill -f "Xvfb $D"; echo stopped
elif [ "$ACT" = shot ]; then
  DISPLAY=$D import -window root "${2:-/tmp/sb.png}"
elif [ "$ACT" = mon ]; then
  echo "CPU load: $(cut -d' ' -f1-3 /proc/loadavg) | RAM avail: $(free -m | awk '/Mem/{print $7}') MB | disk free: $(df -h / | awk 'NR==2{print $4}') | ivtest procs: $(pgrep -u ivtest | wc -l)"
fi
