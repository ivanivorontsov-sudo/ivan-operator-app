#!/bin/bash
# Мок-тесты прикрепления снимка: «+»-меню, скрепка (динамический input), скрытый input, paste, страница без загрузки (провал → текст)
R=$(cd "$(dirname "$0")/../.." && pwd); "$R/test/sandbox.sh" start >/dev/null 2>&1; fail=0
for p in plus clip hidden paste none; do
  out=$(sudo -u ivtest -H env ONLY=$p DISPLAY=:77 HOME=/home/ivtest timeout 60 nice -n 10 prlimit --nofile=4096 --core=0 "$R/node_modules/.bin/electron" --no-sandbox "$R/test/attach/run.js" 2>&1 | grep -a RESULT)
  want=true; [ $p = none ] && want=false
  if echo "$out" | grep -q "\"$p\":{\"ok\":$want"; then echo "PASS $p"; else echo "FAIL $p: $out"; fail=1; fi
done; exit $fail
