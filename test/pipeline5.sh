#!/bin/bash
# Последовательный прогон: мозг — веб-чаты (локальная 3B выключена ради ≥3 ГБ RAM, т.к. на боксе работает чужой эмулятор Android).
cd /workspace/ivan-operator/test
AL='{"provider":"webchat","webchat":"duckai","model":"","profile":"openai","timeoutSec":150}'
A='{"provider":"webchat","webchat":"duckai","model":"","profile":"openai","timeoutSec":150}'
D='{"provider":"webchat","webchat":"duckai","model":"","profile":"openai","timeoutSec":150}'
memok(){ a=$(awk '/MemAvailable/{print int($2/1048576)}' /proc/meminfo); [ $a -ge 3 ] || { echo "MEM LOW ${a}G — пауза"; sleep 120; }; }
#memok; TAG=hybrid_v5 STEPS=30 MINS=15 ./forms/run_forms.sh hybrid "$AL"
#memok; TAG=vision_v5 STEPS=30 MINS=15 ./forms/run_forms.sh vision "$AL"
# Программы
X='{"provider":"webchat","webchat":"duckai","model":"","profile":"openai","timeoutSec":150,"maxSteps":25,"maxMinutes":20,"uiMode":"hybrid"}'
run(){ memok; echo "=== app $1 $(date +%T)"; ./run_scenario.sh app_$1 "$2" 800 "$X" | tail -1 | cut -c1-250; echo "CHECK $1: $(eval "$3" && echo PASS || echo FAIL)"; sudo -u ivtest pkill -f soffice; sudo -u ivtest pkill -f thunar; sudo -u ivtest pkill -f xfce4-terminal; sleep 2; }
run writer "Открой LibreOffice Writer (open_app), напечатай «Привет от ИванОператора» и сохрани документ как /tmp/iop_app_writer.odt (Ctrl+Shift+S, ввести путь, Enter; если спросит формат — оставить ODF). Затем done." "test -s /tmp/iop_app_writer.odt"
run thunar "Открой файловый менеджер Thunar (open_app) в папке /tmp, создай через меню/контекстное меню новую папку с именем iop_fm_test и done." "test -d /tmp/iop_fm_test"
run terminal "Открой терминал xfce4-terminal (open_app), напечатай в нём команду: echo terminal-ok > /tmp/iop_term.txt и нажми Enter. Затем done." "grep -q terminal-ok /tmp/iop_term.txt"
run calc "Открой LibreOffice Calc (open_app) как калькулятор: в ячейку A1 введи =17*23 и Enter, прочитай результат, сохрани как /tmp/iop_app_calc.ods и done с результатом." "test -s /tmp/iop_app_calc.ods"
# onlinetestpad (вымышленные данные, без регистрации на сайте)
O(){ memok; echo "=== otp $1/$2 $(date +%T)"; sudo -u ivtest pkill -f chrome; ./run_scenario.sh otp_$1_$2 "$3" 1000 "$(python3 -c "import json,sys;d=json.loads(sys.argv[1]);d.update({'uiMode':'$2','visionOnly':'$2'=='vision','maxSteps':40,'maxMinutes':15});print(json.dumps(d))" "$4")" | tail -1 | cut -c1-300; }
T1="Открой https://onlinetestpad.com/ru/test/11204-test-na-opredelenie-urovnya-anglijskogo-yazyka и пройди тест: «Пройти тест», отвечай на вопросы (один вариант, выбирай лучший), жми «Далее». Ответь хотя бы на 10 вопросов, затем «Завершить» (если требует ответить на все — продолжай). В конце done с итоговым результатом и числом отвеченных вопросов. Ничего не регистрируй."
T2="Открой https://onlinetestpad.com/ru/test/121501-tekstovyj-redaktor-ms-word . В регистрационной форме используй ТОЛЬКО вымышленные данные: ФИО «Тестов Тест Тестович», группа «ТЕСТ-1», email test@example.com. Пройди тест (одиночный и множественный выбор, соответствия, последовательности), жми «Далее» и в конце «Завершить». done с результатом и числом отвеченных вопросов. Без регистрации на сайте."
#O eng hybrid "$T1" "$AL"; O word hybrid "$T2" "$AL"
O eng dom "$T1" "$A"; O word dom "$T2" "$A"
SITES="duckai huggingchat chatgpt gigachat alice" ./guest_chats.sh
echo PIPELINE5_DONE
cd /workspace/ivan-operator/test && ./local_writer.sh
