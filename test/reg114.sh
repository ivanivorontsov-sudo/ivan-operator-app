#!/bin/bash
# Последовательный прогон: мозг — веб-чаты (локальная 3B выключена ради ≥3 ГБ RAM, т.к. на боксе работает чужой эмулятор Android).
cd /workspace/ivan-operator/test
A='{"provider":"webchat","webchat":"alice","model":"","profile":"openai","timeoutSec":150}'
D='{"provider":"webchat","webchat":"duckai","model":"","profile":"openai","timeoutSec":150}'
memok(){ a=$(awk '/MemAvailable/{print int($2/1048576)}' /proc/meminfo); [ $a -ge 3 ] || { echo "MEM LOW ${a}G — пауза"; sleep 120; }; }
# Программы
X='{"provider":"webchat","webchat":"duckai","model":"","profile":"openai","timeoutSec":150,"maxSteps":25,"maxMinutes":15}'
run(){ memok; echo "=== app $1 $(date +%T)"; ./run_scenario.sh app_$1 "$2" 800 "$X" | tail -1 | cut -c1-250; echo "CHECK $1: $(eval "$3" && echo PASS || echo FAIL)"; sudo -u ivtest pkill -f soffice; sudo -u ivtest pkill -f thunar; sudo -u ivtest pkill -f xfce4-terminal; sleep 2; }
run writer "Открой LibreOffice Writer (open_app), напечатай «Привет от ИванОператора» и сохрани документ как /tmp/iop_app_writer.odt (Ctrl+Shift+S, ввести путь, Enter; если спросит формат — оставить ODF). Затем done." "test -s /tmp/iop_app_writer.odt"
run thunar "Открой файловый менеджер Thunar (open_app) в папке /tmp, создай через меню/контекстное меню новую папку с именем iop_fm_test и done." "test -d /tmp/iop_fm_test"
run terminal "Открой терминал xfce4-terminal (open_app), напечатай в нём команду: echo terminal-ok > /tmp/iop_term.txt и нажми Enter. Затем done." "grep -q terminal-ok /tmp/iop_term.txt"
run calc "Открой LibreOffice Calc (open_app) как калькулятор: в ячейку A1 введи =17*23 и Enter, прочитай результат, сохрани как /tmp/iop_app_calc.ods и done с результатом." "test -s /tmp/iop_app_calc.ods"
TAG=duck_dom PAGES="basic wizard" ./forms/run_forms.sh dom '{"provider":"webchat","webchat":"duckai","model":"","profile":"openai"}' 2>&1 | tail -5
