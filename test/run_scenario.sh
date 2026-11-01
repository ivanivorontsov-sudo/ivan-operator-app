#!/bin/bash
# Запуск одного сценария агента в песочнице: пользователь ivtest (без sudo), дисплей :77, лимит времени, nice.
# usage: run_scenario.sh NAME "задача" [timeout_sec] [extra settings json]
NAME=$1; TASK=$2; TMO=${3:-900}; EXTRA=${4:-'{}'}
D=/tmp/iop-tests/$NAME; sudo -u ivtest mkdir -p $D/data $D/ud
python3 - "$EXTRA" > /tmp/iop-set-$NAME.json <<'PY'
import json,sys
s={"provider":"pollinations","base":"","model":"openai-fast","profile":"qwen","coords":"pixels","precise":False,"useMarks":True,"maxSteps":15,"timeoutSec":300,"contextBudget":6500,"hideWindow":False,"settleMs":900,"maxMinutes":14,"retries":4,"jsonSchema":False}
extra=json.loads(sys.argv[1]); s.update(extra)
local={"llamacpp","engine","ollama","custom"}
if s.get("provider") not in local and "base" not in extra:
    s["base"]=""
elif s.get("provider") not in local and extra.get("base","").startswith("http://127.0.0.1"):
    s["base"]=""
print(json.dumps(s))
PY
chmod 644 /tmp/iop-set-$NAME.json
mkdir -p /tmp/iop-logs
cd /tmp && sudo -u ivtest env -i HOME=/home/ivtest USER=ivtest PATH=/usr/local/bin:/usr/bin:/bin DISPLAY=:77 LANG=ru_RU.UTF-8 LC_ALL=ru_RU.UTF-8 XDG_SESSION_TYPE=x11   SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt   IOP_HEADLESS=1 IOP_LOG=1 IOP_SETTINGS=/tmp/iop-set-$NAME.json IOP_DATA=$D/data IOP_TASK="$TASK" IOP_ALLOW_CMDS=${IOP_ALLOW_CMDS:-1} IOP_RESUME=${IOP_RESUME:-} IOP_REMOTE=${IOP_REMOTE:-} IOP_REMOTE_PORT=${IOP_REMOTE_PORT:-} IOP_REMOTE_INFO=${IOP_REMOTE_INFO:-} IOP_KEEP_SEC=${IOP_KEEP_SEC:-} IOP_RECIPE_SAVE=${IOP_RECIPE_SAVE:-} IOP_SCHEDULE="${IOP_SCHEDULE:-}" IOP_SCHEDULE_TASK="${IOP_SCHEDULE_TASK:-}"   timeout -k 10 $TMO nice -n 10 prlimit --as=unlimited --nproc=400   /workspace/ivan-operator/node_modules/electron/dist/electron --no-sandbox --user-data-dir=$D/ud /workspace/ivan-operator   > /tmp/iop-logs/$NAME.full.txt 2>&1
grep -E "^\[(event|result)\]" /tmp/iop-logs/$NAME.full.txt | cut -c1-500 > /tmp/iop-logs/$NAME.txt || true
echo "exit=$?"; grep -c '"kind":"step"' /tmp/iop-logs/$NAME.txt; tail -1 /tmp/iop-logs/$NAME.txt
