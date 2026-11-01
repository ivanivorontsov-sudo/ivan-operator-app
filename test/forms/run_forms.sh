#!/bin/bash
# usage: run_forms.sh MODE(hybrid|vision|dom) [провайдер-json] [страницы]
cd "$(dirname "$0")"; MODE=$1; EX=${2:-'{"provider":"engine","base":"http://127.0.0.1:8091/v1","model":"local","profile":"qwen"}'}
TAG=${TAG:-$MODE}; OUT=/tmp/iop-forms/$TAG; mkdir -p $OUT; : > $OUT/submissions.jsonl; : > $OUT/times.txt
pkill -f "server.py 8765"; sleep 0.5
FORMS_OUT=$OUT/submissions.jsonl setsid nohup python3 $PWD/server.py 8765 > $OUT/server.log 2>&1 < /dev/null &
sleep 1; echo "тестовый файл ИванОператора" > /tmp/upload_test.txt; chmod 644 /tmp/upload_test.txt
for pg in ${PAGES:-basic wizard validate}; do
  T=$(python3 -c "import json;print(json.load(open('tasks.json'))['$pg'])")
  X=$(python3 -c "import json,sys;d=json.loads(sys.argv[1]);d.update({'uiMode':'$MODE','visionOnly':'$MODE'=='vision','maxSteps':int('${STEPS:-30}'),'maxMinutes':int('${MINS:-22}'),'timeoutSec':180,'settleMs':1000,'retries':3,'jsonSchema':False,'contextBudget':7000,'useMarks':True});print(json.dumps(d))" "$EX")
  echo "=== $MODE/$pg $(date +%T)"; T0=$(date +%s)
  sudo -u ivtest pkill -f chrome 2>/dev/null
  ../run_scenario.sh f_${TAG}_$pg "$T" $(( ${MINS:-22}*60+60 )) "$X" | tail -1 | cut -c1-300
  echo "$pg $(( $(date +%s)-T0 ))" >> $OUT/times.txt; sudo -u ivtest pkill -f chrome 2>/dev/null; sleep 2
done
python3 check.py $OUT/submissions.jsonl $MODE > $OUT/result.json; python3 -c "import json;d=json.load(open('$OUT/result.json'));print(d['mode'],d['total'],d['by_type'])"
