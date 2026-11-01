#!/bin/bash
# Локальная ≤4B модель (Qwen2.5-VL-3B Q4_K_M), -c 4096 -np 1 --cache-ram 0: задача Writer + браузер
# Без mmproj и в быстром режиме (dom): гипервизор (virtio_balloon) забрал ~10 ГБ RAM бокса
M=/home/box/.ivan-operator/models/engine
a=$(awk '/MemAvailable/{print int($2/1048576)}' /proc/meminfo); [ $a -ge 3 ] || { echo "MEM LOW ${a}G"; exit 1; }
nice -n 10 $M/bin/llama-b11954/llama-server -m $M/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf -c 4096 -np 1 --cache-ram 0 -t 4 --port 8091 > /tmp/llama8091.log 2>&1 &
LP=$!; for i in $(seq 60); do curl -s 127.0.0.1:8091/health | grep -q ok && break; sleep 2; done
cd "$(dirname "$0")"; rm -f /tmp/iop_local_writer.odt
X='{"provider":"engine","base":"http://127.0.0.1:8091/v1","model":"local","profile":"qwen","maxSteps":30,"maxMinutes":20,"uiMode":"dom","timeoutSec":240}'
T0=$(date +%s)
./run_scenario.sh local_writer "Открой https://ru.wikipedia.org/wiki/Владивосток (browser_open) и прочитай (browser_read) год основания города. Затем открой LibreOffice Writer (open_app), напечатай «Владивосток основан в <год>» и сохрани как /tmp/iop_local_writer.odt (Ctrl+Shift+S, путь, Enter, оставить ODF). Затем done." 1300 "$X" | tail -1 | cut -c1-300
echo "time $(( $(date +%s)-T0 ))s"; test -s /tmp/iop_local_writer.odt && echo "CHECK local_writer: PASS ($(unzip -p /tmp/iop_local_writer.odt content.xml | grep -o 'Владивосток основан[^<]*'))" || echo "CHECK local_writer: FAIL"
sudo -u ivtest pkill -f soffice; kill $LP
