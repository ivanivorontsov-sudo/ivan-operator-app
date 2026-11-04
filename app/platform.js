'use strict';
// Платформенный слой: снимок экрана и ввод (мышь/клавиатура) в ФИЗИЧЕСКИХ пикселях.
const { spawn, execFile, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, screen, desktopCapturer, nativeImage } = require('electron');

const IS_WIN = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1.2.6: кэш — раньше каждый вызов запускал процесс (≈4 мс на клик/снимок)
const HAS = new Map();
function has(cmd) { if (!HAS.has(cmd)) HAS.set(cmd, hasRaw(cmd)); return HAS.get(cmd); }
function hasRaw(cmd) {
  if (IS_WIN) { try { execFileSync('where', [cmd], { stdio: 'pipe', windowsHide: true, timeout: 5000 }); return true; } catch { return false; } }
  try { execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'pipe' }); return true; } catch { return false; }
}
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: opts.timeout || 20000, maxBuffer: 32 << 20, encoding: opts.encoding || 'utf8', env: opts.env || process.env }, (err, stdout, stderr) =>
      resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, stdout, stderr: stderr || (err ? String(err.message) : '') }));
  });
}
function helperPath(name) {
  // в собранном приложении helpers распакованы из asar
  const p = path.join(__dirname, '..', 'helpers', name);
  return p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
}

// ---------------- Windows: постоянный PowerShell-помощник (PMv2 DPI, SendInput, UIA) ----------------
class WinHelper {
  constructor() { this.proc = null; this.queue = []; this.buf = ''; }
  start() {
    if (this.proc) return;
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-File', helperPath('win_helper.ps1')], { windowsHide: true });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
        if (!line.startsWith('{')) continue;
        const q = this.queue.shift();
        if (q) { try { q.resolve(JSON.parse(line)); } catch (e) { q.reject(e); } }
      }
    });
    this.proc.stderr.on('data', (d) => console.error('[win_helper]', String(d)));
    this.proc.on('exit', () => { this.proc = null; for (const q of this.queue.splice(0)) q.reject(new Error('Помощник Windows завершился')); });
  }
  call(obj, timeout = 30000) {
    this.start();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Помощник Windows не ответил')), timeout);
      this.queue.push({ resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
      this.proc.stdin.write(JSON.stringify(obj) + '\n');
    });
  }
  stop() { if (this.proc) this.proc.kill(); }
}
// Нативный помощник iop_win.exe (C, WinAPI): работает и в Windows, и в Wine, где нет PowerShell/UIA.
class NativeHelper extends WinHelper {
  start() {
    if (this.proc) return;
    this.proc = spawn(helperPath(path.join('native', 'iop_win.exe')), [], { windowsHide: true });
    this.buf = ''; this.ready = false;
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (d) => {
      this.buf += d; let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
        if (!line.startsWith('{') || line.includes('"ready"')) continue;
        const q = this.queue.shift(); if (q) { try { q.resolve(JSON.parse(line)); } catch (e) { q.reject(e); } }
      }
    });
    this.proc.on('error', () => {});
    this.proc.on('exit', () => { this.proc = null; for (const q of this.queue.splice(0)) q.reject(new Error('Нативный помощник завершился')); });
  }
  raw(line, timeout = 30000) {
    this.start();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { reject(new Error('Нативный помощник не ответил')); try { this.proc.kill(); } catch {} }, timeout);
      this.queue.push({ resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
      this.proc.stdin.write(line.map((x) => String(x ?? '').replace(/[\t\r\n]/g, ' ')).join('\t') + '\n');
    });
  }
}
const nat = IS_WIN ? new NativeHelper() : null;
const ps = IS_WIN ? new WinHelper() : null;
// Единая точка: базовые операции — нативно; UIA/список приложений — PowerShell, если он есть
const win = IS_WIN ? {
  async call(q, timeout) {
    switch (q.cmd) {
      case 'monitors': { const r = await nat.raw(['monitors']); r.monitors = r.monitors.map((m, i) => ({ ...m, index: i, id: String(i) })); return r; }
      case 'screenshot': {
        const f = path.join(os.tmpdir(), `iop-shot-${process.pid}.raw`);
        const r = await nat.raw(['shot', q.x, q.y, q.w, q.h, f]);
        if (!r.ok) return r;
        return { ok: true, bgra: fs.readFileSync(f), w: r.w, h: r.h };
      }
      case 'mouse': return nat.raw(['mouse', q.action, q.x, q.y, q.x2 ?? 0, q.y2 ?? 0, q.amount || 0]);
      case 'type': return nat.raw(['type', String(q.text).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t')], 120000);
      case 'key': { const r = await nat.raw(['key', q.keys]); if (!r.ok) throw new Error(r.error); return r; }
      case 'cursor': return nat.raw(['cursor']);
      case 'active': return nat.raw(['active']);
      case 'windows': { const r = await nat.raw(['windows']); return { ok: true, windows: (r.windows || []).filter((w) => !w.min).map((w) => w.title) }; }
      case 'focus': return nat.raw(['focus', q.title]);
      case 'open':
        if (hasPowerShell()) { try { return await ps.call(q, timeout); } catch {} }
        { const r = await nat.raw(['open', q.name, q.args || '']); return { ok: r.ok, launched: q.name, note: r.ok ? '' : 'Не удалось открыть (код ' + r.code + '). Попробуй полный путь к .exe или команду run.' }; }
      default:
        if (!hasPowerShell()) return { ok: false, elements: [], apps: [], error: IS_WINE ? 'Wine: UI Automation недоступен' : 'PowerShell недоступен' };
        return ps.call(q, timeout);
    }
  },
  stop() { nat.stop(); ps.stop(); },
} : null;

// ---------------- Сведения о сеансе ----------------
function sessionInfo() {
  if (IS_WIN) return { kind: 'windows', wayland: false };
  const type = (process.env.XDG_SESSION_TYPE || '').toLowerCase();
  const wayland = type === 'wayland' || (!!process.env.WAYLAND_DISPLAY && !process.env.DISPLAY);
  return { kind: wayland ? 'wayland' : 'x11', wayland, desktop: process.env.XDG_CURRENT_DESKTOP || '', display: process.env.DISPLAY || '' };
}

// 1.3.0: Wayland «из коробки» — портал xdg-desktop-portal для снимков, ydotool(+ydotoold) для мыши/клавиатуры
function ydotoolSocket() { return process.env.YDOTOOL_SOCKET || path.join(process.env.XDG_RUNTIME_DIR || '/tmp', '.ydotool_socket'); }
function uinputOk() { try { fs.accessSync('/dev/uinput', fs.constants.W_OK); return true; } catch { return false; } }
let ydStarted = false;
async function ensureYdotoold() {
  if (IS_WIN || !has('ydotool')) return false;
  const sock = ydotoolSocket(); process.env.YDOTOOL_SOCKET = sock;
  if (fs.existsSync(sock) || fs.existsSync('/tmp/.ydotool_socket')) { if (!fs.existsSync(sock)) process.env.YDOTOOL_SOCKET = '/tmp/.ydotool_socket'; return true; }
  if (ydStarted || !has('ydotoold') || !uinputOk()) return false;
  ydStarted = true;
  try { const c = spawn('ydotoold', ['--socket-path=' + sock, '--socket-perm=0600'], { detached: true, stdio: 'ignore' }); c.unref(); } catch { return false; }
  for (let i = 0; i < 20 && !fs.existsSync(sock); i++) await sleep(150);
  return fs.existsSync(sock);
}
function waylandStatus() {
  const s = sessionInfo(); if (!s.wayland) return { needed: false, ready: true, missing: [] };
  const portal = has('python3') && (() => { try { execFileSync('python3', ['-c', 'import gi; gi.require_version("Gio","2.0")'], { stdio: 'pipe', timeout: 5000 }); return true; } catch { return false; } })();
  const shot = portal || has('gnome-screenshot') || has('grim') || has('spectacle');
  const input = has('ydotool') && (has('ydotoold') || fs.existsSync(ydotoolSocket()) || fs.existsSync('/tmp/.ydotool_socket')) && (uinputOk() || fs.existsSync(ydotoolSocket()) || fs.existsSync('/tmp/.ydotool_socket'));
  const missing = []; if (!shot) missing.push('снимки экрана (python3-gi + xdg-desktop-portal или gnome-screenshot)'); if (!input) missing.push(has('ydotool') ? 'доступ к /dev/uinput для ydotool (запустите install.sh)' : 'ydotool');
  return { needed: true, ready: shot && input, shot, input, portal, missing };
}

// Список мониторов в физических пикселях
async function monitors() {
  if (IS_WIN) { const r = await win.call({ cmd: 'monitors' }); return r.monitors; }
  return screen.getAllDisplays().map((d, i) => ({
    index: i, id: String(d.id), primary: d.id === screen.getPrimaryDisplay().id,
    x: Math.round(d.bounds.x * d.scaleFactor), y: Math.round(d.bounds.y * d.scaleFactor),
    width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor), scale: d.scaleFactor,
  }));
}
async function pickMonitor(index) {
  const ms = await monitors();
  return ms[index] || ms.find((m) => m.primary) || ms[0];
}

// ---------------- Снимок экрана: возвращает nativeImage в физических пикселях выбранного монитора ----------------
async function screenshot(monIndex = 0) {
  const mon = await pickMonitor(monIndex);
  if (IS_WIN) {
    const r = await win.call({ cmd: 'screenshot', x: mon.x, y: mon.y, w: mon.width, h: mon.height });
    if (!r.ok) throw new Error(r.error || 'Не удалось сделать снимок');
    if (r.bgra) return { img: nativeImage.createFromBitmap(r.bgra, { width: r.w, height: r.h }), mon };
    return { img: nativeImage.createFromBuffer(Buffer.from(r.png, 'base64')), mon };
  }
  const sess = sessionInfo();
  if (!sess.wayland) {
    // X11: штатный захват Electron, без внешних программ
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: mon.width, height: mon.height } });
    let src = sources.find((s) => String(s.display_id) === mon.id) || sources[mon.index] || sources[0];
    if (src && !src.thumbnail.isEmpty() && src.thumbnail.getSize().width) return { img: src.thumbnail, mon };
    console.log('[shot] X11 desktopCapturer: пустой снимок, пробую внешние программы');
  }
  // Wayland/запасные пути
  const tmp = path.join(os.tmpdir(), `iop-shot-${process.pid}.png`);
  // 1.2.6: wlroots (Sway/Hyprland/KDE с grim): grim в разы быстрее портала (без python и D-Bus) — пробуем первым
  if (sess.wayland && !/gnome/i.test(sess.desktop || '') && has('grim')) {
    try { fs.unlinkSync(tmp); } catch {}
    const r = await run('grim', ['-t', 'png', '-l', '1', tmp], { timeout: 8000 });
    if (r.ok && fs.existsSync(tmp) && fs.statSync(tmp).size > 1000) { const img = nativeImage.createFromPath(tmp); const sz = img.getSize(); if (sz.width) return { img, mon: { ...mon, x: 0, y: 0, width: sz.width, height: sz.height } }; }
  }
  if (sess.wayland && has('python3')) {
    const r = await run('python3', [helperPath('wayland_portal.py'), '60'], { timeout: 65000 });
    const f = (r.stdout || '').trim();
    const sz = f && fs.existsSync(f) ? fs.statSync(f).size : -1; console.log('[shot] portal', r.ok, f, sz);
    if (r.ok && sz > 1000) { const img = nativeImage.createFromPath(f); try { fs.unlinkSync(f); } catch {} const s = img.getSize(); if (s.width && !img.isEmpty()) return { img, mon: { ...mon, x: 0, y: 0, width: s.width, height: s.height } }; console.log('[shot] portal: пустая картинка', s); }
  }
  const gnome = /gnome/i.test(sess.desktop || '');
  const tries = [
    ...(gnome ? [['gnome-screenshot', ['-f', tmp]]] : []), ['grim', [tmp]], ['spectacle', ['-b', '-n', '-f', '-o', tmp]], ['gnome-screenshot', ['-f', tmp]],
    ['import', ['-window', 'root', tmp]], ['scrot', ['-o', tmp]],
  ];
  for (const [c, a] of tries) {
    if (!has(c)) continue;
    try { fs.unlinkSync(tmp); } catch {}
    const r = await run(c, a, { timeout: 15000 });
    if (r.ok && fs.existsSync(tmp) && fs.statSync(tmp).size > 1000) {
      const img = nativeImage.createFromPath(tmp);
      const s = img.getSize(); if (!s.width || img.isEmpty()) { console.log('[shot]', c, 'пустая картинка'); continue; }
      return { img, mon: { ...mon, x: 0, y: 0, width: s.width, height: s.height } };
    }
  }
  throw new Error(sess.wayland
    ? 'Wayland: не удалось сделать снимок. Установите пакеты: sudo apt install python3-gi xdg-desktop-portal-gnome gnome-screenshot (или запустите install.sh) и разрешите снимки в окне GNOME.'
    : 'Не удалось сделать снимок экрана.');
}

// ---------------- Ввод ----------------
function xdo(args) { return run('xdotool', args); }
async function ydo(args) { await ensureYdotoold(); const r = await run('ydotool', args); if (!r.ok && /socket|connect/i.test(r.stderr)) throw new Error('ydotool не может подключиться к ydotoold. Запустите install.sh (настроит /dev/uinput и службу ydotoold) или: sudo ydotoold &'); return r; }
// коды клавиш Linux (input-event-codes.h) для ydotool key
const YK = { esc: 1, escape: 1, '1': 2, '2': 3, '3': 4, '4': 5, '5': 6, '6': 7, '7': 8, '8': 9, '9': 10, '0': 11, '-': 12, '=': 13, backspace: 14, tab: 15,
  q: 16, w: 17, e: 18, r: 19, t: 20, y: 21, u: 22, i: 23, o: 24, p: 25, '[': 26, ']': 27, enter: 28, return: 28, ctrl: 29, control: 29, a: 30, s: 31, d: 32, f: 33, g: 34, h: 35, j: 36, k: 37, l: 38, ';': 39, "'": 40, '`': 41,
  shift: 42, '\\': 43, z: 44, x: 45, c: 46, v: 47, b: 48, n: 49, m: 50, ',': 51, '.': 52, '/': 53, alt: 56, space: 57, capslock: 58,
  f1: 59, f2: 60, f3: 61, f4: 62, f5: 63, f6: 64, f7: 65, f8: 66, f9: 67, f10: 68, f11: 87, f12: 88, home: 102, up: 103, pageup: 104, left: 105, right: 106, end: 107, down: 108, pagedown: 109, insert: 110, delete: 111, del: 111,
  win: 125, super: 125, meta: 125, cmd: 125, menu: 127, printscreen: 99 };
function yKeyArgs(combo) {
  const codes = combo.split('+').map((k) => YK[k.trim().toLowerCase()]);
  if (codes.some((c) => c == null)) throw new Error('Неизвестная клавиша для Wayland: ' + combo);
  return [...codes.map((c) => c + ':1'), ...codes.slice().reverse().map((c) => c + ':0')];
}

const KEYMAP_X = { ctrl: 'ctrl', control: 'ctrl', alt: 'alt', shift: 'shift', win: 'super', super: 'super', cmd: 'super', meta: 'super',
  enter: 'Return', return: 'Return', esc: 'Escape', escape: 'Escape', tab: 'Tab', space: 'space', backspace: 'BackSpace', delete: 'Delete', del: 'Delete',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End', pageup: 'Prior', pagedown: 'Next', insert: 'Insert', printscreen: 'Print', menu: 'Menu' };
function xKey(combo) {
  return combo.split('+').map((k) => { const t = k.trim(); const l = t.toLowerCase(); return KEYMAP_X[l] || (/^f\d{1,2}$/.test(l) ? l.toUpperCase() : t.length === 1 ? t.toLowerCase() : t); }).join('+');
}

async function mouse(action, x, y, opts = {}) {
  // x,y — абсолютные физические координаты рабочего стола
  x = Math.round(x); y = Math.round(y);
  if (IS_WIN) return win.call({ cmd: 'mouse', action, x, y, x2: opts.x2 != null ? Math.round(opts.x2) : undefined, y2: opts.y2 != null ? Math.round(opts.y2) : undefined, amount: opts.amount || 0 });
  if (sessionInfo().wayland) {
    if (!has('ydotool')) throw new Error('В Wayland для управления мышью нужен ydotool (sudo apt install ydotool) или сеанс Xorg.');
    await ydo(['mousemove', '--absolute', '-x', String(x), '-y', String(y)]);
    const codes = { click: ['0xC0'], double_click: ['0xC0', '0xC0'], right_click: ['0xC1'], middle_click: ['0xC2'] };
    if (codes[action]) for (const c of codes[action]) await ydo(['click', c]);
    if (action === 'scroll') await ydo(['mousemove', '-w', '-x', '0', '-y', String(-(opts.amount || 3))]);
    return { ok: true };
  }
  switch (action) {
    case 'move': return xdo(['mousemove', '--sync', String(x), String(y)]);
    case 'click': return xdo(['mousemove', '--sync', String(x), String(y), 'sleep', '0.03', 'click', '1']);
    case 'double_click': return xdo(['mousemove', '--sync', String(x), String(y), 'sleep', '0.03', 'click', '--repeat', '2', '--delay', '90', '1']);
    case 'triple_click': return xdo(['mousemove', '--sync', String(x), String(y), 'sleep', '0.03', 'click', '--repeat', '3', '--delay', '90', '1']);
    case 'right_click': return xdo(['mousemove', '--sync', String(x), String(y), 'sleep', '0.03', 'click', '3']);
    case 'middle_click': return xdo(['mousemove', '--sync', String(x), String(y), 'sleep', '0.03', 'click', '2']);
    case 'drag': return xdo(['mousemove', '--sync', String(x), String(y), 'mousedown', '1', 'sleep', '0.15', 'mousemove', '--sync', String(Math.round((x + opts.x2) / 2)), String(Math.round((y + opts.y2) / 2)), 'sleep', '0.1', 'mousemove', '--sync', String(Math.round(opts.x2)), String(Math.round(opts.y2)), 'sleep', '0.15', 'mouseup', '1']);
    case 'scroll': {
      const n = Math.max(1, Math.min(30, Math.abs(opts.amount || 3)));
      return xdo(['mousemove', '--sync', String(x), String(y), 'click', '--repeat', String(n), '--delay', '40', (opts.amount || 3) > 0 ? '5' : '4']);
    }
  }
  throw new Error('Неизвестное действие мыши: ' + action);
}

async function typeText(text, viaClipboard = false) {
  if (IS_WIN) return win.call({ cmd: 'type', text, clipboard: viaClipboard }, 120000);
  if (sessionInfo().wayland) {
    // кириллица/эмодзи через ydotool type не печатаются → буфер обмена + Ctrl+V
    if (viaClipboard || /[^\x00-\x7f]/.test(text)) { const { clipboard } = require('electron'); const old = clipboard.readText(); clipboard.writeText(text); await sleep(120); await ydo(['key', ...yKeyArgs('ctrl+v')]); await sleep(200); clipboard.writeText(old); return { ok: true }; }
    return ydo(['type', '--', text]);
  }
  if (viaClipboard) {
    const { clipboard } = require('electron');
    const old = clipboard.readText(); clipboard.writeText(text); await sleep(80);
    await xdo(['key', '--clearmodifiers', 'ctrl+v']); await sleep(150); clipboard.writeText(old);
    return { ok: true };
  }
  // построчно: xdotool type надёжно печатает кириллицу и символы
  const parts = text.split('\n');
  for (let i = 0; i < parts.length; i++) {
    if (parts[i]) await run('xdotool', ['type', '--clearmodifiers', '--delay', '6', '--', parts[i]], { timeout: 120000 });
    if (i < parts.length - 1) await xdo(['key', 'Return']);
  }
  return { ok: true };
}

async function key(combo) {
  if (IS_WIN) return win.call({ cmd: 'key', keys: combo });
  if (sessionInfo().wayland) return ydo(['key', ...yKeyArgs(combo)]);
  return xdo(['key', '--clearmodifiers', xKey(combo)]);
}

async function cursorPos() {
  if (IS_WIN) { const r = await win.call({ cmd: 'cursor' }); return { x: r.x, y: r.y }; }
  const r = await xdo(['getmouselocation', '--shell']);
  const m = /X=(\d+)\s+Y=(\d+)/.exec(r.stdout || '');
  return m ? { x: +m[1], y: +m[2] } : null;
}

async function activeWindow() {
  if (IS_WIN) { try { const r = await win.call({ cmd: 'active' }); return r.title || ''; } catch { return ''; } }
  if (sessionInfo().wayland) return '';
  const r = await xdo(['getactivewindow', 'getwindowname']);
  return (r.stdout || '').trim();
}

async function listWindows() {
  if (IS_WIN) { try { const r = await win.call({ cmd: 'windows' }); return r.windows || []; } catch { return []; } }
  if (has('wmctrl')) { const r = await run('wmctrl', ['-l']); return (r.stdout || '').split('\n').filter(Boolean).map((l) => l.split(/\s+/).slice(3).join(' ')); }
  return [];
}

// Элементы интерфейса из дерева доступности (UIA на Windows, AT-SPI на Linux) — для «меток» (set-of-marks)
async function uiElements(mon) {
  try {
    if (IS_WIN) { const r = await win.call({ cmd: 'elements' }, 15000); return r.elements || []; }
    const py = has('python3') ? 'python3' : null;
    if (!py) return [];
    const r = await run(py, [helperPath('atspi_elements.py')], { timeout: 12000 });
    if (!r.ok) return [];
    return JSON.parse(r.stdout || '[]');
  } catch { return []; }
}

// Запуск приложения по имени
async function openApp(name) {
  if (IS_WIN) {
    const before = new Set(await listWindows());
    const r = await win.call({ cmd: 'open', name }, 20000);
    for (let i = 0; i < 30; i++) { await sleep(500); const nw = (await listWindows()).find((t) => !before.has(t)); if (nw) return { ...r, ok: true, window: nw }; }
    return r;
  }
  const apps = linuxApps();
  const n = name.toLowerCase();
  const hit = apps.find((a) => a.name.toLowerCase() === n) || apps.find((a) => (a.alt || '').split(/\s{2,}|\n/).some(() => (a.alt || '').includes(n)) || a.name.toLowerCase().includes(n) || a.id.toLowerCase().includes(n) || (a.exec || '').toLowerCase().split(/[\s/]/).includes(n));
  const wk = (w) => typeof w === 'string' ? w : (w.title || w.name || JSON.stringify(w));
  const before = new Set((await listWindows().catch(() => [])).map(wk));
  const cmd = hit ? hit.exec.replace(/%[a-zA-Z]/g, '').replace(/@@[a-z]*@?@?/g, '').trim() : name;
  const env = cleanEnv();
  const logf = path.join(os.tmpdir(), 'iop-launch.log');
  const out = fs.openSync(logf, 'w');
  const child = spawn('setsid', ['sh', '-c', cmd], { detached: true, stdio: ['ignore', out, out], env }); child.unref();
  // ждём появления нового окна, чтобы модель не гадала
  for (let i = 0; i < 20; i++) {
    await sleep(750);
    const now = await listWindows().catch(() => []);
    const fresh = now.map(wk).filter((w) => !before.has(w));
    if (fresh.length) return { ok: true, found: !!hit, launched: hit ? hit.name : name, window: fresh.join(' | ') };
  }
  let err = ''; try { err = fs.readFileSync(logf, 'utf8').slice(-400); } catch {}
  return { ok: true, found: !!hit, launched: hit ? hit.name : name, window: null, note: 'Окно пока не появилось (приложение может грузиться дольше).' + (err ? ' Вывод: ' + err : '') };
}

// Окружение для дочерних программ без переменных самого Electron
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(ELECTRON_|CHROME_|GOOGLE_API|ORIGINAL_XDG|APPIMAGE|APPDIR|ARGV0|OWD)/.test(k)) delete env[k];
  if (process.env.APPIMAGE && env.LD_LIBRARY_PATH) delete env.LD_LIBRARY_PATH;
  return env;
}

let _apps = null;
function linuxApps() {
  if (_apps) return _apps;
  const dirs = ['/usr/share/applications', '/usr/local/share/applications', path.join(os.homedir(), '.local/share/applications'), '/var/lib/flatpak/exports/share/applications', path.join(os.homedir(), '.local/share/flatpak/exports/share/applications')];
  const out = [];
  for (const d of dirs) {
    let files = []; try { files = fs.readdirSync(d).filter((f) => f.endsWith('.desktop')); } catch { continue; }
    for (const f of files) {
      try {
        const t = fs.readFileSync(path.join(d, f), 'utf8');
        const sec = ((/\[Desktop Entry\]([\s\S]*?)(?:\n\[|$)/.exec(t) || [])[1]) || '';
        if (/^NoDisplay=true/m.test(sec) || /^Hidden=true/m.test(sec)) continue;
        const nm = (/^Name\[ru\]=(.*)$/m.exec(sec) || /^Name=(.*)$/m.exec(sec) || [])[1]; const en = (/^Name=(.*)$/m.exec(sec) || [])[1] || ''; const gn = (/^GenericName(?:\[ru\])?=(.*)$/m.exec(sec) || [])[1] || '';
        const ex = (/^Exec=(.*)$/m.exec(sec) || [])[1];
        if (nm && ex) out.push({ id: f.replace(/\.desktop$/, ''), name: nm.trim(), alt: (en + ' ' + gn).toLowerCase(), exec: ex.trim() });
      } catch {}
    }
  }
  _apps = out; return out;
}
async function installedApps() {
  if (IS_WIN) { try { const r = await win.call({ cmd: 'apps' }, 20000); return r.apps || []; } catch { return []; } }
  return linuxApps().map((a) => a.name);
}

// Команда оболочки
// Wine: нет полноценного PowerShell/UIA → запасные пути (cmd.exe, нативный помощник)
const IS_WINE = IS_WIN && (() => { try { return fs.existsSync('C:\\windows\\system32\\winecfg.exe') || !!process.env.WINEPREFIX || require('child_process').execSync('reg query "HKCU\\Software\\Wine"', { stdio: 'pipe', windowsHide: true }) && true; } catch { return false; } })();
let psOk = null;
function hasPowerShell() {
  if (!IS_WIN) return false;
  if (psOk == null) { try { const r = require('child_process').spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Write-Output ok'], { timeout: 20000, windowsHide: true }); psOk = String(r.stdout || '').includes('ok'); } catch { psOk = false; } }
  return psOk;
}
function shellArgs(command) {
  if (!IS_WIN) return ['bash', ['-lc', command]];
  if (hasPowerShell()) return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' + command]];
  return ['cmd.exe', ['/d', '/s', '/c', command]];
}
function shellEnv(extraPath) {
  const env = cleanEnv();
  if (extraPath) env.PATH = extraPath + path.delimiter + (env.PATH || env.Path || '');
  if (!IS_WIN) { env.DEBIAN_FRONTEND = 'noninteractive'; env.SUDO_ASKPASS = env.SUDO_ASKPASS || ''; }
  return env;
}
function shellRun(command, timeoutMs = 60000, opts = {}) {
  return new Promise((resolve) => {
    const [cmd, args] = shellArgs(command);
    const p = spawn(cmd, args, { windowsHide: true, cwd: opts.cwd || os.homedir(), env: shellEnv(opts.extraPath), detached: !IS_WIN, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const killAll = () => { try { if (IS_WIN) spawn('taskkill', ['/pid', String(p.pid), '/t', '/f'], { windowsHide: true }); else process.kill(-p.pid, 'SIGKILL'); } catch { try { p.kill('SIGKILL'); } catch {} } };
    const t = setTimeout(() => { killAll(); out += '\n[прервано по таймауту ' + Math.round(timeoutMs / 1000) + ' с; для долгих процессов используй "background": true]'; }, timeoutMs);
    if (opts.signal) { if (opts.signal.aborted) killAll(); else opts.signal.addEventListener('abort', () => { killAll(); out += '\n[остановлено Иваном]'; }, { once: true }); }
    p.stdout.on('data', (d) => { out += d; if (out.length > 200000) out = out.slice(-200000); });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => {
      clearTimeout(t);
      if (!IS_WIN && /sudo: a (terminal|password) is required|sudo: .*no tty/i.test(out)) out += '\n[подсказка: sudo требует пароль. Используй pkexec (графический запрос пароля) или попроси Ивана (ask_user). Для пользовательских установок без root: pip install --user, npm без -g, ~/.local/bin]';
      resolve({ code, output: out.length > 6000 ? out.slice(0, 2500) + '\n…[обрезано]…\n' + out.slice(-3000) : out });
    });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, output: String(e.message) }); });
  });
}
function shellBackground(command) {
  const log = path.join(os.tmpdir(), `iop-bg-${Date.now()}.log`);
  const fd = fs.openSync(log, 'a');
  const [cmd, args] = shellArgs(command);
  const p = spawn(cmd, args, { windowsHide: true, cwd: os.homedir(), env: shellEnv(), detached: true, stdio: ['ignore', fd, fd] });
  p.unref(); fs.closeSync(fd);
  return { pid: p.pid, log };
}

function toolsAvailable() {
  if (IS_WIN) return ['powershell', 'SendInput', 'UI Automation'];
  return ['xdotool', 'wmctrl', 'gtk-launch', 'xdg-open', 'ydotool', 'grim', 'python3', 'firefox', 'firefox-esr', 'chromium', 'google-chrome', 'libreoffice', 'nautilus', 'gedit', 'gnome-text-editor', 'mousepad', 'xfce4-terminal', 'gnome-terminal', 'konsole'].filter(has);
}

module.exports = { IS_WIN, sessionInfo, waylandStatus, ensureYdotoold, yKeyArgs, monitors, pickMonitor, screenshot, mouse, typeText, key, cursorPos, activeWindow, listWindows, uiElements, openApp, installedApps, shellRun, shellBackground, IS_WINE, hasPowerShell, toolsAvailable, has, sleep, stop: () => win && win.stop() };
