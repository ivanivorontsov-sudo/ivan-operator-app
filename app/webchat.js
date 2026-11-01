// Встроенный браузер-провайдер: веб-чаты ИИ как «мозг» агента.
// Сессии — только локально (persist:webchat-<id> в userData Electron). Пароли не хранятся.
const { BrowserWindow, clipboard, nativeImage, session } = require('electron');
const fs = require('fs'); const path = require('path');
const CAP = fs.readFileSync(path.join(__dirname, 'webchat_capture.js'), 'utf8');
const SITES = {
  deepseek: { label: 'DeepSeek', url: 'https://chat.deepseek.com/', images: true, upload: true, guest: false },
  chatgpt: { label: 'ChatGPT', url: 'https://chatgpt.com/', images: true, guest: true },
  qwen: { label: 'Qwen Chat', url: 'https://chat.qwen.ai/', images: true, guest: false },
  gigachat: { label: 'GigaChat', url: 'https://giga.chat/', images: true, upload: true, guest: false },
  alice: { label: 'Алиса (Яндекс)', url: 'https://alice.yandex.ru/', images: true, upload: true, guest: true },
  copilot: { label: 'Microsoft Copilot', url: 'https://copilot.microsoft.com/', images: true, guest: false },
  huggingchat: { label: 'HuggingChat', url: 'https://huggingface.co/chat/', images: true, guest: false },
  duckai: { label: 'Duck.ai (без входа)', url: 'https://duck.ai/', images: true, guest: true },
  claude: { label: 'Claude', url: 'https://claude.ai/new', images: true, guest: false },
  gemini: { label: 'Gemini', url: 'https://gemini.google.com/app', images: true, guest: true },
  grok: { label: 'Grok', url: 'https://grok.com/', images: true, guest: true },
  mistral: { label: 'Mistral Le Chat', url: 'https://chat.mistral.ai/chat', images: true, guest: false },
  perplexity: { label: 'Perplexity', url: 'https://www.perplexity.ai/', images: true, upload: true, guest: true, history: 'https://www.perplexity.ai/library' },
  kimi: { label: 'Kimi', url: 'https://www.kimi.com/', images: true, guest: false },
  glm: { label: 'GLM (Z.ai)', url: 'https://chat.z.ai/', images: true, guest: true },
  custom: { label: 'Свой адрес', url: '', images: true, guest: false },
};
const wins = {}; const state = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { sleepA } = require('./guard');
// Cloudflare «Just a moment…» / Turnstile: страницу НЕЛЬЗЯ перезагружать и чистить кэш — проверка сбросится (причина поломки Perplexity в 1.1.4)
const CF_JS = `(()=>{const t=document.title||'';return /just a moment|один момент|attention required|checking your browser/i.test(t)||!!document.querySelector('#challenge-form,#cf-challenge-running,script[src*="challenge-platform"],iframe[src*="challenges.cloudflare.com"]')})()`;
// Признаки «вышли из аккаунта»: адрес входа или кнопки входа без поля ввода
const LOGGED_OUT_JS = `(()=>{const u=location.href;const vis=e=>e.getClientRects().length;const ed=[...document.querySelectorAll('textarea,[contenteditable=true],div[role=textbox]')].some(vis);
 const login=/\\/(sign[_-]?in|login|auth|signin|sign_up|signup)(\\b|\\/|\\?)/i.test(u)||[...document.querySelectorAll('button,a')].some(b=>vis(b)&&/^(log ?in|sign ?in|войти|вход)$/i.test((b.innerText||'').trim()))&&!ed;
 return {editor:ed,login,url:u,title:document.title}})()`;
// Устойчивый поиск поля ввода: 1) кэш удачного селектора 2) роли/aria/placeholder 3) «зрение»: проверка точек нижней части окна (elementFromPoint)
const FIND_JS = (cached) => `(()=>{const vis=e=>e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const tag=e=>{e.setAttribute('data-iop-editor','1');return e};document.querySelectorAll('[data-iop-editor]').forEach(e=>e.removeAttribute('data-iop-editor'));
 const tryS=s=>{try{const a=[...document.querySelectorAll(s)].filter(vis);return a[a.length-1]}catch(e){return null}};
 const C=${JSON.stringify(cached || '')};if(C){const e=tryS(C);if(e)return {how:'cache',sel:C,ok:!!tag(e)}}
 const L=['textarea[placeholder]','div[contenteditable=true][role=textbox]','[contenteditable=true][aria-label]','#ask-input','textarea','[contenteditable=true]','div[role=textbox]','input[type=text][placeholder]'];
 for(const s of L){const e=tryS(s);if(e)return {how:'selector',sel:s,ok:!!tag(e)}}
 const W=innerWidth,H=innerHeight;for(let y=H-40;y>H*0.45;y-=30)for(const x of [W/2,W*0.4,W*0.6,W*0.3]){let e=document.elementFromPoint(x,y);for(let i=0;i<4&&e;i++,e=e.parentElement){if(e.isContentEditable||/^(TEXTAREA|INPUT)$/.test(e.tagName))return {how:'vision',sel:'[data-iop-editor]',ok:!!tag(e)}}}
 return {how:'none',ok:false}})()`;
const CHATS_JS = `(()=>{const P=/\\/(a\\/chat\\/s|c|chat|search|thread|conversation|app|s)\\/[\\w-]{6,}/;const seen=new Set();const out=[];
 for(const a of document.querySelectorAll('a[href]')){const h=a.href;if(!h.startsWith(location.origin)||!P.test(new URL(h).pathname)||seen.has(h))continue;const t=(a.innerText||a.title||a.getAttribute('aria-label')||'').trim().replace(/\\s+/g,' ');if(!t)continue;seen.add(h);out.push({title:t.slice(0,80),url:h});if(out.length>=60)break}return out})()`;
const STOP_JS = `(()=>{const b=[...document.querySelectorAll('button,[role=button]')].find(x=>x.getClientRects().length&&/(^|\\W)(stop|остановить|прервать|стоп)/i.test((x.getAttribute('aria-label')||'')+' '+(x.title||'')+' '+(x.getAttribute('data-testid')||'')));if(b){b.click();return 1}return 0})()`;
const cacheFile = () => { try { return path.join(require('electron').app.getPath('userData'), 'webchat-selectors.json'); } catch { return null; } };
let selCache = null;
function getCache() { if (selCache) return selCache; try { selCache = JSON.parse(fs.readFileSync(cacheFile(), 'utf8')); } catch { selCache = {}; } return selCache; }
function putCache(id, sel) { const c = getCache(); if (c[id] === sel) return; c[id] = sel; try { fs.writeFileSync(cacheFile(), JSON.stringify(c)); } catch {} }
// Сессии не должны «слетать»: сеансовые куки (без срока) превращаем в постоянные на 30 дней, хранилище сбрасываем на диск.
const keepers = new Set();
function keepSession(ses) {
  if (keepers.has(ses)) return; keepers.add(ses);
  ses.cookies.on('changed', (_e, c, cause, removed) => {
    if (removed || c.session === false || c.expirationDate) return;
    const url = (c.secure ? 'https://' : 'http://') + c.domain.replace(/^\./, '') + (c.path || '/');
    ses.cookies.set({ url, name: c.name, value: c.value, domain: c.hostOnly ? undefined : c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, expirationDate: Date.now() / 1000 + 30 * 86400 }).catch(() => {});
  });
}
function flushAll() { for (const ses of keepers) { try { ses.cookies.flushStore(); } catch {} try { ses.flushStorageData(); } catch {} } }
setInterval(flushAll, 60000).unref?.();
function part(id) { return 'persist:webchat-' + id; }
function win(id, url, show) {
  let w = wins[id];
  if (!w || w.isDestroyed()) {
    w = wins[id] = new BrowserWindow({ width: 1100, height: 820, show: !!show, title: 'ИванОператор — ' + (SITES[id] || {}).label,
      webPreferences: { partition: part(id), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    w.on('close', (e) => { if (!w._quit) { e.preventDefault(); w.hide(); } });
    // 403 (CloudFront и т.п.): один автоповтор, затем подсказка «обновить/повторить»
    // Всплывающие окна входа (Google/Apple OAuth, капча) — разрешаем в том же разделе, чтобы куки и капча работали
    w.webContents.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { parent: w, width: 520, height: 720, webPreferences: { partition: part(id), contextIsolation: true, nodeIntegration: false, sandbox: true } } }));
    w._r403 = 0; keepSession(w.webContents.session);
    w.webContents.on('did-navigate', async (_e, u, code) => {
      if (code !== 403) return;
      if (await w.webContents.executeJavaScript(CF_JS).catch(() => false)) return; // проверка Cloudflare — ждём, не трогаем
      if (w._r403++ < 1) { setTimeout(() => { try { w.webContents.session.clearCache().finally(() => w.webContents.reload()); } catch {} }, 1500); return; }
      w.webContents.executeJavaScript(`(()=>{if(document.getElementById('iop403'))return;const d=document.createElement('div');d.id='iop403';d.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#fff3cd;color:#333;padding:10px;font:14px sans-serif';d.innerHTML='ИванОператор: сайт ответил 403 (запрос заблокирован). Нажмите <b>Ctrl+R</b> или <a href="#" id="iop403r">Повторить</a>. Если не помогает — смените сеть/VPN или выберите другой чат.';document.body.prepend(d);document.getElementById('iop403r').onclick=(e)=>{e.preventDefault();location.reload();};})()`).catch(() => {});
    });
    w.webContents.on('before-input-event', (_e, i) => { if (i.type === 'keyDown' && (i.control || i.meta) && i.key.toLowerCase() === 'r') w.webContents.reload(); });
    w.loadURL(url || SITES[id].url);
  } else if (show) w.show();
  return w;
}
// Окно входа: пользователь сам логинится, мы ничего не вводим.
function openLogin(id, url) { const w = win(id, url, true); w.focus(); return { ok: true, partition: part(id) }; }
async function loggedIn(id) {
  const w = wins[id]; if (!w || w.isDestroyed()) return { open: false };
  const r = await w.webContents.executeJavaScript(`(()=>{const e=[...document.querySelectorAll('textarea,[contenteditable=true],div[role=textbox]')].filter(x=>x.getClientRects().length);return {editor:e.length>0,url:location.href,title:document.title}})()`).catch(() => ({}));
  return { open: true, ...r };
}
async function waitChallenge(w, id, signal, ms = 45000) {
  const t0 = Date.now(); let shown = false;
  while (await w.webContents.executeJavaScript(CF_JS).catch(() => false)) {
    if (Date.now() - t0 > 6000 && !shown) { shown = true; w.show(); w.focus(); }
    if (Date.now() - t0 > ms) { const e = new Error(`Веб-чат ${(SITES[id] || {}).label}: проверка Cloudflare не пройдена. В открытом окне отметьте «Я не робот», затем повторите задачу. Если не помогает — включите VPN Podso или выберите другой чат.`); e.kind = 'cloudflare'; throw e; }
    await sleepA(1000, signal);
  }
  return shown;
}
async function listChats(id, withInfo = false) {
  const site = SITES[id] || {};
  const w = win(id, null, false);
  if (w.webContents.isLoading()) await new Promise((r) => w.webContents.once('did-finish-load', r));
  // 1.3.0: у Perplexity история — на странице /library
  if (site.history && !w.webContents.getURL().startsWith(site.history)) { await w.loadURL(site.history).catch(() => {}); state[id] = {}; }
  await sleep(2500); await waitChallenge(w, id, null, 15000).catch(() => {});
  let chats = await w.webContents.executeJavaScript(CHATS_JS).catch(() => []);
  if (!chats.length) { await w.webContents.executeJavaScript('window.scrollTo(0,document.body.scrollHeight)').catch(() => {}); await sleep(1500); chats = await w.webContents.executeJavaScript(CHATS_JS).catch(() => []); }
  const lo = await w.webContents.executeJavaScript(LOGGED_OUT_JS).catch(() => ({}));
  return withInfo ? { chats, loggedIn: !lo.login } : chats;
}
function stopGenerating() { for (const w of Object.values(wins)) if (!w.isDestroyed()) w.webContents.executeJavaScript(STOP_JS).catch(() => {}); }
async function clearSession(id) { await session.fromPartition(part(id)).clearStorageData(); state[id] = {}; return true; }
const RULES = 'ПРАВИЛА ОТВЕТА: только один блок ```json {"observation":"…","thought":"…","action":{"type":"…",…}} ``` (или "actions":[…]). Без сносок [1], без ссылок-источников, без поиска в интернете. Типы: browser_open{url}, browser_click{text|selector}, browser_type{field|selector,text}, browser_read, open_app{name}, run{command}, click{x,y}, type{text}, key{keys}, done{answer}, ask_user{question}. Открыть Chrome = browser_open.';
const SITE_RULES = { perplexity: 'ВАЖНО: НЕ ищи в интернете и не приводи источники. Ты — модуль управления компьютером: отвечай только командой JSON по инструкции ниже.\n\n' };
function condense(messages) {
  const task = (messages.find((m) => m.role === 'user' && /Задача/.test(JSON.stringify(m.content))) || messages.find((m) => m.role === 'user') || { content: [] });
  const txt = (m) => (m.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ').replace(/\s+/g, ' ');
  const tail = messages.filter((m) => m.role !== 'system').slice(-8, -1).map((m) => (m.role === 'assistant' ? 'ИИ: ' : 'Итог: ') + txt(m).slice(0, 400));
  return ('Задача: ' + txt(task).slice(0, 600) + '\n' + tail.join('\n')).slice(0, 4000);
}
function lastCode(t) { const m = [...String(t).matchAll(/```[a-z]*\n([\s\S]*?)```/gi)]; return m.length ? m[m.length - 1][1].trim() : String(t).trim(); }
const { attachImage } = require('./attach');
try { require('./attach').setLearnedFile(path.join(require('electron').app.getPath('userData'), 'attach-learned.json')); } catch {}
const IMG_FAILS = {}; // id → число неудачных попыток подряд
function imgFails(id) { return IMG_FAILS[id] || 0; }
// messages — формат агента; в веб-чат шлём системный промпт один раз, дальше — только новое (чат сам хранит контекст).
async function chat(cfg, messages, signal) {
  const id = cfg.webchat || 'duckai'; const site = SITES[id] || SITES.custom;
  const w = win(id, cfg.webchatUrl || site.url, cfg.webchatShow);
  const st = state[id] = state[id] || {};
  if (w.webContents.isLoading()) await Promise.race([new Promise((r) => w.webContents.once('did-finish-load', r)), sleepA(30000, signal)]);
  await sleepA(800, signal);
  await waitChallenge(w, id, signal);
  // вышли из аккаунта — не молчим, а просим войти заново (окно показываем)
  if (!site.guest) { const lo = await w.webContents.executeJavaScript(LOGGED_OUT_JS).catch(() => ({})); if (lo.login && !lo.editor) { w.show(); w.focus(); const e = new Error(`Веб-чат ${site.label}: вы вышли из аккаунта. Окно входа открыто — войдите заново, сессия сохранится. Затем напишите «продолжай».`); e.kind = 'auth'; e.status = 401; e.loggedOut = true; throw e; } }
  await w.webContents.executeJavaScript(CAP);
  // Гостевые окна согласия (не вход!): «Принять/Agree/Got it/Start».
  for (let i = 0; i < 3; i++) { const c = await w.webContents.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('button,[role=button],a')].find(x=>x.getClientRects().length&&/^(i agree|agree|accept|accept all|got it|start|get started|start chatting|continue|next|принять|согласен|понятно|начать|продолжить|далее|stay logged out|остаться без входа)$/i.test((x.innerText||'').trim()));if(b){b.click();return b.innerText}return ''})()`).catch(() => ''); if (!c) break; await sleep(1500); }
  await w.webContents.executeJavaScript(CAP);
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')).join('\n\n');
  const last = [...messages].reverse().find((m) => m.role === 'user') || { content: [] };
  let text = last.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const imgs = last.content.filter((c) => c.type === 'image').slice(-3); const img = imgs[imgs.length - 1];
  // 1.2.2: не блокируем по статическому флагу — пробуем прикрепить, отказываемся только после 3 реальных неудач подряд
  const useImg = img && cfg.webchatImages !== false && (IMG_FAILS[id] || 0) < 3;
  if (img && !useImg) text += '\n[Снимок экрана не передан (прикрепление не удалось несколько раз). Пользуйтесь списком элементов и описанием.]';
  let fresh = !st.sys || st.sys !== sys.length || messages.length < (st.n || 0);
  // длинный чат → модель «плывёт» и путает ответы: новый чат + сжатый контекст
  let carry = '';
  if (!fresh && ((st.turns || 0) >= (cfg.webchatMaxTurns || 10) || (st.len || 0) > (cfg.webchatMaxChars || 120000))) { fresh = true; carry = condense(messages); }
  // новая задача → новый диалог: открываем стартовую страницу сервиса, чтобы старая переписка не путала модель
  if (fresh && (!cfg.webchatKeepChat || carry)) {
    const base = cfg.webchatUrl || site.url;
    await w.loadURL(base).catch(() => {}); await sleepA(1800, signal); await waitChallenge(w, id, signal);
    await w.webContents.executeJavaScript(CAP);
    for (let i = 0; i < 2; i++) { const c = await w.webContents.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('button,[role=button]')].find(x=>x.getClientRects().length&&/^(i agree|agree|accept|accept all|got it|start|start chatting|принять|понятно|начать|stay logged out|остаться без входа)$/i.test((x.innerText||'').trim()));if(b){b.click();return 1}return 0})()`).catch(() => 0); if (!c) break; await sleep(1200); }
  }
  if (fresh) { text = (SITE_RULES[id] || '') + sys + (carry ? '\n\n---\nКРАТКИЙ КОНТЕКСТ ПРЕДЫДУЩЕГО ЧАТА (продолжи задачу, не начинай сначала):\n' + carry : '') + '\n\n---\n' + text + '\n\n' + RULES; st.turns = 0; }
  else text += '\n\n' + RULES; // краткие правила каждый ход — против «дрейфа» в длинном чате
  st.turns = (st.turns || 0) + 1;
  st.sys = sys.length; st.n = messages.length;
  await w.webContents.executeJavaScript(`window.__pp.mark(${JSON.stringify(text)})`);
  if (useImg) { let sent = 0; for (const im of imgs.slice(site.upload ? -1 : -3)) { const r = await attachImage(w, im.data, { ...site, id }).catch((e) => ({ ok: false, why: e.message })); if (r.ok) sent++; else st.attachFail = r.why; }
    IMG_FAILS[id] = sent ? 0 : (IMG_FAILS[id] || 0) + 1;
    if (!sent) { text += '\n[Снимок экрана не удалось прикрепить (' + (st.attachFail || 'ошибка') + '). Опирайся на список элементов и текстовое описание экрана выше.]'; await w.webContents.executeJavaScript(`window.__pp.mark(${JSON.stringify(text)})`).catch(() => {}); } }
  // Нативный ввод (как с клавиатуры) — работает на React/Quill/ProseMirror; запасной — JS-заполнение.
  let how = 'noinput';
  const found = await w.webContents.executeJavaScript(FIND_JS(getCache()[id])).catch(() => ({ ok: false }));
  if (found.ok && found.how !== 'cache') putCache(id, found.sel);
  if (found.ok) await w.webContents.executeJavaScript(`(()=>{const e=document.querySelector('[data-iop-editor]');if(e){e.focus();try{document.execCommand('selectAll',false)}catch(x){}}return 1})()`).catch(() => {});
  if (found.ok || await w.webContents.executeJavaScript('window.__pp.focus()')) {
    w.webContents.insertText(text); await sleep(800);
    const typed = await w.webContents.executeJavaScript('window.__pp.pending()');
    how = await w.webContents.executeJavaScript(`window.__pp.send(${JSON.stringify(text)}, ${typed})`);
    await sleep(1500);
    if (await w.webContents.executeJavaScript('window.__pp.pending()')) { for (const type of ['keyDown', 'char', 'keyUp']) w.webContents.sendInputEvent({ type, keyCode: 'Return' }); how += '+enter'; }
  }
  if (how === 'noinput') throw new Error('Веб-чат ' + site.label + ': нет поля ввода — войдите в окне «Войти в веб-чат».');
  // зависание: ответ не меняется hangSec секунд → ошибка «timeout», агент переключится на другую нейросеть
  const t0 = Date.now(), lim = (cfg.timeoutSec || 180) * 1000, hang = (cfg.hangSec || 90) * 1000; let prev = '', same = 0, tChange = Date.now();
  while (Date.now() - t0 < lim) {
    await sleepA(700, signal);
    if (Date.now() - tChange > hang) { const e = new Error(`Веб-чат ${site.label}: завис (нет изменений ${hang / 1000} с)`); e.timeout = true; throw e; }
    const r = JSON.parse(await w.webContents.executeJavaScript('window.__pp.poll()')); st.len = r.len || 0;
    const good = /[{}]/.test(r.text) && (r.method.startsWith('selector') || Date.now() - t0 > 25000) && (r.newer !== false || r.method === 'selector:newcode' || Date.now() - t0 > 20000);
    if (r.text && !r.busy && good && r.text === prev) { if (++same >= 2) return { text: lastCode(r.text), raw: r.text, method: r.method }; } else same = 0;
    if (r.text !== prev || r.busy) tChange = Date.now();
    prev = r.text;
  }
  throw new Error('Веб-чат ' + site.label + ': нет ответа за ' + lim / 1000 + ' с');
}
function closeAll() { flushAll(); for (const w of Object.values(wins)) if (!w.isDestroyed()) { w._quit = true; w.close(); } }
module.exports = { imgFails, RULES, condense, SITES, chat, listChats, stopGenerating, flushAll, keepSession, CF_JS, FIND_JS, CHATS_JS, LOGGED_OUT_JS, openLogin, loggedIn, clearSession, closeAll, lastCode, wins, partition: part };
