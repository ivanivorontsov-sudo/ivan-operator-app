#!/bin/bash
cd /workspace/ivan-operator/test
A='{"provider":"webchat","webchat":"duckai","model":"","profile":"openai","timeoutSec":150}'
memok(){ while a=$(awk '/MemAvailable/{print int($2/1048576)}' /proc/meminfo); [ $a -lt 3 ]; do echo "MEM LOW ${a}G $(date +%T)"; sleep 60; done; echo "mem ${a}G $(date +%T)"; }
T2=$(grep -o 'T2="[^"]*"' pipeline5.sh | head -1 | cut -c5- | sed 's/"$//')
X=$(python3 -c "import json,sys;d=json.loads(sys.argv[1]);d.update({'uiMode':'dom','maxSteps':40,'maxMinutes':15});print(json.dumps(d))" "$A")
memok; echo "=== forms validate $(date +%T)"; TAG=dom_114v PAGES="validate" ./forms/run_forms.sh dom "$A" 2>&1 | grep -a "^dom\|===" 
memok; echo "=== otp word $(date +%T)"; T0=$(date +%s); ./run_scenario.sh otp_word_114b "$T2" 1000 "$X" | tail -1 | cut -c1-400; echo "time $(( $(date +%s)-T0 ))s"
memok; echo OTP114B_DONE
