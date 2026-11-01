#!/bin/bash
cd /workspace/ivan-operator/test
T='Как человек, только по скриншотам: открой браузер Google Chrome через меню приложений (open_app «Google Chrome»), щёлкни по адресной строке, введи 127.0.0.1:8799 и нажми Enter. Реши мини-тест из 5 вопросов (один ответ, несколько ответов, ввод числа, соответствие в списках, порядок цифрами), нажми «Завершить». Решай сам, не спрашивай. done с текстом «Результат: N из 5».'
X='{"provider":"webchat","webchat":"duckai","model":"","profile":"openai","timeoutSec":150,"uiMode":"vision","maxSteps":40,"maxMinutes":15}'
while [ $(awk '/MemAvailable/{print int($2/1048576)}' /proc/meminfo) -lt 3 ]; do sleep 60; done
T0=$(date +%s); ./run_scenario.sh human_otp_114s "$T" 1000 "$X" | tail -3 | cut -c1-600; echo "time $(( $(date +%s)-T0 ))s"; echo HUMAN_DONE
