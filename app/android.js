'use strict';
// Android: adb/fastboot из официальных Google SDK Platform-Tools (скачиваются по кнопке, не входят в установщик).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const IS_WIN = process.platform === 'win32';
let BASE = null;
function init(dataDir) { BASE = path.join(dataDir, 'platform-tools'); }
function bin(name) {
  const local = BASE && path.join(BASE, 'platform-tools', name + (IS_WIN ? '.exe' : ''));
  if (local && fs.existsSync(local)) return local;
  try { execFileSync(IS_WIN ? 'where' : 'sh', IS_WIN ? [name] : ['-c', 'command -v ' + name], { stdio: 'pipe' }); return name; } catch { return null; }
}
function binDir() { const p = BASE && path.join(BASE, 'platform-tools'); return p && fs.existsSync(p) ? p : null; }
async function install(download, onProgress) {
  const url = `https://dl.google.com/android/repository/platform-tools-latest-${IS_WIN ? 'windows' : 'linux'}.zip`;
  fs.mkdirSync(BASE, { recursive: true });
  const zip = await download(url, path.join(BASE, 'pt.zip'), onProgress, null, 'adb/fastboot (Google Platform-Tools)');
  if (IS_WIN) execFileSync('tar', ['-xf', zip, '-C', BASE]);
  else { try { execFileSync('unzip', ['-oq', zip, '-d', BASE]); } catch { execFileSync('python3', ['-m', 'zipfile', '-e', zip, BASE]); } for (const f of ['adb', 'fastboot']) try { fs.chmodSync(path.join(BASE, 'platform-tools', f), 0o755); } catch {} }
  fs.unlinkSync(zip);
  return bin('adb');
}
function run(tool, args, timeoutMs = 120000) {
  return new Promise((res) => {
    const b = bin(tool); if (!b) return res({ code: -1, output: `${tool} не найден. Нажми «Установить adb/fastboot» в настройках или действие {"type":"android_setup"}.` });
    execFile(b, args, { timeout: timeoutMs, maxBuffer: 8 << 20, windowsHide: true }, (e, out, err) => res({ code: e ? (e.code ?? -1) : 0, output: (String(out) + String(err)).slice(-6000) }));
  });
}
async function devices() {
  const a = await run('adb', ['devices', '-l'], 10000), f = await run('fastboot', ['devices'], 10000);
  const list = [];
  for (const l of a.output.split('\n').slice(1)) { const m = /^(\S+)\s+(device|unauthorized|recovery|sideload|offline)(.*)$/.exec(l.trim()); if (m) list.push({ serial: m[1], state: m[2], info: m[3].trim() }); }
  for (const l of f.output.split('\n')) { const m = /^(\S+)\s+fastboot/.exec(l.trim()); if (m) list.push({ serial: m[1], state: 'fastboot' }); }
  return { available: !!bin('adb'), list };
}
// Опасные операции: прошивка, стирание, разблокировка загрузчика, sideload, сброс
const RISKY = /\b(flash|flashall|flashing|erase|format|wipe|-w\b|update|oem\s+(unlock|lock|edl)|set_active|boot\s|sideload|reboot\s+edl|factory|recovery\s+--wipe)|\brm\s+-r|\bpm\s+(clear|uninstall)|\bdd\s/i;
function riskOf(tool, args) {
  const s = args.join(' ');
  if (tool === 'fastboot' && !/^(devices|getvar|reboot(\s+(bootloader|fastboot))?$|--version|help)/.test(s)) return 'Команда fastboot меняет разделы/загрузчик. Это может СТЕРЕТЬ все данные или превратить устройство в «кирпич». Проверь, что образ подходит именно для этой модели и версии, батарея > 50%, кабель надёжный (на Windows лучше порт USB 2.0).';
  if (RISKY.test(s)) return 'Команда может удалить данные на устройстве или повредить прошивку.';
  return null;
}
module.exports = { init, bin, binDir, install, run, devices, riskOf };
