#!/bin/bash
# E2E: снимок → прикрепление к (мок) веб-чату → ответ JSON → разбор → реальный клик xdotool по мишени. Запуск: test/e2e/run_e2e.sh [perplexity|paste]
set -u; MODE=${1:-perplexity}; R=$(cd "$(dirname "$0")/../.." && pwd); D=:77; T=/tmp/iop-e2e-$MODE; sudo rm -rf $T; mkdir -p $T; chmod 777 $T
"$R/test/sandbox.sh" start >/dev/null
if [ "$MODE" = paste ]; then WC='"webchat":"custom","webchatImages":true'; else WC='"webchat":"perplexity"'; fi
cat > $T/settings.json <<J
{"provider":"webchat",$WC,"webchatUrl":"http://127.0.0.1:8766/","webchatShow":false,"webchatKeepChat":true,"uiMode":"vision","coords":"norm1000","precise":false,"autoFailover":false,"fallbacks":[],"maxSteps":5,"maxMinutes":4,"hideWindow":false,"autoCheckpoint":false,"autoSkills":false,"adaptiveModels":false,"recordRuns":false,"fastIntents":false,"timeoutSec":60,"hangSec":40}
J
chmod 666 $T/settings.json
U="sudo -u ivtest -H env DISPLAY=$D HOME=/home/ivtest PATH=/usr/bin:/bin"
$U MOCK_LOG=$T/mock.json setsid timeout 300 node "$R/test/e2e/mockchat.js" > $T/mock.log 2>&1 &
$U HIT_FILE=$T/hit.json setsid timeout 300 nice -n 10 "$R/node_modules/.bin/electron" --no-sandbox "$R/test/e2e/target.js" > $T/target.log 2>&1 &
sleep 5
$U IOP_HEADLESS=1 IOP_SETTINGS=$T/settings.json IOP_DATA=$T/data IOP_TASK="Нажми на зелёную кнопку TARGET" timeout 280 nice -n 10 "$R/node_modules/.bin/electron" --no-sandbox "$R" > $T/agent.log 2>&1
echo "agent exit $?"
grep -a "\[result\]" $T/agent.log | cut -c1-300
echo "mock:"; cat $T/mock.json 2>/dev/null | tr -d '\n' | cut -c1-900; echo
echo "hit:"; cat $T/hit.json 2>/dev/null; echo
sudo pkill -u ivtest -f mockchat.js; sudo pkill -u ivtest -f target.js
