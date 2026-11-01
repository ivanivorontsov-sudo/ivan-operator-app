'use strict';
// Полное управление браузером через Playwright (Apache-2.0): переход по адресу, клик по тексту, ввод, чтение страницы.
// Используется установленный Chrome/Edge/Chromium (браузер не скачивается). Окно видно на экране, поэтому
// скриншотный режим продолжает работать параллельно.
const fs = require('fs');
const path = require('path');
const IS_WIN = process.platform === 'win32';

let pw = null, ctx = null, page = null;

function findBrowser() {
  const c = IS_WIN
    ? [process.env['ProgramFiles'] + '\\Google\\Chrome\\Application\\chrome.exe', process.env['ProgramFiles(x86)'] + '\\Google\\Chrome\\Application\\chrome.exe', process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe', process.env['ProgramFiles(x86)'] + '\\Microsoft\\Edge\\Application\\msedge.exe', process.env['ProgramFiles'] + '\\Microsoft\\Edge\\Application\\msedge.exe']
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium', '/usr/bin/brave-browser'];
  return c.find((p) => p && fs.existsSync(p)) || null;
}

// Скрытые (стилизованные) флажки/переключатели: input невидим, видна подпись или div-обёртка.
// Пробуем кликнуть по <label>, иначе ставим checked через JS и шлём события input/change/click.
async function toggleHidden(loc, want = true) {
  return loc.evaluate((el, want) => {
    if (!el || !/^(checkbox|radio)$/.test(el.type)) return false;
    if (el.checked === want) return true;
    const lab = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label') || el.parentElement;
    if (lab) { lab.click(); if (el.checked === want) return true; }
    el.click(); if (el.checked === want) return true;
    el.checked = want; for (const ev of ['input', 'change']) el.dispatchEvent(new Event(ev, { bubbles: true }));
    return el.checked === want;
  }, want).catch(() => false);
}

// Пользователь сам закрыл окно браузера: НЕ перезапускаем его автоматически (иначе окно «воскресает» в цикле)
let userClosed = false, closingByUs = false, proxyServer = '';
function setProxy(p) { const v = String(p || '').trim().replace(/^socks:/, 'socks5:'); if (v !== proxyServer) { proxyServer = v; if (ctx) close().catch(() => {}); } }
function closedError() { const e = new Error('Браузер закрыт вами. Автоматически заново его не открываю. Чтобы продолжить, запустите задачу ещё раз или напишите «продолжай».'); e.code = 'BROWSER_CLOSED'; return e; }
let stopped = false;
function stoppedError() { const e = new Error('Остановлено: браузер не запускаю до новой задачи.'); e.code = 'BROWSER_CLOSED'; e.stopped = true; return e; }
function reset() { userClosed = false; stopped = false; }
// Стоп: закрыть Chrome и запретить любой (повторный) запуск до новой задачи
// 1.2.0: Стоп за доли секунды — мягкое закрытие (успевает сохранить куки) не дольше 400 мс, затем принудительно убиваем процесс профиля
let profileDir = '';
function killProfile() {
  if (!profileDir) return;
  const cp = require('child_process');
  try {
    if (IS_WIN) cp.spawn('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${profileDir.replace(/'/g, "''")}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], { stdio: 'ignore', windowsHide: true });
    else cp.spawn('pkill', ['-KILL', '-f', '--', 'user-data-dir=' + profileDir], { stdio: 'ignore' });
  } catch {}
}
async function stopAll() {
  stopped = true; if (!ctx) return;
  const c = ctx; const t = new Promise((r) => setTimeout(() => r('slow'), 400));
  const r = await Promise.race([close().then(() => 'ok'), t]);
  if (r === 'slow') { killProfile(); ctx = null; page = null; }
  return r;
}
async function ensure(dataDir) {
  if (stopped) throw stoppedError();
  const p = await _ensure(dataDir);
  if (stopped) { await close(); throw stoppedError(); }
  return p;
}
async function _ensure(dataDir) {
  if (page && !page.isClosed()) return page;
  if (userClosed) throw closedError();
  if (ctx) { const ps = ctx.pages().filter((p) => !p.isClosed()); if (ps.length) return (page = ps[ps.length - 1]); closingByUs = true; try { await ctx.close(); } catch {} closingByUs = false; ctx = null; userClosed = true; throw closedError(); }
  pw = pw || require('playwright-core');
  const exe = findBrowser();
  if (!exe) throw new Error('Не найден Chrome/Chromium/Edge. Установи браузер (Linux: apt install chromium; Windows: Edge уже есть).');
  const env = { ...process.env }; for (const k of Object.keys(env)) if (/^(ELECTRON_|CHROME_)/.test(k)) delete env[k];
  profileDir = path.join(dataDir, 'browser-profile');
  // профиль постоянный и никогда не стирается: куки, localStorage, IndexedDB сохраняются между запусками
  ctx = await pw.chromium.launchPersistentContext(profileDir, {
    executablePath: exe, headless: false, viewport: null, env, locale: 'ru-RU', ...(proxyServer ? { proxy: { server: proxyServer, bypass: 'localhost,127.0.0.1' } } : {}),
    args: ['--start-maximized', '--no-first-run', '--no-default-browser-check', '--force-renderer-accessibility'],
  });
  ctx.on('page', (p) => { page = p; });
  ctx.on('close', () => { if (!closingByUs) userClosed = true; ctx = null; page = null; });
  ctx.on('page', (p) => p.on('close', () => { if (!closingByUs && ctx && !ctx.pages().some((x) => !x.isClosed())) userClosed = true; }));
  page = ctx.pages()[0] || await ctx.newPage();
  return page;
}

// Компактный список интерактивных элементов: [n] роль «имя»
async function outline(p, limit = 60, all = false) {
  try {
    const items = await p.evaluate(([limit, all]) => {
      const out = []; const sel = 'a[href],button,input,textarea,select,[role=button],[role=link],[role=textbox],[contenteditable=true],[role=tab],[role=menuitem],[role=combobox],[role=option],[role=checkbox],[role=radio]';
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4 || (!all && (r.bottom < 0 || r.top > innerHeight))) continue;
        const st = getComputedStyle(el); if (st.visibility === 'hidden' || st.display === 'none') continue;
        const name = (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 50);
        const role = el.getAttribute('role') || (el.isContentEditable ? 'textbox' : el.tagName.toLowerCase());
        let lab = ''; try { if (el.labels && el.labels[0]) lab = el.labels[0].innerText.trim().replace(/\s+/g, ' ').slice(0, 50); } catch {}
        const sel2 = el.id ? '#' + el.id : (el.name ? `[name="${el.name}"]` + (el.type === 'radio' || el.type === 'checkbox' ? `[value="${el.value}"]` : '') : '');
        let extra = '';
        if (el.tagName === 'SELECT') extra = ' опции: ' + [...el.options].map((o) => o.text.trim()).slice(0, 12).join(' | ');
        if (el.type === 'checkbox' || el.type === 'radio') extra = el.checked ? ' [отмечено]' : ' [не отмечено]';
        if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !/checkbox|radio|submit|button|file/.test(el.type) && el.value) extra = ` значение=«${el.value.slice(0, 40)}»`;
        const inv = el.value && el.matches && el.matches(':invalid') ? ' ОШИБКА:' + (el.validationMessage || '').slice(0, 60) : '';
        out.push(`${role}${el.type && el.tagName === 'INPUT' ? ':' + el.type : ''} «${lab || name}»${sel2 ? ' ' + sel2 : ''}${extra}${inv}`);
        if (out.length >= limit) break;
      }
      return out;
    }, [limit, all]);
    const msgs = await p.evaluate(() => { const seen = new Set(); const out = [];
      for (const el of document.querySelectorAll('h1,h2,[role=alert],[role=status],[aria-live],.err,.error,.errors,[class*=error],[class*=invalid],.alert,.message,.notice')) {
        const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue; const st = getComputedStyle(el); if (st.visibility === 'hidden' || st.display === 'none') continue;
        const t = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 200); if (t && !seen.has(t)) { seen.add(t); out.push(t); } if (out.length >= 8) break; }
      return out; }).catch(() => []);
    return items.map((t, i) => `[${i + 1}] ${t}`).join('\n') + (msgs.length ? '\nТЕКСТ/СООБЩЕНИЯ НА СТРАНИЦЕ (заголовки, ошибки — читай внимательно): ' + msgs.map((m) => '«' + m + '»').join(' ') : '');
  } catch { return ''; }
}


async function dismissOverlays(p) {
  const texts = [
    'Accept all', 'Accept All', 'Accept', 'I agree', 'Agree', 'Allow all', 'Allow All', 'Got it', 'OK', 'Okay',
    'Продолжить', 'Принять', 'Принять все', 'Согласен', 'Согласна', 'Хорошо', 'Понятно', 'Разрешить',
    'Принять и продолжить', 'Agree and continue', 'Continue', 'Allow', 'Close', 'Закрыть',
    'Только необходимые', 'Necessary only', 'Reject all', 'Отклонить все'
  ];
  const clicked = [];
  // cookie / consent buttons by text
  for (const tx of texts) {
    try {
      const loc = p.getByRole('button', { name: new RegExp('^' + tx.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') })
        .or(p.getByText(tx, { exact: true }));
      const n = await loc.count();
      for (let i = 0; i < Math.min(n, 3); i++) {
        const el = loc.nth(i);
        if (await el.isVisible().catch(() => false)) {
          await el.click({ timeout: 1500 }).catch(() => {});
          clicked.push(tx);
          await p.waitForTimeout(400);
        }
      }
    } catch {}
  }
  // common cookie frameworks
  for (const sel of [
    '#onetrust-accept-btn-handler', 'button#accept-cookie', '[data-testid="cookie-policy-dialog-accept-button"]',
    'button[aria-label*="Accept"]', 'button[aria-label*="Принять"]', '[id*="cookie"] button', '[class*="cookie"] button',
    '[class*="consent"] button', 'div[role=dialog] button'
  ]) {
    try {
      const loc = p.locator(sel).first();
      if (await loc.isVisible({ timeout: 400 }).catch(() => false)) {
        const label = (await loc.innerText().catch(() => sel)).slice(0, 40);
        await loc.click({ timeout: 1500 }).catch(() => {});
        clicked.push(label || sel);
        await p.waitForTimeout(300);
      }
    } catch {}
  }
  return clicked;
}

// Быстрая проверка цели (Playwright auto-wait, но короткий): скрытый/несуществующий элемент → понятная ошибка
// со списком видимых сейчас элементов вместо 10-секундного тайм-аута (типично для мастеров: элемент с другого шага).
async function visibleOrThrow(p, loc, desc, ms = 2500) {
  try { await loc.waitFor({ state: 'visible', timeout: ms }); return loc; }
  catch { const n = await loc.count().catch(() => 0);
    throw new Error(`элемент «${desc}» ${n ? 'есть, но СКРЫТ (вероятно, другой шаг формы или закрытый список)' : 'не найден'}. Видимые сейчас элементы:\n${await outline(p, 40)}\nИспользуй только их; остальные действия пачки пропущены.`); }
}

async function act(a, dataDir) {
  const p = await ensure(dataDir);
  // нормализация вольностей модели: fields как объект {"#id":"знач"}, text/value/label/name взаимозаменяемы
  if (a.fields && !Array.isArray(a.fields) && typeof a.fields === 'object') a.fields = Object.entries(a.fields).map(([k, v]) => (/^[#.\[]/.test(k) ? { selector: k, value: v } : { field: k, value: v }));
  if (a.text == null) a.text = a.value ?? a.label ?? a.name ?? (a.type === 'browser_click' ? a.field : undefined);
  if (a.type === 'browser_fill' && !a.fields && !a.selector && !a.field && a.text != null && a.label) a.field = a.label;
  const t = a.type;
  if (t === 'browser_open') {
    let url = String(a.url || '').trim(); if (!/^[a-z]+:\/\//i.test(url) && !/^about:/i.test(url)) url = 'https://' + url;
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => { throw new Error('Страница не открылась: ' + e.message.split('\n')[0]); });
    await p.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
    await p.bringToFront();
    const dismissed = await dismissOverlays(p);
    const note = dismissed.length ? `\nЗакрыты баннеры: ${dismissed.slice(0, 8).join(', ')}.` : '';
    return `Открыто: ${p.url()} — «${await p.title()}».${note}\nЭлементы страницы:\n${await outline(p)}`;
  }
  if (t === 'browser_click') {
    if (a.selector) { const raw = p.locator(a.selector).first(); const hid = await raw.evaluate((el) => /^(checkbox|radio)$/.test(el.type) && !(el.offsetWidth && el.offsetHeight && getComputedStyle(el).opacity !== '0' && getComputedStyle(el).visibility !== 'hidden')).catch(() => false);
      if (hid && await toggleHidden(raw, true)) return `Отмечен скрытый вариант «${a.selector}» (через подпись).`; }
    const byText = (tx) => p.getByRole('button', { name: tx }).or(p.getByRole('link', { name: tx })).or(p.getByRole('option', { name: tx })).or(p.getByText(tx, { exact: !!a.exact }));
    let loc = a.selector ? p.locator(a.selector).filter({ visible: true }) : byText(String(a.text)).filter({ visible: true });
    if (a.selector && a.text && !(await loc.count().catch(() => 0))) loc = byText(String(a.text)).filter({ visible: true });
    loc = await visibleOrThrow(p, loc.first(), a.text || a.selector);
    await loc.click({ timeout: 5000 });
    await p.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
    return `Нажато «${a.text || a.selector}». Сейчас: ${p.url()}`;
  }
  if (t === 'browser_type') {
    let loc;
    if (a.selector) loc = p.locator(a.selector).first();
    else if (a.field) loc = p.getByPlaceholder(String(a.field)).or(p.getByLabel(String(a.field))).or(p.getByRole('textbox', { name: String(a.field) })).first();
    else loc = p.locator('textarea:visible, [contenteditable=true]:visible, input[type=text]:visible, input:not([type]):visible, [role=textbox]:visible').last();
    if (a.text == null && a.value != null) a.text = a.value;
    loc = await visibleOrThrow(p, loc, a.field || a.selector || 'поле ввода');
    // нестандартный список (div role=combobox): открыть и выбрать пункт по тексту
    const editable = await loc.evaluate((el) => el.isContentEditable || /^(INPUT|TEXTAREA)$/.test(el.tagName)).catch(() => true);
    if (!editable) { await loc.click({ timeout: 5000 }); const o = p.getByRole('option', { name: String(a.text) }).or(p.getByText(String(a.text), { exact: true })).filter({ visible: true }).first();
      await visibleOrThrow(p, o, a.text, 3000); await o.click({ timeout: 5000 }); return `Это список, а не поле: выбран пункт «${a.text}».`; }
    await loc.click({ timeout: 5000 });
    await loc.fill(String(a.text ?? '')).catch(async () => { await p.keyboard.type(String(a.text ?? ''), { delay: 15 }); });
    let skipped = false;
    if (a.enter) {
      // Enter в поле анкеты отправит форму раньше времени — не жмём, если в форме ещё есть пустые обязательные поля
      const pending = await p.evaluate(() => { const el = document.activeElement; const f = el && el.form; if (!f || el.type === 'search') return 0;
        return [...f.elements].filter(x => x !== el && x.required && !x.disabled && ((x.type === 'checkbox' || x.type === 'radio') ? !f.querySelector(`[name="${x.name}"]:checked`) : !x.value)).length; }).catch(() => 0);
      if (pending > 0) skipped = pending; else await p.keyboard.press('Enter');
    }
    return `Введён текст (${String(a.text ?? '').length} симв.)${a.enter && !skipped ? ' и нажат Enter' : ''}${skipped ? `. Enter НЕ нажат: в форме ещё ${skipped} незаполненных обязательных полей — заполни их, потом нажми кнопку отправки` : ''}.`;
  }
  if (t === 'browser_read') {
    const text = await p.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
    const clean = text.replace(/\n{3,}/g, '\n\n');
    const tail = a.tail !== false && clean.length > 5000 ? '…' + clean.slice(-5000) : clean.slice(0, 5000);
    return `Страница ${p.url()} «${await p.title()}». Текст${clean.length > 5000 ? ' (последние 5000 симв.)' : ''}:\n${tail}\n\nЭлементы:\n${await outline(p, 40)}`;
  }
  if (t === 'browser_select') {
    const loc = a.selector ? p.locator(a.selector).first() : p.getByLabel(String(a.field)).first();
    const v = String(a.value ?? a.text ?? '');
    let r = await loc.selectOption({ label: v }, { timeout: 4000 }).catch(() => loc.selectOption(v, { timeout: 2000 })).catch(() => null);
    if (r) return `Выбрано «${v}» (${r}).`;
    // запасной путь: радиокнопка/пункт с таким текстом (группа «Размер» не <select>)
    const radio = p.getByLabel(v, { exact: true }).first();
    if (await radio.count().catch(() => 0)) { await radio.check({ timeout: 4000 }); return `Это не список: отмечен вариант «${v}».`; }
    // нестандартный список (div role=combobox): сначала открыть его по подписи/селектору
    const cb = a.selector ? p.locator(a.selector).first() : p.getByRole('combobox', { name: String(a.field) }).or(p.getByLabel(String(a.field))).first();
    if (await cb.isVisible().catch(() => false)) await cb.click({ timeout: 3000 }).catch(() => {});
    const opt = p.getByRole('option', { name: v }).or(p.getByText(v, { exact: true })).filter({ visible: true }).first();
    await opt.click({ timeout: 4000 });
    return `Это не <select>: нажат вариант «${v}».`;
  }
  if (t === 'browser_check') {
    let loc;
    if (a.selector) loc = p.locator(a.selector).first();
    else loc = p.getByLabel(String(a.field || a.text), { exact: !!a.exact }).first();
    try { if (a.checked === false) await loc.uncheck({ timeout: 3000 }); else await loc.check({ timeout: 3000 }); }
    catch (e) { if (!(await toggleHidden(loc, a.checked !== false))) throw e; }
    return `Отмечено «${a.field || a.text || a.selector}»: ${a.checked === false ? 'нет' : 'да'}.`;
  }
  if (t === 'browser_upload') {
    const loc = a.selector ? p.locator(a.selector).first() : p.locator('input[type=file]').first();
    await loc.setInputFiles(String(a.path), { timeout: 5000 });
    return `Файл ${a.path} прикреплён.`;
  }
  if (t === 'browser_fill') {
    // несколько полей сразу: {fields:[{selector|field, value}]} — select/checkbox/radio/file распознаются сами
    if (Array.isArray(a.fields)) {
      const rep = [];
      for (const f of a.fields.slice(0, 40)) {
        const l = f.selector ? p.locator(f.selector).first() : p.getByLabel(String(f.field || f.label)).first(); const v = f.value ?? f.text ?? '';
        try {
          const kind = await l.evaluate((el) => el.tagName === 'SELECT' ? 'select' : (el.type || el.tagName).toLowerCase(), null, { timeout: 4000 });
          if (kind === 'select') await l.selectOption({ label: String(v) }, { timeout: 3000 }).catch(() => l.selectOption(String(v), { timeout: 3000 }));
          else if (kind === 'checkbox' || kind === 'radio') await l.setChecked(v !== false && v !== 'false' && v !== 0, { timeout: 3000 }).catch(async (e) => { if (!(await toggleHidden(l, v !== false && v !== 'false' && v !== 0))) throw e; });
          else if (kind === 'file') await l.setInputFiles(String(v), { timeout: 3000 });
          else await l.fill(String(v), { timeout: 3000 });
          rep.push(`${f.selector || f.field}: ок`);
        } catch (e) { rep.push(`${f.selector || f.field}: ОШИБКА ${String(e.message).split('\n')[0].slice(0, 80)}`); }
      }
      return 'Заполнено полей: ' + rep.join('; ') + '.';
    }
    // заполнить поле по селектору/подписи без клика (даты, скрытые маски)
    const loc = a.selector ? p.locator(a.selector).first() : p.getByLabel(String(a.field)).first();
    const hid = await loc.evaluate((el) => el.type === 'hidden').catch(() => false);
    if (!hid) await visibleOrThrow(p, loc, a.field || a.selector);
    await loc.fill(String(a.value ?? a.text ?? ''), { timeout: 5000 });
    return `Заполнено «${a.field || a.selector}».`;
  }
  if (t === 'browser_key') { await p.keyboard.press(String(a.keys || 'Enter')); return `Нажато ${a.keys} в браузере.`; }
  if (t === 'browser_back') {
    // мастер (многошаговая форма) часто на одной странице: сначала ищем кнопку «Назад» мастера, иначе — история браузера
    const btn = p.getByRole('button', { name: /^\s*(?:[←‹<«]\s*)?(назад|back|previous|prev|предыдущ\S*)\s*$/i }).or(p.getByRole('link', { name: /^\s*(?:[←‹<«]\s*)?(назад|back|previous|prev)\s*$/i })).or(p.locator('[data-action=prev],[data-step-prev],.prev,.back,.btn-prev,button[name=prev],input[type=button][value*="Назад"],input[type=submit][value*="Назад"]')).filter({ visible: true }).first();
    if (a.history !== true && await btn.count().catch(() => 0)) { await btn.click({ timeout: 3000 }); await p.waitForTimeout(250); return 'Шаг назад в мастере (кнопка «Назад»). Сейчас: ' + p.url() + '\nЭлементы:\n' + await outline(p, 40); }
    const before = p.url(); await p.goBack({ timeout: 8000 }).catch(() => {});
    return (p.url() === before ? 'Истории нет — остался на ' : 'Назад. Сейчас: ') + p.url() + '\nЭлементы:\n' + await outline(p, 40);
  }
  if (t === 'browser_dismiss') { const d = await dismissOverlays(p); return d.length ? 'Закрыты: ' + d.join(', ') : 'Баннеров не найдено.'; }
  throw new Error('Неизвестное действие браузера ' + t);
}

async function close() { if (ctx) { closingByUs = true; try { await ctx.close(); } catch {} closingByUs = false; ctx = null; page = null; } }
// Быстрый режим DOM: компактное дерево интерактивных элементов текущей вкладки без снимка
async function snapshot(limit = 80) { if (!page || page.isClosed()) return null;
  try { return { url: page.url(), title: await page.title(), tree: await outline(page, limit, true) }; } catch { return null; } }
module.exports = { killProfile, snapshot, act, close, reset, stopAll, _stopped: () => stopped, setProxy, findBrowser, _state: () => ({ userClosed }), _setUserClosed: (v) => { userClosed = v; }, ensure, isBrowserAction: (t) => /^browser_/.test(t) };
