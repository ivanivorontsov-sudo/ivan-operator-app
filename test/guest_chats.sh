#!/bin/bash
# Гостевые ИИ-чаты: без входа. Пауза между сайтами из‑за FREE_LIMIT Pollinations.
cd "$(dirname "$0")/.."
DEF='{"provider":"pollinations","base":"","model":"openai-fast","profile":"openai","maxSteps":14,"maxMinutes":12,"timeoutSec":120,"settleMs":1500,"retries":5,"jsonSchema":false}'
EX=${EXTRA:-$DEF}
declare -A S=( [gigachat]="https://giga.chat" [alice]="https://alice.yandex.ru" [chatgpt]="https://chatgpt.com" [copilot]="https://copilot.microsoft.com" [duckai]="https://duck.ai" [huggingchat]="https://huggingface.co/chat" [perplexity]="https://www.perplexity.ai" [qwen]="https://chat.qwen.ai" )
mkdir -p /tmp/iop-logs
for k in ${SITES:-duckai huggingchat chatgpt copilot gigachat alice}; do
  echo "=== $k $(date +%T) ==="
  T="Через browser_* открой ${S[$k]}. Это ИИ-чат. НЕ входи и НЕ регистрируйся: если без входа писать нельзя — done с ответом «ТРЕБУЕТСЯ ВХОД». Баннеры cookie/согласия закрывай через browser_dismiss или browser_click (Продолжить/Accept/Принять). Напиши в чат: «Сколько будет 17*23? Ответь одним числом.» и отправь (Enter). wait 5–8 с, browser_read, done с дословным ответом чата (ожидаем 391)."
  /workspace/ivan-operator/test/run_scenario.sh g_$k "$T" 720 "$EX" > /tmp/iop-logs/g_$k.out 2>&1
  echo "$k: $(grep -o '\[result\].*' /tmp/iop-logs/g_$k.txt 2>/dev/null | tail -1 | cut -c1-350)"
  sleep 35
done
