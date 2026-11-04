'use strict';
const $ = (id) => document.getElementById(id);
let S = null, META = null, busy = false;
const FIELDS = ['provider', 'base', 'key', 'model', 'profile', 'coords', 'precise', 'useMarks', 'uiMode', 'webchat', 'webchatUrl', 'proxy', 'webchatImages', 'webchatRotateTurns', 'webchatNewChat', 'pauseEvery', 'webchatShow', 'grid', 'monitor', 'hideWindow', 'confirmCommands', 'typeViaClipboard', 'maxSteps', 'settleMs', 'contextBudget', 'numCtx', 'temperature', 'timeoutSec', 'maxMinutes', 'taskTokenBudget', 'maxHops', 'maxRetriesTask', 'autoFailover', 'hangSec', 'webchatMaxTurns', 'allowedDomains', 'blockedDomains', 'recordRuns'];

document.querySelectorAll('nav button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'prompt') iop.readPrompt().then((t) => $('promptText').value = t);
  if (b.dataset.tab === 'local') { checkOllama(); checkEngine(); }
  if (b.dataset.tab === 'android') scanAdb();
  if (b.dataset.tab === 'remote') remoteRefresh();
  if (b.dataset.tab === 'auto') autoRefresh();
});

function add(kind, html, asText = true) { const d = document.createElement('div'); d.className = 'msg ' + kind; if (asText) d.textContent = html; else d.innerHTML = html; $('log').appendChild(d); $('log').scrollTop = 1e9; return d; }
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function actText(a) { const c = { ...a }; const t = c.type; delete c.type; return t + ' ' + JSON.stringify(c); }
function setBusy(b, text) { busy = b; $('send').disabled = b; $('stop').disabled = !b; $('status').textContent = text || (b ? 'Работаю…' : 'Готов'); $('status').classList.toggle('busy', b); $('live').classList.toggle('on', b); }

iop.onEvent((e) => {
  if (e.kind === 'user') add('user', e.text);
  else if (e.kind === 'thinking') { setBusy(true, `Шаг ${e.step}: думаю…`); $('liveShot').src = 'data:image/jpeg;base64,' + e.shot; $('liveText').textContent = 'Модель смотрит на экран…'; }
  else if (e.kind === 'step') { add('step', `<b>Шаг ${e.step}</b> (${e.sec} с) ${esc(e.thought)}<br><span class="act">→ ${esc(actText(e.action))}</span>`, false); $('liveText').textContent = 'Выполняю: ' + actText(e.action); }
  else if (e.kind === 'tokens' && e.all != null) showTokens(e);
  else if (e.kind === 'paused') { add('info', e.text); setBusy(true, 'Пауза'); }
  else if (e.kind === 'tokens') $('tokens').textContent = 'токены: ' + (e.estimated ? '≈' : '') + e.total.toLocaleString('ru-RU') + (e.limit ? ' / ' + e.limit.toLocaleString('ru-RU') : '');
  else if (e.kind === 'result') $('liveText').textContent = e.text;
  else if (e.kind === 'done' || e.kind === 'ask') { add('assistant', e.text); setBusy(false); }
  else if (e.kind === 'error') { add('error', e.text); setBusy(false); }
  else if (e.kind === 'warn' || e.kind === 'info') { add('info', e.text); if ($('liveText') && e.kind === 'warn') $('liveText').textContent = e.text; }
  else if (e.kind === 'confirm') add(e.risks ? 'error' : 'info', (e.risks ? '⚠ Опасная операция, жду подтверждения: ' : 'Жду подтверждения команды: ') + e.text);
});

const fmtT = (n) => Number(n || 0).toLocaleString('ru-RU');
function showTokens(t) { $('tokens').textContent = `токены: сессия ${(t.estimated ? '≈' : '') + fmtT(t.session)} · прошлые ${fmtT(t.prev)} · всего ${fmtT(t.all)}`; $('tokens').title = `Текущая задача: ${fmtT(t.total)}${t.limit ? ' из ' + fmtT(t.limit) : ''}\nЭта сессия: ${fmtT(t.session)}\nПрошлые сессии: ${fmtT(t.prev)}\nВсего: ${fmtT(t.all)}`; }
if (iop.tokensInfo) iop.tokensInfo().then((t) => t && showTokens(t)).catch(() => {});
async function savePauseEvery() { const v = Math.max(0, Math.min(300, parseInt($('qPauseEvery').value, 10) || 0)); $('qPauseEvery').value = v; if (!S) return; S.pauseEvery = v; await iop.saveSettings({ ...S }); if ($('pauseEvery')) $('pauseEvery').value = v; }
$('qPauseEvery').addEventListener('change', savePauseEvery);
async function send() { const t = $('input').value.trim(); if (!t || busy) return; $('input').value = ''; setBusy(true); const r = await iop.send(t); if (r.error) { add('error', r.error); setBusy(false); } }
$('send').onclick = send; $('stop').onclick = () => iop.stop();
$('input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

function fill() {
  if ($('qPauseEvery')) $('qPauseEvery').value = S.pauseEvery || 0;
  for (const f of FIELDS) { const el = $(f); if (!el) continue; if (el.type === 'checkbox') el.checked = !!S[f]; else el.value = S[f] ?? ''; }
  $('base').placeholder = (META.presets[S.provider] || {}).base || '';
  $('visionWarn').hidden = (META.presets[S.provider] || {}).vision !== false;
  $('fallbacksText').value = (S.fallbacks || []).map((f) => [f.provider, f.model, f.key ? f.key : ''].filter(Boolean).join(' | ')).join('\n');
}
function collect() { const o = { ...S };
  o.fallbacks = ($('fallbacksText').value || '').split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((a) => a[0]).map(([provider, model, key]) => ({ provider, model: model || (META.presets[provider] || {}).model || '', key: key || '', base: '' })); for (const f of FIELDS) { const el = $(f); if (!el) continue; o[f] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value; } return o; }

async function init() {
  META = await iop.getSettings(); S = META.settings;
  $('provider').innerHTML = Object.entries(META.presets).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  $('profile').innerHTML = Object.entries(META.profiles).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  $('localModel').innerHTML = META.choices.map((c) => `<option value="${c.id}" ${c.id === META.recommended ? 'selected' : ''}>${esc(c.label)}${c.id === META.recommended ? ' ← для этого ПК' : ''}</option>`).join('');
  fill();
  if (META.session.wayland) { const wl = META.session.wl || {}; if (wl.ready) add('info', 'Wayland: работаю через портал снимков экрана и ydotool. При первом снимке GNOME может один раз спросить разрешение.'); else add('error', 'Wayland: не хватает: ' + (wl.missing || []).join(', ') + '. Запустите install.sh (поставит ydotool, python3-gi, xdg-desktop-portal-gnome, gnome-screenshot и настроит доступ) — или: sudo apt install ydotool python3-gi xdg-desktop-portal-gnome gnome-screenshot'); }
  const h = await iop.history();
  for (const e of h) { if (e.role === 'user') add('user', e.text); else if (e.role === 'assistant') add('assistant', e.text); }
  const intr = await iop.interrupted();
  if (intr) { $('resume').hidden = false; add('info', `Предыдущая задача была прервана на шаге ${intr.step}: «${intr.task}». Нажмите «Продолжить прерванную», чтобы продолжить с сохранённого состояния.`); }
  if (!h.length) add('info', 'Привет! Это единый чат: вся история сохраняется на диске и не теряется. Напиши задачу — ИИ будет смотреть на экран и сам нажимать мышью и клавиатурой. Остановить — кнопка «Стоп» или Ctrl+Alt+Q.');
}
$('provider').onchange = async () => {
  const p = META.presets[$('provider').value]; $('base').value = ''; $('base').placeholder = p.base; if (p.model) $('model').value = p.model;
  const g = await iop.guessProfile($('provider').value, $('model').value); $('profile').value = g.profile; $('coords').value = g.coords;
  $('visionWarn').hidden = p.vision !== false;
};
$('model').onchange = async () => { const g = await iop.guessProfile($('provider').value, $('model').value); $('profile').value = g.profile; $('coords').value = g.coords; };
$('save').onclick = async () => { S = await iop.saveSettings(collect()); $('testRes').textContent = 'Сохранено ✓'; };
$('loadModels').onclick = async () => { const l = await iop.listModels(collect()); $('modelList').innerHTML = l.map((m) => `<option value="${esc(m)}">`).join(''); $('testRes').textContent = l.length ? `Моделей: ${l.length}` : 'Список не получен'; };
$('test').onclick = async () => { $('testRes').textContent = 'Проверяю…'; const r = await iop.testConnection(collect()); $('testRes').textContent = r.ok ? `✓ Ответ за ${r.sec} с: ${r.text}` : '✗ ' + r.error; };
$('shotTest').onclick = async () => { await iop.saveSettings(collect()); try { const r = await iop.shotTest(); $('shotRes').innerHTML = `Монитор: ${r.mon.width}×${r.mon.height}, снимок: ${r.real.width}×${r.real.height}, модели уйдёт: ${r.model.width}×${r.model.height}<br><img src="${r.preview}">`; } catch (e) { $('shotRes').textContent = String(e); } };
$('openData').onclick = () => iop.openData();
$('savePrompt').onclick = async () => { await iop.writePrompt($('promptText').value); $('envPreview').textContent = 'Сохранено ✓'; };
$('resetPrompt').onclick = async () => { $('promptText').value = await iop.resetPrompt(); };
$('openPrompt').onclick = () => iop.openPrompt();
$('previewEnv').onclick = async () => { $('envPreview').textContent = await iop.previewEnv(); };

async function checkOllama() {
  const st = await iop.ollamaStatus();
  $('ollamaState').innerHTML = st.running ? `✓ Ollama ${esc(st.version)} работает. Модели: ${esc(st.models.join(', ') || 'нет')}` : '✗ Ollama не найдена или не запущена.';
  $('installOllama').hidden = st.running;
}
$('recheck').onclick = checkOllama;
$('installOllama').onclick = async () => {
  if (META.platform === 'win32') iop.openUrl('https://ollama.com/download/OllamaSetup.exe');
  else { const r = await iop.installOllamaLinux(); if (!r.ok) $('ollamaState').textContent = 'Выполните в терминале: ' + r.cmd; else $('ollamaState').textContent = 'Открыл терминал с установкой. После установки нажмите «Проверить снова».'; }
};
$('setupLocal').onclick = async () => {
  $('setupLocal').disabled = true; $('setupProgress').textContent = 'Начинаю…';
  const r = await iop.ollamaSetup({ model: $('localModel').value });
  $('setupLocal').disabled = false;
  if (r.ok) { S = r.settings; fill(); $('setupProgress').textContent = '✓ Готово: включена локальная модель ivan-operator. Можно давать задачи в чате.'; }
  else $('setupProgress').textContent = r.error === 'OLLAMA_NOT_RUNNING' ? '✗ Ollama не запущена.' : '✗ ' + r.error;
};
iop.onSetup((p) => { $('setupProgress').textContent = `${p.status || ''} ${p.pct != null ? p.pct + '%' : ''}`; });
init();

$('resume').onclick = async () => { $('resume').hidden = true; setBusy(true); const r = await iop.resume(); if (!r.ok) setBusy(false); };
async function checkEngine() {
  const st = await iop.engineStatus();
  $('engineModel').innerHTML = st.models.map((m) => `<option value="${m.id}" ${m.id === st.recommended ? 'selected' : ''}>${esc(m.label)}${m.have ? ' ✓ скачана' : ''}${m.id === st.recommended ? ' ← для этого ПК' : ''}</option>`).join('');
  $('engineState').textContent = `${st.installed ? '✓ Движок установлен' : 'Движок не установлен'} · ${st.running ? 'работает' : 'остановлен'} · ${st.gpu ? 'найдена видеокарта (Vulkan/CUDA)' : 'видеокарта не найдена — будет работать на процессоре'}${st.restarts ? ' · перезапусков сторожем: ' + st.restarts : ''}`;
}
$('engineSetup').onclick = async () => {
  $('engineSetup').disabled = true; $('engineBar').hidden = false;
  const r = await iop.engineSetup($('engineModel').value);
  $('engineSetup').disabled = false; $('engineBar').hidden = true;
  if (r.ok) { S = r.settings; fill(); $('setupProgress').textContent = '✓ Встроенная модель запущена и выбрана в настройках. Можно давать задачи в чате.'; }
  else $('setupProgress').textContent = '✗ ' + r.error;
  checkEngine();
};
$('engineCancel').onclick = () => iop.engineCancel();
$('engineStop').onclick = async () => { await iop.engineStop(); checkEngine(); };
iop.onSetup((p) => { if (p.pct != null) $('engineBar').value = p.pct; });
async function scanAdb() { const d = await iop.androidStatus(); $('adbState').textContent = !d.available ? 'adb не установлен.' : d.list.length ? d.list.map((x) => `${x.serial}  [${x.state}]  ${x.info || ''}`).join('\n') : 'Устройства не найдены.'; }
$('adbScan').onclick = scanAdb;
$('adbSetup').onclick = async () => { $('adbState').textContent = 'Скачиваю…'; const r = await iop.androidSetup(); $('adbState').textContent = r.ok ? '✓ Установлено: ' + r.bin : '✗ ' + r.error; if (r.ok) scanAdb(); };

// Веб-чат провайдер
(async () => {
  const $w = (i) => document.getElementById(i); const sel = $w('webchat'); if (!sel) return;
  const sites = await window.iop.webchatSites();
  sel.innerHTML = Object.entries(sites).map(([k, v]) => `<option value="${k}">${v.label}${v.guest ? ' — можно без входа' : ''}${v.images ? ' · картинки' : ''}</option>`).join('');
  const st = await window.iop.getSettings(); if (st.settings.webchat) sel.value = st.settings.webchat;
  const sync = () => { $w('webchatBox').style.display = $w('provider').value === 'webchat' ? '' : 'none'; };
  $w('provider').addEventListener('change', sync); sync();
  $w('wcLogin').onclick = async () => { await window.iop.webchatLogin(sel.value, $w('webchatUrl').value || undefined); $w('wcStatus').textContent = 'Окно открыто. Войдите, затем нажмите «Проверить вход».'; };
  $w('wcCheck').onclick = async () => { const r = await window.iop.webchatStatus(sel.value); $w('wcStatus').textContent = !r.open ? 'Окно не открыто' : r.editor ? '✅ Поле ввода найдено — чат готов (' + r.title + ')' : '⚠ Поле ввода не найдено: войдите или примите условия сайта (' + r.url + ')'; };
  $w('wcClear').onclick = async () => { await window.iop.webchatClear(sel.value); $w('wcStatus').textContent = 'Сессия стёрта.'; };
})();

// ---- 1.1.4: пауза, отчёт, рецепты, расписание, удалённый доступ ----
$('pauseBtn').onclick = async () => { if (!(await iop.pause())) await iop.unpause(); };
$('reportBtn').onclick = async () => { const r = await iop.lastReport(); if (!r) alert('Отчёта пока нет — выполните задачу.'); };
$('recipeBtn').onclick = async () => { const n = prompt('Имя рецепта:'); if (!n) return; const r = await iop.recipeSave(n); alert(r.ok ? 'Рецепт сохранён. ИИ увидит его в следующих задачах.' : 'Не сохранено: ' + r.error); };
async function remoteRefresh() {
  const i = await iop.remoteInfo();
  $('rInfo').textContent = i.running ? `Включено: https://${i.lan ? '<IP этого ПК>' : '127.0.0.1'}:${i.port}/#t=${i.token}\nТокен: ${i.token}\nОтпечаток сертификата: ${i.fingerprint}${i.relay ? '\nРетранслятор подключён. Ссылка: <адрес-страницы>?relay=<wss-адрес>#t=<токен>' : ''}` : 'Выключено.';
  const j = await iop.scheduleList(); $('schList').textContent = j.length ? j.map((x) => `#${x.id} ${x.spec}: ${x.task} (след. ${new Date(x.next).toLocaleString()})`).join('\n') : 'нет';
  const r = await iop.recipeList(); $('recList').textContent = Object.keys(r).length ? Object.entries(r).map(([k, v]) => `«${k}» — ${v.actions.length} действий: ${v.task}`).join('\n') : 'нет';
}
$('rStart').onclick = async () => { const r = await iop.remoteStart({ lan: $('rLan').checked, port: $('rPort').value, relay: $('rRelay').value.trim() }); if (!r.ok) alert(r.error); remoteRefresh(); };
$('rStop').onclick = async () => { await iop.remoteStop(); remoteRefresh(); };
$('rOpen').onclick = () => iop.remoteOpen();
$('rReset').onclick = async () => { await iop.remoteResetToken(); remoteRefresh(); };
$('schAdd').onclick = async () => { const r = await iop.scheduleAdd($('schSpec').value, $('schTask').value); if (!r.ok) alert(r.error); remoteRefresh(); };

// 1.2.0: выбор ИИ и конкретного чата прямо в главном окне
(async () => {
  const q = $('qWebchat'); if (!q) return;
  const sites = await iop.webchatSites(); const st = await iop.getSettings();
  const own = st.settings.provider !== 'webchat' ? `<option value="">Из настроек: ${esc(st.settings.provider)}${st.settings.model ? ' / ' + esc(st.settings.model) : ''}</option>` : '';
  q.innerHTML = own + Object.entries(sites).filter(([k]) => k !== 'custom').map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  q.value = st.settings.provider === 'webchat' ? (st.settings.webchat || 'duckai') : '';
  const pick = async () => { if (!q.value) { $('qChatSt').textContent = 'Используется ИИ из настроек'; return; } const url = $('qChatList').value; await iop.webchatPick(q.value, url); $('qChatSt').textContent = url ? 'Работаю в выбранном чате' : 'Будет новый чат'; };
  q.onchange = () => { $('qChatList').innerHTML = '<option value="">➕ Новый чат</option>'; pick(); };
  $('qChatList').onchange = pick;
  $('qChats').onclick = async () => { $('qChatSt').textContent = 'Загружаю список…'; if (!q.value) { $('qChatSt').textContent = 'Сначала выберите веб-чат в списке «ИИ»'; return; } const r = await iop.webchatChats(q.value);
    if (!r.ok || !r.chats.length) { $('qChatSt').textContent = !r.ok ? r.error : r.loggedIn === false ? 'Вы не вошли в этот ИИ — история чатов есть только после входа. Нажмите «Войти в веб-чат» в настройках (или работайте без входа: будет новый чат).' : 'Вход есть, но сохранённых чатов пока нет — будет новый чат.'; return; }
    $('qChatList').innerHTML = '<option value="">➕ Новый чат</option>' + r.chats.map((c) => `<option value="${esc(c.url)}">${esc(c.title)}</option>`).join(''); $('qChatSt').textContent = 'Чатов: ' + r.chats.length; };
  iop.onCompact && iop.onCompact((on) => document.body.classList.toggle('compact', on));
})();

// ===== 1.3.0: вкладка «Автономия» =====
const AU = (op, a) => iop.auto(op, a);
const auShow = (id, r) => { $(id).textContent = r && r.ok === false ? 'Ошибка: ' + r.error : (typeof r === 'string' ? r : JSON.stringify(r, null, 1)); };
async function autoRefresh() {
  const { settings: s } = await iop.getSettings();
  $('auDirs').value = (s.projectDirs || []).join('\n'); $('auSkills').checked = s.autoSkills !== false; $('auAutoSwitch').checked = s.autoModelSwitch !== false; $('auAdaptive').checked = s.adaptiveModels !== false; $('auCp').checked = s.autoCheckpoint !== false; $('auModelRisk').checked = !!s.modelRisk; $('auThr').value = s.riskConfirmThreshold || 55; $('auIter').value = s.testMaxIter || 5;
  tmRefresh(); skRefresh();
}
async function tmRefresh() {
  const r = await AU('tm-list'); if (!r.ok) return auShow('tmOut', r);
  $('tmList').innerHTML = r.list.length ? r.list.map((c) => `<div class="row"><span>${esc(new Date(c.ts).toLocaleString())} — ${esc(c.label)} (${c.files} файлов${c.reason ? ', ' + esc(String(c.reason).slice(0, 60)) : ''})</span><button data-tm="diff" data-id="${esc(c.id)}">Что изменилось</button><button data-tm="restore" data-id="${esc(c.id)}">Вернуть</button><button data-tm="remove" data-id="${esc(c.id)}">Удалить</button></div>`).join('') : '<p class="hint">Точек пока нет.</p>';
}
async function skRefresh() {
  const r = await AU('skills-list'); if (!r.ok) return auShow('skOut', r);
  $('skList').innerHTML = r.list.length ? r.list.map((k) => `<div class="row"><b>${esc(k.name)}</b><span> v${k.version} · запусков ${k.stats ? k.stats.runs : 0}, ошибок ${k.stats ? k.stats.fail : 0} · параметры: ${esc((k.params || []).map((p) => p.name).join(', ') || 'нет')}</span><button data-sk="run" data-n="${esc(k.name)}">Запустить</button><button data-sk="improve" data-n="${esc(k.name)}">Улучшить</button><button data-sk="rollback" data-n="${esc(k.name)}">Откатить</button><button data-sk="export" data-n="${esc(k.name)}">Экспорт</button><button data-sk="remove" data-n="${esc(k.name)}">Удалить</button></div>`).join('') : '<p class="hint">Навыков пока нет — они появятся после успешных задач.</p>';
}
$('auSave').onclick = async () => { const { settings: s } = await iop.getSettings(); await iop.saveSettings({ ...s, autoModelSwitch: $('auAutoSwitch').checked, projectDirs: $('auDirs').value.split('\n').map((x) => x.trim()).filter(Boolean), autoSkills: $('auSkills').checked, adaptiveModels: $('auAdaptive').checked, autoCheckpoint: $('auCp').checked, modelRisk: $('auModelRisk').checked, riskConfirmThreshold: Number($('auThr').value) || 55, testMaxIter: Math.max(1, Math.min(20, Number($('auIter').value) || 5)) }); auShow('tmOut', 'Настройки сохранены.'); };
$('tmCreate').onclick = async () => { auShow('tmOut', await AU('tm-create', { label: $('tmLabel').value })); tmRefresh(); };
$('tmRefresh').onclick = tmRefresh;
$('tmList').onclick = async (e) => { const b = e.target.closest('button'); if (!b) return; const id = b.dataset.id;
  if (b.dataset.tm === 'diff') return auShow('tmOut', await AU('tm-diff', { id }));
  if (b.dataset.tm === 'restore') { if (!confirm('Вернуть файлы к этой точке? Перед этим будет создана страховочная точка текущего состояния.')) return; auShow('tmOut', await AU('tm-restore', { id, settings: confirm('Вернуть также настройки программы (ключи не меняются)?') })); return tmRefresh(); }
  if (b.dataset.tm === 'remove') { if (!confirm('Удалить точку?')) return; await AU('tm-remove', { id }); tmRefresh(); } };
$('skRefresh').onclick = skRefresh;
$('skFromLast').onclick = async () => { auShow('skOut', await AU('skill-from-last', { name: $('skName').value || undefined })); skRefresh(); };
$('skImport').onclick = async () => { auShow('skOut', await AU('skill-import', { text: $('skYaml').value, fmt: 'yaml' })); skRefresh(); };
$('skList').onclick = async (e) => { const b = e.target.closest('button'); if (!b) return; const name = b.dataset.n, op = b.dataset.sk;
  if (op === 'run') { const g = await AU('skill-get', { name }); const params = {}; for (const p of (g.skill && g.skill.params) || []) { const v = prompt(`Параметр «${p.name}»`, p.default || ''); if (v === null) return; params[p.name] = v; } auShow('skOut', await AU('skill-run', { name, params })); }
  else if (op === 'improve') auShow('skOut', await AU('skill-improve', { name }));
  else if (op === 'rollback') { const v = prompt('Номер версии для отката (пусто — предыдущая)', ''); if (v === null) return; auShow('skOut', await AU('skill-rollback', { name, version: v ? Number(v) : undefined })); }
  else if (op === 'export') { const r = await AU('skill-export', { name, fmt: 'yaml' }); if (r.ok) $('skYaml').value = r.text; else auShow('skOut', r); }
  else if (op === 'remove') { if (!confirm('Удалить навык?')) return; await AU('skill-remove', { name }); }
  skRefresh(); };
$('wfGen').onclick = async () => { $('wfOut').textContent = 'Строю…'; const r = await AU('wf-generate', { text: $('wfText').value, model: $('wfModel').checked }); if (!r.ok) return auShow('wfOut', r);
  $('wfSteps').value = JSON.stringify(r.steps, null, 1); $('wfOut').textContent = r.steps.map((s, i) => `${i + 1}. [${s.kind}] ${s.title || s.text || s.intent || s.name || ''}  — риск ${s.risk ? s.risk.score : 0}/100`).join('\n') + '\nПроверьте и поправьте шаги, затем «Запустить».'; };
$('wfRun').onclick = async () => { let steps; try { steps = JSON.parse($('wfSteps').value); } catch { return auShow('wfOut', 'Шаги — не JSON'); } auShow('wfOut', await AU('wf-run', { steps })); };
$('tpSearch').onclick = async () => { $('tpList').textContent = 'Ищу…'; const r = await AU('tpl-search', { request: $('tpReq').value, kind: $('tpKind').value }); if (!r.ok) return auShow('adOut', r);
  $('tpList').innerHTML = (r.apiError ? `<p class="hint">GitHub API: ${esc(r.apiError)} — показан проверенный каталог.</p>` : '') + r.items.slice(0, 12).map((x) => `<div class="row"><span><b>${esc(x.repo)}</b> ${x.curated ? '✓' : ''} ${esc(x.why || '')} ${x.license ? '[' + esc(x.license) + ']' : ''} ${esc(x.note || '')}</span><button data-repo="${esc(x.repo)}">Взять за основу</button></div>`).join(''); };
$('tpList').onclick = async (e) => { const b = e.target.closest('button'); if (!b) return; const req = $('tpReq').value || 'минимальные изменения';
  auShow('adOut', await iop.send(`Режим «Заготовки»: {"type":"template_fetch","repo":"${b.dataset.repo}","request":${JSON.stringify(req)}}. Затем измени ТОЛЬКО то, что я прошу: ${req}. Сохрани лицензию и NOTICE.`)); };
$('adRun').onclick = async () => { $('adOut').textContent = 'Проверяю…'; const r = await AU('audit', { dir: $('adDir').value }); auShow('adOut', r.ok ? r.summary : r); };
$('stRefresh').onclick = async () => { const r = await AU('stats'); auShow('adOut', r.ok ? (r.table.length ? r.table.map((t) => `${t.type.padEnd(9)} ${t.prov}  успех ${t.ok}/${t.n} · оценка ${t.score.toFixed(2)}`).join('\n') : 'Статистики пока нет.') : r); };

// ===== 1.2.6 =====
const mmRender = (r) => { if (!r.ok) return auShow('xOut', r); $('mmList').innerHTML = r.list.length ? r.list.map((x) => `<div class="row"><span><b>${esc(x.topic)}</b> — ${esc(String(x.solution).slice(0, 200))}</span><button data-mm="${esc(x.id)}">Удалить</button></div>`).join('') : '<p class="hint">Пусто.</p>'; };
$('mmAdd').onclick = async () => { const r = await AU('mem-add', { topic: $('mmQ').value, solution: $('mmSol').value }); if (!r.ok) return auShow('xOut', r); $('mmSol').value = ''; mmRender(await AU('mem-list')); };
$('mmFind').onclick = async () => mmRender(await AU('mem-search', { query: $('mmQ').value }));
$('mmAll').onclick = async () => mmRender(await AU('mem-list'));
$('mmList').onclick = async (e) => { const b = e.target.closest('button'); if (!b) return; await AU('mem-remove', { id: b.dataset.mm }); mmRender(await AU('mem-list')); };
async function agRefresh() { const r = await AU('agent-list'); if (!r.ok) return auShow('xOut', r); $('agList').innerHTML = (r.list.length ? r.list.map((p) => `<div class="row"><span><b>${esc(p.name)}</b>${p.name === r.active ? ' ✓ активен' : ''} — ${esc(p.description.slice(0, 120))}</span><button data-ag="on" data-n="${esc(p.name)}">Сделать активным</button><button data-ag="del" data-n="${esc(p.name)}">Удалить</button></div>`).join('') : '<p class="hint">Помощников нет.</p>') + (r.active ? '<div class="row"><button data-ag="off">Выключить активного помощника</button></div>' : ''); }
$('agBuild').onclick = async () => { const r = await AU('agent-build', { description: $('agDesc').value, name: $('agName').value || undefined }); auShow('xOut', r.ok ? r.agent.prompt : r); agRefresh(); };
$('agRefresh').onclick = agRefresh;
$('agList').onclick = async (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.ag === 'on') await AU('agent-activate', { name: b.dataset.n }); else if (b.dataset.ag === 'off') await AU('agent-activate', { name: '' }); else if (b.dataset.ag === 'del' && confirm('Удалить помощника?')) await AU('agent-remove', { name: b.dataset.n }); agRefresh(); };
$('rsRun').onclick = async () => { $('xOut').textContent = 'Ищу и читаю источники…'; const r = await AU('research', { topic: $('rsTopic').value }); auShow('xOut', r.ok ? r.report + '\nФайл: ' + r.file : r); };
$('dcRun').onclick = async () => { $('xOut').textContent = 'Проверяю программы…'; const r = await AU('discover', { task: $('dcTask').value }); if (!r.ok) return auShow('xOut', r);
  $('xOut').textContent = 'Есть: ' + r.tools.filter((t) => t.ok).map((t) => t.cmd + (t.version ? ` (${t.version})` : '')).join(', ') + '\nНет: ' + r.tools.filter((t) => !t.ok).map((t) => t.cmd).join(', ') + '\n\nВозможности:\n' + r.capabilities.map((c) => '• ' + c).join('\n') + (r.suggest ? `\n\nДля задачи нужны: ${r.suggest.want.join(', ') || '—'}; не хватает: ${r.suggest.missing.join(', ') || '—'}\n` + r.suggest.install.map((x) => x.command).join('\n') : ''); };
$('mtRun').onclick = async () => { const r = await AU('maintain', {}); auShow('xOut', r.ok ? r.report : r); };
$('mtApply').onclick = async () => { const p = await AU('maintain', {}); if (!p.ok) return auShow('xOut', p); if (!p.report.cleaned.length) return auShow('xOut', 'Удалять нечего.'); if (!confirm('Удалить старые файлы (' + p.report.cleaned.length + ')?\n' + p.report.cleaned.slice(0, 15).join('\n'))) return; auShow('xOut', (await AU('maintain', { apply: true })).report); };
$('pxExport').onclick = async () => auShow('xOut', await AU('export'));
$('pxImport').onclick = async () => auShow('xOut', await AU('import', { settings: $('pxSettings').checked }));

// 1.2.2: быстрый переключатель в главном окне
(async () => { try { const { settings: s } = await iop.getSettings(); $('qAutoSwitch').checked = s.autoModelSwitch !== false; } catch {} })();
$('qAutoSwitch').onchange = async () => { const { settings: s } = await iop.getSettings(); const v = $('qAutoSwitch').checked; await iop.saveSettings({ ...s, autoModelSwitch: v }); if ($('auAutoSwitch')) $('auAutoSwitch').checked = v; };

// 1.2.8: юридическое предупреждение — при первом запуске и после изменения редакции текста
async function legalOpen(force) {
  const L = await iop.legalGet(); const done = L.accepted;
  $('legalState').textContent = L.record ? `принято ${new Date(L.record.date).toLocaleString('ru-RU')} (редакция ${L.record.version})` : 'не принято';
  if (done && !force) return;
  $('legalText').textContent = L.text; $('legalChk').checked = false; $('legalAccept').disabled = true;
  $('legalChkRow').hidden = $('legalAccept').hidden = $('legalQuit').hidden = done; $('legalClose').hidden = !done;
  $('legalModal').hidden = false; $('legalText').scrollTop = 0;
}
$('legalChk').addEventListener('change', () => { $('legalAccept').disabled = !$('legalChk').checked; });
$('legalAccept').onclick = async () => { if (!$('legalChk').checked) return; await iop.legalAccept(); $('legalModal').hidden = true; legalOpen(false); };
$('legalQuit').onclick = () => iop.legalQuit();
$('legalClose').onclick = () => { $('legalModal').hidden = true; };
$('legalShow').onclick = () => legalOpen(true);
legalOpen(false).catch((e) => console.error(e));
