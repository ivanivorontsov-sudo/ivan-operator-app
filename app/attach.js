// 1.2.2: надёжное прикрепление снимка к веб-чату (Алиса, GigaChat, Perplexity, ...) с проверками и журналом каждого этапа.
const fs = require('fs'), path = require('path'), os = require('os');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOG = [];
function log(stage, ok, info = '') { const l = { t: new Date().toISOString(), stage, ok, info: String(info).slice(0, 300) }; LOG.push(l); if (LOG.length > 200) LOG.shift(); try { console.log('[attach]', stage, ok ? 'OK' : 'FAIL', l.info); } catch {} return ok; }
// Этап 1: проверка данных снимка — не пустой, известный формат, валидные размеры
function inspect(b64) {
  let buf; try { buf = Buffer.from(String(b64 || ''), 'base64'); } catch { return { ok: false, why: 'base64' }; }
  if (!buf.length) return { ok: false, why: 'пустой снимок (0 байт)' };
  let mime = '', ext = '', w = 0, h = 0;
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) { mime = 'image/png'; ext = 'png'; if (buf.length >= 24) { w = buf.readUInt32BE(16); h = buf.readUInt32BE(20); } }
  else if (buf[0] === 0xff && buf[1] === 0xd8) {
    mime = 'image/jpeg'; ext = 'jpg';
    for (let i = 2; i < buf.length - 9;) { if (buf[i] !== 0xff) { i++; continue; } const m = buf[i + 1]; if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) { h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break; } i += 2 + buf.readUInt16BE(i + 2); }
  } else return { ok: false, why: 'неизвестный формат', size: buf.length };
  if (!w || !h) return { ok: false, why: 'нулевые размеры', size: buf.length, mime };
  return { ok: true, buf, mime, ext, w, h, size: buf.length };
}
// Этап 2: файл на диске (расширение по реальному формату, права 0600, удаляем не раньше чем через 2 мин)
function writeTmp(info) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iop-attach-'));
  const f = path.join(dir, `screen.${info.ext}`); fs.writeFileSync(f, info.buf, { mode: 0o600 });
  const st = fs.statSync(f); if (st.size !== info.size) throw new Error('размер файла не совпал');
  setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }, 120000);
  return f;
}
// Подсчёт превью/вложений на странице (blob:/data: картинки, элементы с attach/file/preview в классе)
const COUNT_JS = `(()=>{const q=[...document.querySelectorAll('img[src^="blob:"],img[src^="data:image"],[class*="ttach" i] img,[class*="preview" i] img,[class*="file" i] img,[class*="upload" i] img,[style*="blob:"]')].filter(e=>e.getClientRects().length);const f=[...document.querySelectorAll('input[type=file]')].reduce((n,i)=>n+((i.files&&i.files.length)||0),0);const nm=[...document.querySelectorAll('body *')].filter(e=>e.children.length<3&&/\\bscreen[-_ ]?\\d*\\.(png|jpe?g)\\b/i.test(e.textContent||'')&&!e.closest('[contenteditable=true],textarea')&&e.getClientRects().length).length;const busy=!!document.querySelector('[class*="upload" i][class*="progress" i],[class*="loading" i][class*="ttach" i],[role=progressbar]');return {imgs:q.length+(nm?1:0),files:f,busy,srcs:q.map(e=>e.currentSrc||e.src||'').filter(Boolean).slice(-20)}})()`;
const CONSENT_JS = `(()=>{const vis=e=>e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';const RT=/соглашени|согласи|ответственност|agreement|terms|consent/i,RB=/^(продолжить|принять|согласен|согласна|загрузить|ок|ok|continue|accept|agree|upload)$/i;const btnIn=d=>[...d.querySelectorAll('button,[role=button]')].filter(vis).find(x=>RB.test((x.innerText||'').trim()));let d=null;for(const c of document.querySelectorAll('input[type=checkbox],[role=checkbox],button,[role=button]')){let a=c;for(let k=0;k<8&&a;k++,a=a.parentElement){if(RT.test(a.innerText||'')&&btnIn(a)&&vis(a)){d=a;break}}if(d)break}if(!d)return '';document.querySelectorAll('[data-iop-cs]').forEach(x=>x.removeAttribute('data-iop-cs'));const cb=[...d.querySelectorAll('input[type=checkbox],[role=checkbox]')].find(c=>!(c.checked||c.getAttribute('aria-checked')==='true'));if(cb){const l=cb.id&&d.querySelector('label[for="'+cb.id+'"]');const t=l&&vis(l)?l:vis(cb)?cb:(cb.closest('label')||cb.parentElement);t.setAttribute('data-iop-cs','cb');return 'cb'}const b=btnIn(d);if(b.disabled||b.getAttribute('aria-disabled')==='true')return 'wait';b.setAttribute('data-iop-cs','ok');return 'ok'})()`;
async function consent(w) {
  for (let i = 0; i < 4; i++) {
    const r = await w.webContents.executeJavaScript(CONSENT_JS).catch(() => '');
    if (!r) return i > 0;
    if (r === 'wait') { await sleep(300); continue; }
    if (!(await trustedClick(w, `[data-iop-cs="${r}"]`))) await w.webContents.executeJavaScript(`(()=>{const e=document.querySelector('[data-iop-cs="${r}"]');if(e)e.click();return 1})()`).catch(() => {});
    log('consent', true, r === 'cb' ? 'отметил согласие' : 'нажал «Продолжить»'); await sleep(500);
  }
  return true;
}
async function count(w) { return w.webContents.executeJavaScript(COUNT_JS).catch(() => ({ imgs: 0, files: 0, busy: false })); }
async function waitPreview(w, before, ms = 12000) {
  const t0 = Date.now(); let last = before;
  while (Date.now() - t0 < ms) { await sleep(400); await consent(w); last = await count(w); if ((last.imgs > before.imgs || (last.srcs || []).some((x) => !(before.srcs || []).includes(x))) && !last.busy) { await sleep(600); return true; } }
  return false;
}
// перехват выбора файла внутри страницы: input[type=file].click()/showPicker() не открывает системный диалог,
// а помечает input (и подключает к DOM, если он «висит в воздухе») — дальше файл ставится через DOM.setFileInputFiles
const NO_PICKER_JS = `(()=>{window.__iopBlockPick=1;if(window.__iopNoPick)return 1;window.__iopNoPick=1;const P=HTMLInputElement.prototype;const grab=(el)=>{el.setAttribute('data-iop-file','1');if(!el.isConnected){el.style.display='none';document.body.appendChild(el)}};const oc=P.click;P.click=function(){if(this.type==='file'&&window.__iopBlockPick){grab(this);return}return oc.apply(this,arguments)};if(P.showPicker){const os=P.showPicker;P.showPicker=function(){if(this.type==='file'&&window.__iopBlockPick){grab(this);return}return os.apply(this,arguments)}}if(window.showOpenFilePicker){window.showOpenFilePicker=function(){const i=document.createElement('input');i.type='file';grab(i);return new Promise(()=>{})}}return 1})()`;
// Кандидаты на «прикрепить»: скрепка, «+», attach/upload, RU/EN по aria/title/классу/тексту/иконке
const CLIPS_JS = `(()=>{const re=/attach|clip|paperclip|upload|add[-_ ]?file|file|image|photo|plus|скреп|прикреп|загруз|файл|фото|изображ|картин|добав/i,bad=/voice|micro|голос|микроф|send|отправ|search|поиск|new.?chat|нов(ый|ого) чат|login|войти|preview|crop|обрез|remove|удалит|delete/i;
const sig=b=>[b.getAttribute('aria-label'),b.title,b.getAttribute('data-testid'),typeof b.className==='string'?b.className:'',[...b.querySelectorAll('svg,use,img')].map(x=>(x.getAttribute('class')||'')+(x.getAttribute('href')||'')+(x.getAttribute('xlink:href')||'')+(x.getAttribute('alt')||'')+(x.getAttribute('data-icon')||'')).join(' '),(b.innerText||'').trim()].join(' ');
let box=document.querySelector('[data-iop-editor]')||[...document.querySelectorAll('textarea,[contenteditable=true],div[role=textbox]')].filter(x=>x.getClientRects().length).pop();for(let i=0;i<4&&box;i++)box=box.parentElement;const all=[...document.querySelectorAll('button,[role=button],label,[aria-haspopup]')].filter(b=>b.getClientRects().length&&!b.disabled);const out=[];
for(const b of all){const t=(b.innerText||'').trim(),s=sig(b);if(bad.test(s))continue;let sc=0;if(/скреп|paperclip|clip|прикреп|attach/i.test(s))sc=3;else if(t==='+'||/^plus$|plus|добав|add|more|ещё|еще|inputcontrols/i.test(s))sc=2;else if(re.test(s))sc=1;if(b.tagName==='LABEL'&&b.querySelector('input[type=file]'))sc=4;if(sc&&box&&box.contains(b))sc+=0.5;if(sc&&b.getAttribute('aria-haspopup'))sc+=0.3;if(sc&&/widget|gallery/i.test(typeof b.className==='string'?b.className:''))sc-=0.9;if(sc>0)out.push([sc,b])}
out.sort((a,b)=>b[0]-a[0]);document.querySelectorAll('[data-iop-clip]').forEach(e=>e.removeAttribute('data-iop-clip'));return out.slice(0,6).map(([sc,b],i)=>{b.setAttribute('data-iop-clip',String(i));return sig(b).replace(/\\s+/g,' ').trim().slice(0,60)})})()`;
const MENU_JS = `(()=>{const m=[...document.querySelectorAll('[role=menuitem],[role=option],li,button,a,div,span,label')].filter(x=>x.getClientRects().length&&x.children.length<4).sort((a,b)=>(b.getAttribute('role')?1:0)-(a.getAttribute('role')?1:0)||a.querySelectorAll('*').length-b.querySelectorAll('*').length||a.contains(b)-b.contains(a)).find(x=>/^(добавить( фото| файл| изображение)|загрузить( файл| фото| изображение)?|фото|фотографи|изображени|картинк|файл|с устройства|с компьютера|прикрепить( файл| фото)?|upload( file| image| photo)?|image|photo|file|from (device|computer)|attach( file| image)?)/i.test((x.innerText||'').trim()));if(!m)return '';document.querySelectorAll('[data-iop-menu]').forEach(x=>x.removeAttribute('data-iop-menu'));m.setAttribute('data-iop-menu','1');return (m.innerText||'').trim().slice(0,40)})()`;
const memory = {}; // site → рабочая последовательность (запоминается на время работы и в learned)
let learnedFile = null;
function learned() { if (!learnedFile) return {}; try { return JSON.parse(fs.readFileSync(learnedFile, 'utf8')); } catch { return {}; } }
function remember(site, seq) { memory[site] = seq; if (!learnedFile) return; try { const l = learned(); l[site] = seq; fs.writeFileSync(learnedFile, JSON.stringify(l)); } catch {} }
function setLearnedFile(f) { learnedFile = f; }
const tmo = (p, ms, d) => Promise.race([p, new Promise((r) => setTimeout(() => r(d), ms))]);
// 1.2.2: «настоящий» клик (isTrusted) — Алиса и др. игнорируют синтетический el.click()
async function trustedClick(w, sel) {
  const r = await w.webContents.executeJavaScript(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:"center"});const b=e.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]})()`).catch(() => null);
  if (!r) return false; const x = Math.round(r[0]), y = Math.round(r[1]);
  if (!w.isVisible() && w.showInactive) { w.setOpacity && w.setOpacity(0); w.showInactive(); w._iopShown = true; await sleep(250); }
  for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) w.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
  return true;
}
async function viaFileInput(w, file, siteId) {
  const dbg = w.webContents.debugger; let attached = false; let chooser = null;
  const onMsg = (_e, method, params) => { if (method === 'Page.fileChooserOpened') chooser = params; };
  try {
    if (!dbg.isAttached()) { dbg.attach('1.3'); attached = true; }
    dbg.on('message', onMsg);
    await dbg.sendCommand('Page.enable').catch(() => {});
    await dbg.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true }).catch((e) => log('intercept', false, e.message));
    const find = async () => { const { root } = await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true }); const r = await dbg.sendCommand('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'input[type=file]' }); return r.nodeIds || []; };
    const pickInput = async (ids) => { let pick = ids[ids.length - 1]; for (const id of ids) { try { const { attributes = [] } = await dbg.sendCommand('DOM.getAttributes', { nodeId: id }); const i = attributes.indexOf('accept'); if (i < 0 || /image|png|jpe?g|\*/i.test(attributes[i + 1])) { pick = id; break; } } catch {} } return pick; };
    const put = async (how) => {
      if (chooser) { await dbg.sendCommand('DOM.setFileInputFiles', { backendNodeId: chooser.backendNodeId, files: [file] }); log('setFileInputFiles', true, how + ' (filechooser)'); return true; }
      const ids = await find(); if (!ids.length) return false;
      await dbg.sendCommand('DOM.setFileInputFiles', { nodeId: await pickInput(ids), files: [file] }); log('setFileInputFiles', true, how + ` (input из ${ids.length})`); return true;
    };
    await w.webContents.executeJavaScript(NO_PICKER_JS).catch(() => {});
    // 0) уже есть input — сразу
    log('file-input:search', true, 'ищу скрепку/«+»');
    // 1) запомненная последовательность сайта — первой
    const known = memory[siteId] || learned()[siteId];
    const clips = await w.webContents.executeJavaScript(CLIPS_JS).catch(() => []);
    log('clip-candidates', clips.length > 0, clips.join(' | '));
    const order = clips.map((_, i) => i); if (known && known.clip != null && known.clip < clips.length) order.unshift(order.splice(known.clip, 1)[0]);
    for (const i of order) {
      chooser = null;
      if (!(await trustedClick(w, `[data-iop-clip="${i}"]`))) continue;
      log('clip-click', true, '#' + i);
      await sleep(700);
      let menu = '';
      if (!chooser && !(await find()).length) { menu = await tmo(w.webContents.executeJavaScript(MENU_JS, true).catch(() => ''), 4000, ''); log('menu-search', !!menu, menu || 'пункт меню не найден'); if (menu) { await trustedClick(w, '[data-iop-menu]'); log('menu-item', true, menu); await sleep(900); } }
      if (await put(`clip#${i}${menu ? '→' + menu : ''}`)) { remember(siteId, { clip: i, label: clips[i], menu }); return `clip#${i}`; }
      await w.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`).catch(() => {});
    }
    chooser = null;
    if ((await find()).length && await put('direct')) return 'direct';
    return false;
  } catch (e) { return log('file-input', false, e.message); }
  finally { w.webContents.executeJavaScript('window.__iopBlockPick=0').catch(() => {}); try { await dbg.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false }); } catch {} dbg.removeListener('message', onMsg); if (attached) try { dbg.detach(); } catch {} }
}
// DataTransfer: drop или paste-событие прямо в поле (без системного буфера — работает и на Wayland)
async function viaDataTransfer(w, info, mode) {
  const js = `(async()=>{const b=atob(${JSON.stringify(info.buf.toString('base64'))});const u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);const f=new File([u],'screen.${info.ext}',{type:'${info.mime}'});const dt=new DataTransfer();dt.items.add(f);
  const t=document.querySelector('[data-iop-editor]')||[...document.querySelectorAll('textarea,[contenteditable=true],div[role=textbox]')].filter(x=>x.getClientRects().length).pop()||document.body;t.focus&&t.focus();
  if('${mode}'==='paste'){const e=new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true});if(!e.clipboardData){Object.defineProperty(e,'clipboardData',{value:dt})}t.dispatchEvent(e);return 'paste'}
  const zone=t.closest('form')||t.parentElement||t;for(const ty of ['dragenter','dragover','drop']){const e=new DragEvent(ty,{dataTransfer:dt,bubbles:true,cancelable:true});zone.dispatchEvent(e)}return 'drop'})()`;
  try { const r = await w.webContents.executeJavaScript(js); return log('datatransfer:' + mode, true, r); } catch (e) { return log('datatransfer:' + mode, false, e.message); }
}
async function viaClipboard(w, info) {
  try { const { clipboard, nativeImage } = require('electron'); const img = nativeImage.createFromBuffer(info.buf); if (img.isEmpty()) return log('clipboard', false, 'nativeImage пуст');
    clipboard.writeImage(img); if (clipboard.readImage().isEmpty()) return log('clipboard', false, 'буфер не принял картинку (Wayland?)');
    await w.webContents.executeJavaScript(`(()=>{const e=document.querySelector('[data-iop-editor]')||[...document.querySelectorAll('textarea,[contenteditable=true],div[role=textbox]')].filter(x=>x.getClientRects().length).pop();if(e)e.focus();return !!e})()`);
    w.webContents.paste(); return log('clipboard', true);
  } catch (e) { return log('clipboard', false, e.message); }
}
// Главная функция: true — превью появилось; false — картинка не ушла (вызывающий добавит текстовое описание экрана)
function hideBack(w) { if (w._iopShown) { w._iopShown = false; try { w.hide(); w.setOpacity && w.setOpacity(1); } catch {} } }
async function attachImage(w, b64, site = {}) {
  const info = inspect(b64);
  if (!log('snapshot', info.ok, info.ok ? `${info.mime} ${info.w}x${info.h} ${info.size} Б` : info.why)) return { ok: false, stage: 'snapshot', why: info.why };
  let file; try { file = writeTmp(info); log('tmpfile', true, `${file} ${info.size} Б`); } catch (e) { log('tmpfile', false, e.message); }
  const methods = site.attach || ['clipboard', 'input', 'paste', 'drop'];
  for (const m of methods) {
    const before = await count(w);
    let did = false;
    if (m === 'input') did = file ? await (async () => { let t; const r = await Promise.race([viaFileInput(w, file, site.id || site.label || 'site'), new Promise((res) => { t = setTimeout(() => res(log('file-input', false, 'таймаут 20 с')), 20000); })]); clearTimeout(t); return r; })() : false;
    else if (m === 'paste' || m === 'drop') did = await viaDataTransfer(w, info, m);
    else if (m === 'clipboard') did = await viaClipboard(w, info);
    if (!did) continue;
    const ok = await waitPreview(w, before, site.previewMs || 8000);
    log('preview:' + m, ok, ok ? 'превью появилось' : 'превью не появилось');
    if (ok) { hideBack(w); return { ok: true, method: m }; }
    if ((await count(w)).imgs > before.imgs) { hideBack(w); return { ok: true, method: m }; }
  }
  hideBack(w);
  return { ok: false, stage: 'preview', why: 'ни один способ не дал превью вложения' };
}
module.exports = { CONSENT_JS, attachImage, inspect, log: LOG, COUNT_JS, CLIPS_JS, MENU_JS, memory, setLearnedFile, viaFileInput };
