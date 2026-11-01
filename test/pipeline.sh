#!/bin/bash
cd /workspace/ivan-operator/test
for m in hybrid vision dom; do STEPS=20 MINS=14 ./forms/run_forms.sh $m; done
TAG=duck_dom PAGES="basic wizard" ./forms/run_forms.sh dom '{"provider":"webchat","webchat":"duckai","model":"","profile":"openai"}'
SITES="duckai huggingchat chatgpt gigachat alice" ./guest_chats.sh
E='{"provider":"engine","base":"http://127.0.0.1:8091/v1","model":"local","profile":"qwen","maxSteps":25,"maxMinutes":20,"timeoutSec":240,"contextBudget":7000}'
./run_scenario.sh local_writer "Открой LibreOffice Writer, напечатай строку «Привет от ИванОператора 2026» и сохрани как /tmp/iop_writer.odt. Затем done." 1300 "$E"; ls -la /tmp/iop_writer.odt
./run_scenario.sh local_browser "Открой в браузере http://127.0.0.1:8765/index.html и скажи (done), какие три ссылки там есть." 1300 "$E"
echo PIPELINE_DONE
