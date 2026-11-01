#!/bin/bash
# v1.1.3: замеры hybrid/vision + повтор onlinetestpad после исправления «не спрашивать до открытия адреса»
cd /workspace/ivan-operator/test
A='{"provider":"webchat","webchat":"duckai","model":"","profile":"openai","timeoutSec":150}'
memok(){ while a=$(awk '/MemAvailable/{print int($2/1048576)}' /proc/meminfo); [ $a -lt 3 ]; do echo "MEM LOW ${a}G"; sleep 60; done; }
memok; TAG=hybrid_v6 STEPS=25 MINS=12 ./forms/run_forms.sh hybrid "$A"
memok; TAG=vision_v6 STEPS=25 MINS=10 PAGES="basic" ./forms/run_forms.sh vision "$A"
T1=$(grep -o 'T1="[^"]*"' pipeline5.sh | head -1 | cut -c5- | sed 's/"$//')
X=$(python3 -c "import json,sys;d=json.loads(sys.argv[1]);d.update({'uiMode':'dom','maxSteps':40,'maxMinutes':15});print(json.dumps(d))" "$A")
memok; echo "=== otp eng/dom $(date +%T)"; T0=$(date +%s); ./run_scenario.sh otp_eng_dom2 "$T1" 1000 "$X" | tail -1 | cut -c1-300; echo "time $(( $(date +%s)-T0 ))s"
echo PIPELINE6_DONE
