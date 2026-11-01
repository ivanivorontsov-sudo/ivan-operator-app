'use strict';
// Универсальный исполнитель ОС: намерение → команда для Windows (PowerShell), Linux (bash) или macOS (zsh/bash).
// Идея слоя: как shelljs / cross-env / python shutil — одна операция, разные системы. Аргументы всегда экранируются.
const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";            // POSIX
const psq = (s) => "'" + String(s).replace(/'/g, "''") + "'";               // PowerShell
const need = (a, ...k) => { for (const x of k) if (a[x] == null || a[x] === '') throw new Error(`Нужен параметр «${x}»`); };
const int = (v, d) => { if (v == null || v === '') { if (d != null) return d; throw new Error('Нужно число'); } if (!/^\d+$/.test(String(v).trim())) throw new Error('Нужно неотрицательное целое число'); const n = parseInt(v, 10); if (!Number.isFinite(n) || n < 0) { if (d != null) return d; throw new Error('Нужно неотрицательное число'); } return n; };

const INTENTS = {
  list_dir: { args: ['path'], desc: 'Список файлов', linux: (a) => `ls -la ${shq(a.path || '.')}`, darwin: (a) => `ls -la ${shq(a.path || '.')}`, win32: (a) => `Get-ChildItem -Force -LiteralPath ${psq(a.path || '.')} | Format-Table Mode,LastWriteTime,Length,Name -AutoSize` },
  make_dir: { args: ['path'], desc: 'Создать папку', check: (a) => need(a, 'path'), linux: (a) => `mkdir -p ${shq(a.path)}`, darwin: (a) => `mkdir -p ${shq(a.path)}`, win32: (a) => `New-Item -ItemType Directory -Force -Path ${psq(a.path)} | Out-Null` },
  remove_file: { args: ['path'], desc: 'Удалить файл', check: (a) => need(a, 'path'), linux: (a) => `rm -f -- ${shq(a.path)}`, darwin: (a) => `rm -f -- ${shq(a.path)}`, win32: (a) => `Remove-Item -Force -LiteralPath ${psq(a.path)}` },
  remove_dir: { args: ['path'], desc: 'Удалить папку целиком', check: (a) => need(a, 'path'), linux: (a) => `rm -r -- ${shq(a.path)}`, darwin: (a) => `rm -r -- ${shq(a.path)}`, win32: (a) => `Remove-Item -Recurse -LiteralPath ${psq(a.path)}` },
  copy: { args: ['from', 'to'], desc: 'Копировать', check: (a) => need(a, 'from', 'to'), linux: (a) => `cp -r -- ${shq(a.from)} ${shq(a.to)}`, darwin: (a) => `cp -R ${shq(a.from)} ${shq(a.to)}`, win32: (a) => `Copy-Item -Recurse -Force -LiteralPath ${psq(a.from)} -Destination ${psq(a.to)}` },
  move: { args: ['from', 'to'], desc: 'Переместить/переименовать', check: (a) => need(a, 'from', 'to'), linux: (a) => `mv -- ${shq(a.from)} ${shq(a.to)}`, darwin: (a) => `mv ${shq(a.from)} ${shq(a.to)}`, win32: (a) => `Move-Item -Force -LiteralPath ${psq(a.from)} -Destination ${psq(a.to)}` },
  read_file: { args: ['path', 'lines'], desc: 'Показать файл', check: (a) => need(a, 'path'), linux: (a) => `head -n ${int(a.lines, 200)} -- ${shq(a.path)}`, darwin: (a) => `head -n ${int(a.lines, 200)} ${shq(a.path)}`, win32: (a) => `Get-Content -TotalCount ${int(a.lines, 200)} -LiteralPath ${psq(a.path)}` },
  find_files: { args: ['path', 'name'], desc: 'Найти файлы по имени', check: (a) => need(a, 'name'), linux: (a) => `find ${shq(a.path || '.')} -iname ${shq(a.name)} 2>/dev/null | head -n 200`, darwin: (a) => `find ${shq(a.path || '.')} -iname ${shq(a.name)} 2>/dev/null | head -n 200`, win32: (a) => `Get-ChildItem -Recurse -ErrorAction SilentlyContinue -Path ${psq(a.path || '.')} -Filter ${psq(a.name)} | Select-Object -First 200 -ExpandProperty FullName` },
  search_text: { args: ['path', 'text'], desc: 'Найти текст в файлах', check: (a) => need(a, 'text'), linux: (a) => `grep -rIn --exclude-dir=node_modules --exclude-dir=.git -- ${shq(a.text)} ${shq(a.path || '.')} | head -n 200`, darwin: (a) => `grep -rIn --exclude-dir=node_modules --exclude-dir=.git -- ${shq(a.text)} ${shq(a.path || '.')} | head -n 200`, win32: (a) => `Get-ChildItem -Recurse -File -Path ${psq(a.path || '.')} | Select-String -SimpleMatch -Pattern ${psq(a.text)} | Select-Object -First 200 | ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line)" }` },
  open: { args: ['target'], desc: 'Открыть файл/папку/адрес программой по умолчанию', check: (a) => need(a, 'target'), linux: (a) => `xdg-open ${shq(a.target)} >/dev/null 2>&1 &`, darwin: (a) => `open ${shq(a.target)}`, win32: (a) => `Start-Process ${psq(a.target)}` },
  which: { args: ['name'], desc: 'Где программа', check: (a) => need(a, 'name'), linux: (a) => `command -v ${shq(a.name)}`, darwin: (a) => `command -v ${shq(a.name)}`, win32: (a) => `(Get-Command ${psq(a.name)} -ErrorAction SilentlyContinue).Source` },
  env_get: { args: ['name'], desc: 'Переменная окружения', check: (a) => { need(a, 'name'); if (!/^\w+$/.test(a.name)) throw new Error('Неверное имя переменной'); }, linux: (a) => `printenv ${a.name}`, darwin: (a) => `printenv ${a.name}`, win32: (a) => `$env:${a.name}` },
  processes: { args: ['name'], desc: 'Список процессов', linux: (a) => a.name ? `ps aux | grep -i -- ${shq(a.name)} | grep -v grep` : 'ps aux --sort=-%mem | head -n 30', darwin: (a) => a.name ? `ps aux | grep -i -- ${shq(a.name)} | grep -v grep` : 'ps aux -m | head -n 30', win32: (a) => a.name ? `Get-Process -Name ${psq('*' + a.name + '*')} -ErrorAction SilentlyContinue | Format-Table Id,ProcessName,WS -AutoSize` : 'Get-Process | Sort-Object WS -Descending | Select-Object -First 30 Id,ProcessName,WS | Format-Table -AutoSize' },
  kill_process: { args: ['pid'], desc: 'Завершить процесс по PID', check: (a) => int(a.pid), linux: (a) => `kill ${int(a.pid)}`, darwin: (a) => `kill ${int(a.pid)}`, win32: (a) => `Stop-Process -Id ${int(a.pid)}` },
  disk_free: { args: [], desc: 'Свободное место', linux: () => 'df -h', darwin: () => 'df -h', win32: () => 'Get-PSDrive -PSProvider FileSystem | Format-Table Name,@{n="FreeGB";e={[math]::Round($_.Free/1GB,1)}},@{n="UsedGB";e={[math]::Round($_.Used/1GB,1)}} -AutoSize' },
  mem_info: { args: [], desc: 'Память', linux: () => 'free -h', darwin: () => 'vm_stat; sysctl hw.memsize', win32: () => 'Get-CimInstance Win32_OperatingSystem | Select-Object @{n="TotalGB";e={[math]::Round($_.TotalVisibleMemorySize/1MB,1)}},@{n="FreeGB";e={[math]::Round($_.FreePhysicalMemory/1MB,1)}}' },
  os_info: { args: [], desc: 'Сведения о системе', linux: () => 'uname -a; cat /etc/os-release 2>/dev/null | head -n 4', darwin: () => 'sw_vers; uname -a', win32: () => 'Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,OSArchitecture' },
  net_check: { args: ['host'], desc: 'Проверка связи', linux: (a) => `ping -c 3 ${shq(a.host || '1.1.1.1')}`, darwin: (a) => `ping -c 3 ${shq(a.host || '1.1.1.1')}`, win32: (a) => `Test-Connection -Count 3 ${psq(a.host || '1.1.1.1')}` },
  download: { args: ['url', 'to'], desc: 'Скачать файл', check: (a) => { need(a, 'url', 'to'); if (!/^https?:\/\//i.test(a.url)) throw new Error('Только http(s)'); }, linux: (a) => `curl -fL --retry 2 -o ${shq(a.to)} ${shq(a.url)}`, darwin: (a) => `curl -fL --retry 2 -o ${shq(a.to)} ${shq(a.url)}`, win32: (a) => `Invoke-WebRequest -UseBasicParsing -Uri ${psq(a.url)} -OutFile ${psq(a.to)}` },
  unzip: { args: ['path', 'to'], desc: 'Распаковать zip', check: (a) => need(a, 'path', 'to'), linux: (a) => `unzip -o ${shq(a.path)} -d ${shq(a.to)}`, darwin: (a) => `ditto -x -k ${shq(a.path)} ${shq(a.to)}`, win32: (a) => `Expand-Archive -Force -LiteralPath ${psq(a.path)} -DestinationPath ${psq(a.to)}` },
  zip: { args: ['path', 'to'], desc: 'Упаковать в zip', check: (a) => need(a, 'path', 'to'), linux: (a) => `zip -r ${shq(a.to)} ${shq(a.path)}`, darwin: (a) => `ditto -c -k --keepParent ${shq(a.path)} ${shq(a.to)}`, win32: (a) => `Compress-Archive -Force -Path ${psq(a.path)} -DestinationPath ${psq(a.to)}` },
  current_dir: { args: [], desc: 'Текущая папка', linux: () => 'pwd', darwin: () => 'pwd', win32: () => '(Get-Location).Path' },
  home_dir: { args: [], desc: 'Домашняя папка', linux: () => 'echo "$HOME"', darwin: () => 'echo "$HOME"', win32: () => '$env:USERPROFILE' },
  run_program: { args: ['program', 'args'], desc: 'Запустить программу с аргументами', check: (a) => need(a, 'program'), linux: (a) => [a.program, ...[].concat(a.args || [])].map(shq).join(' '), darwin: (a) => [a.program, ...[].concat(a.args || [])].map(shq).join(' '), win32: (a) => '& ' + [a.program, ...[].concat(a.args || [])].map(psq).join(' ') },
};
function osName(p = process.platform) { return p === 'win32' ? 'win32' : p === 'darwin' ? 'darwin' : 'linux'; }
function build(intent, args = {}, platform = process.platform) {
  const it = INTENTS[intent]; if (!it) throw new Error(`Неизвестное намерение «${intent}». Доступны: ${Object.keys(INTENTS).join(', ')}`);
  if (it.check) it.check(args); const os = osName(platform);
  return { os, shell: os === 'win32' ? 'powershell' : os === 'darwin' ? 'zsh' : 'bash', command: it[os](args) };
}
// полная строка запуска для child_process (shell:false)
function argv(intent, args, platform = process.platform) {
  const b = build(intent, args, platform);
  return b.os === 'win32' ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', b.command]] : [b.os === 'darwin' ? '/bin/zsh' : '/bin/bash', ['-c', b.command]];
}
// Перевод короткой POSIX-команды в PowerShell для частых случаев (модель часто пишет ls/cat/rm на Windows)
function translate(cmd, platform = process.platform) {
  if (osName(platform) !== 'win32') return cmd;
  const m = String(cmd).trim().match(/^(\S+)\s*(.*)$/); if (!m) return cmd;
  const map = { ls: 'Get-ChildItem', cat: 'Get-Content', rm: 'Remove-Item', cp: 'Copy-Item', mv: 'Move-Item', pwd: 'Get-Location', mkdir: 'New-Item -ItemType Directory -Force -Path', touch: 'New-Item -ItemType File -Force -Path', which: 'Get-Command', grep: 'Select-String -Pattern', clear: 'Clear-Host' };
  if (!map[m[1]]) return cmd;
  let rest = m[2].replace(/(^|\s)-(rf|fr|r|f|la|al|l|a|p)(?=\s|$)/g, (s, sp, f) => (/r/.test(f) && /^(rm|cp)$/.test(m[1])) ? sp + '-Recurse' + (/f/.test(f) ? ' -Force' : '') : '');
  return (map[m[1]] + ' ' + rest.trim()).trim();
}
module.exports = { INTENTS, build, argv, translate, osName, shq, psq, list: () => Object.entries(INTENTS).map(([k, v]) => ({ intent: k, args: v.args, desc: v.desc })) };
