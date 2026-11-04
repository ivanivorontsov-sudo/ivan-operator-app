'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, globalShortcut, safeStorage, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const platform = require('./platform');
const context = require('./context');
const providers = require('./providers');
const webchat = require('./webchat');
providers.webchat = (cfg, m, sig) => webchat.chat(cfg, m, sig);
const localsetup = require('./localsetup');
const sizing = require('./sizing');
const { History } = require('./history');
const { Agent } = require('./agent');
const { Engine, MODELS, recommendModel } = require('./engine');
const android = require('./android');
const browser = require('./browser');
const { Remote, resetToken } = require('./remote');
const recipes = require('./recipes');
const { Scheduler } = require('./scheduler');
let remote = null, scheduler = null;

// сторож процесса: необработанные ошибки не роняют программу, а пишутся в журнал
const crashLog = (e) => { try { fs.appendFileSync(path.join(app.getPath('userData'), 'crash.log'), new Date().toISOString() + ' ' + (e && e.stack || e) + '\n'); } catch {} console.error(e); };
process.on('uncaughtException', crashLog);
process.on('unhandledRejection', crashLog);

// В Linux-сеансе Wayland Electron должен работать через XWayland, чтобы xdotool/захват видели окна
if (process.platform === 'linux') app.commandLine.appendSwitch('ozone-platform-hint', 'x11');
// Чистый User-Agent как у Chrome: без «ИванОператор/1.1.4» (кириллица в заголовке → CloudFront 403 у DeepSeek) и без Electron/x.y
const CLEAN_UA = () => app.userAgentFallback.replace(/\s[^\s()]*[^\x00-\x7F][^\s()]*\/\S+/g, '').replace(/\s(IvanOperator|ivanoperator)\/\S+/gi, '').replace(/\sElectron\/\S+/, '');
app.userAgentFallback = CLEAN_UA();
app.on('session-created', (ses) => { try { ses.setUserAgent(CLEAN_UA(), 'ru-RU,ru,en-US,en'); } catch {} try { if (settings && settings.proxy) require('./vpn').applyProxy(ses, settings.proxy).catch(() => {}); } catch {} });
// Встроенный прокси/VPN (socks5://… или http://…): для окон чатов, интерфейса и внешнего браузера агента
function applyProxyAll() {
  const vpn = require('./vpn'); const { session } = require('electron'); const pr = (settings && settings.proxy) || '';
  try { vpn.parseProxy(pr); } catch (e) { console.warn(e.message); return; }
  for (const id of Object.keys(require('./webchat').SITES)) vpn.applyProxy(session.fromPartition(require('./webchat').partition(id)), pr).catch(() => {});
  vpn.applyProxy(session.defaultSession, pr).catch(() => {});
  require('./browser').setProxy(pr);
}

const DEFAULTS = {
  provider: 'ollama', base: '', key: '', model: 'ivan-operator', profile: 'qwen', coords: 'pixels',
  temperature: 0.1, maxTokens: 700, numCtx: 16384, contextBudget: 14000, timeoutSec: 600,
  maxSteps: 40, webchatImages: true, pauseEvery: 0, webchatNewChat: false, webchatRotateTurns: 0, settleMs: 900, precise: true, useMarks: true, uiMode: 'hybrid', grid: false, hideWindow: false, monitor: 0,
  confirmCommands: false, recordRuns: true, allowedDomains: '', blockedDomains: '', proxy: '', remoteEnabled: false, remoteLan: false, remotePort: 8787, remoteRelay: '', typeViaClipboard: false, jpegQuality: 82, cmdTimeoutSec: 120,
  retries: 4, fallbacks: [], maxMinutes: 60, engineModel: '',
  taskTokenBudget: 0, maxHops: 4, maxRetriesTask: 12, autoFailover: true, hangSec: 90, webchatMaxTurns: 10, webchatKeepChat: false, settingsVersion: 130,
  autoSkills: true, adaptiveModels: true, autoModelSwitch: true, autoCheckpoint: true, projectDirs: [], riskConfirmThreshold: 55, testMaxIter: 5, modelRisk: false,
};

const legal = require('./legal');
let win = null, history = null, agent = null, settings = null, engine = null;
const dataDir = () => app.getPath('userData');
const settingsFile = () => path.join(dataDir(), 'settings.json');

function loadSettings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch {}
  if (s.keyEnc) { try { s.key = safeStorage.decryptString(Buffer.from(s.keyEnc, 'base64')); } catch { s.key = ''; } delete s.keyEnc; }
  // 1.2.0: окно больше не сворачивается по Enter (старое значение hideWindow=true сбрасываем один раз)
  if ((s.settingsVersion || 0) < 120) { s.hideWindow = false; s.settingsVersion = 120; }
  if (!s.imagesFix125) { s.webchatImages = true; if (s.uiMode === 'dom' && s.provider === 'webchat') s.uiMode = 'hybrid'; s.imagesFix125 = true; }
  return { ...DEFAULTS, ...s };
}
function saveSettings(s) {
  // принятие условий меняется только через legal-accept (импорт/откат/интерфейс его не затирают и не подделывают)
  s = { ...s, legalAccepted: s && s.legalAcceptNew ? s.legalAcceptNew : (settings && settings.legalAccepted) || undefined }; delete s.legalAcceptNew;
  settings = { ...DEFAULTS, ...s }; if (app.isReady()) applyProxyAll();
  const disk = { ...settings };
  // ключ API хранится только локально; по возможности — зашифрованным средствами ОС
  if (disk.key && safeStorage.isEncryptionAvailable()) { disk.keyEnc = safeStorage.encryptString(disk.key).toString('base64'); delete disk.key; }
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(disk, null, 2));
  return settings;
}

const tokFile = () => path.join(dataDir(), 'tokens.json');
const TOK = { prev: 0, session: 0, sessions: 0, task: 0 };
function tokLoad() { try { const t = JSON.parse(fs.readFileSync(tokFile(), 'utf8')); TOK.prev = (Number(t.prev) || 0) + (Number(t.session) || 0); TOK.sessions = (Number(t.sessions) || 0) + (t.session ? 1 : 0); } catch {} TOK.session = 0; TOK.task = 0; tokSave(); }
function tokSave() { try { fs.mkdirSync(dataDir(), { recursive: true }); fs.writeFileSync(tokFile(), JSON.stringify({ prev: TOK.prev, session: TOK.session, sessions: TOK.sessions, saved: new Date().toISOString() })); } catch {} }
function tokTrack(ev) { if (ev.kind !== 'tokens') return ev; const tt = Number(ev.total) || 0; const d = tt < TOK.task ? tt : tt - TOK.task; TOK.task = Number(ev.total) || 0; TOK.session += d; tokSave(); return { ...ev, session: TOK.session, prev: TOK.prev, all: TOK.prev + TOK.session }; }
webchat.onLog = (kind, text) => emit({ kind, text });
function emit(ev) { if (ev && ev.kind === 'user') TOK.task = 0; ev = tokTrack(ev); if (remote) try { remote.broadcast(ev); } catch {} if (win && !win.isDestroyed()) win.webContents.send('agent-event', ev); if (process.env.IOP_LOG) console.log('[event]', JSON.stringify({ ...ev, shot: ev.shot ? '<img>' : undefined })); }

function createWindow() {
  win = new BrowserWindow({ width: 1100, height: 760, minWidth: 760, minHeight: 520, title: 'ИванОператор', icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'index.html'));
  // сторож окна: если интерфейс упал или завис — перезагрузить его (задача агента в главном процессе продолжается)
  win.webContents.on('render-process-gone', (_e, d) => { crashLog('renderer gone: ' + d.reason); setTimeout(() => win && !win.isDestroyed() && win.reload(), 1000); });
  win.on('unresponsive', () => { crashLog('window unresponsive'); setTimeout(() => win && !win.isDestroyed() && win.webContents.forcefullyCrashRenderer(), 15000); });
}

function makeAgent() {
  agent = new Agent({
    app, history, getSettings: () => settings, emit, engine, dataDir: dataDir(),
    // не сворачиваем: компактное окно поверх всех в углу (видно ход работы и кнопку «Стоп»)
    beforeRun: async () => { if (win && !process.env.IOP_HEADLESS && !win.isDestroyed()) { win._bounds = win.getBounds(); const wa = screen.getPrimaryDisplay().workArea; win.setAlwaysOnTop(true, 'floating'); win.setBounds({ x: wa.x + wa.width - 400, y: wa.y + wa.height - 200, width: 380, height: 180 }); win.webContents.send('compact', true); await platform.sleep(150); } },
    afterRun: async () => { if (win && !process.env.IOP_HEADLESS && !win.isDestroyed()) { win.setAlwaysOnTop(false); if (win._bounds) win.setBounds(win._bounds); win.webContents.send('compact', false); } },
    confirm: async (cmd, risks, opts = {}) => {
      emit({ kind: 'confirm', text: cmd, risks });
      if (process.env.IOP_HEADLESS) { const ok = process.env.IOP_ALLOW_CMDS === '1' && !risks; emit({ kind: 'info', text: ok ? 'команда разрешена (тест)' : 'команда ЗАПРЕЩЕНА (тест: опасные всегда запрещены)' }); return ok; }
      if (win) win.restore();
      const danger = risks && risks.length;
      const r = await dialog.showMessageBox(win, { type: danger ? 'error' : 'warning', buttons: danger ? ['Я понимаю риск — выполнить', 'Запретить'] : ['Разрешить', 'Запретить'], defaultId: 1, cancelId: 1, noLink: true,
        title: danger ? '⚠ ОПАСНАЯ ОПЕРАЦИЯ' : 'Подтвердите команду',
        message: danger ? (opts.android ? '⚠ ИИ хочет выполнить опасную операцию с Android-устройством!' : '⚠ ИИ хочет выполнить ОПАСНУЮ команду!') : 'ИИ хочет выполнить команду:',
        detail: cmd + (danger ? '\n\nПочему опасно:\n• ' + risks.join('\n• ') + '\n\nЕсли не уверены — нажмите «Запретить».' : '') });
      if (win && settings.hideWindow && agent && agent.afterRun) { /* остаёмся в компактном окне */ }
      return r.response === 0;
    },
  });
}

try { if (platform.sessionInfo().wayland) platform.ensureYdotoold().catch(() => {}); } catch {}
ipcMain.handle('get-settings', () => ({ settings, presets: providers.PRESETS, profiles: Object.fromEntries(Object.entries(sizing.PROFILES).map(([k, v]) => [k, v.label])), choices: localsetup.CHOICES, recommended: localsetup.recommend(), platform: process.platform, session: { ...platform.sessionInfo(), wl: (() => { try { return platform.waylandStatus(); } catch { return null; } })() }, dataDir: dataDir() }));
ipcMain.handle('save-settings', (_e, s) => saveSettings(s));
ipcMain.handle('legal-get', () => ({ text: legal.LEGAL_TEXT, version: legal.LEGAL_VERSION, accepted: legal.isAccepted(settings), record: settings.legalAccepted || null }));
ipcMain.handle('legal-accept', () => { saveSettings({ ...settings, legalAcceptNew: legal.acceptRecord(app.getVersion()) }); return settings.legalAccepted; });
ipcMain.handle('legal-quit', () => { app.quit(); return true; });
ipcMain.handle('history', () => history.visible().map((e) => ({ role: e.role, text: e.text, raw: e.raw, ts: e.ts })));
ipcMain.handle('send', async (_e, text) => {
  // 1.3.0: «стоп» словами = кнопка «Стоп»; после стопа новая задача ждёт, пока старая полностью остановится
  if (/^\s*(стоп|stop|останови(сь)?|хватит)\s*[.!]*\s*$/i.test(String(text))) { agent.stop(); return { ok: true, stopped: true }; }
  if (agent.running && agent.ctl && agent.ctl.signal.aborted) { for (let i = 0; i < 50 && agent.running; i++) await new Promise((r) => setTimeout(r, 100)); }
  if (agent.running) return { error: 'Уже выполняется' };
  agent.run(text); return { ok: true };
});
ipcMain.handle('interrupted', () => agent.interrupted());
ipcMain.handle('resume', () => { const r = agent.interrupted(); if (!r || agent.running) return { ok: false }; agent.run(r.task, { resume: true }); return { ok: true }; });
ipcMain.handle('engine-status', () => ({ ...engine.status(), models: Object.entries(MODELS).map(([id, m]) => ({ id, label: m.label, have: engine.status().models.includes(id) })) }));
let engineCtl = null;
ipcMain.handle('engine-setup', async (_e, modelId) => {
  // одна кнопка: скачать движок и модель → запустить → настроить программу
  engineCtl = new AbortController();
  const prog = (p) => win && win.webContents.send('setup-progress', p);
  try {
    const id = MODELS[modelId] ? modelId : recommendModel();
    await engine.install(id, prog, engineCtl.signal);
    prog({ status: 'Запускаю модель…' });
    await engine.start(id, prog);
    saveSettings({ ...settings, provider: 'engine', base: 'http://127.0.0.1:8091/v1', model: 'local', key: '', engineModel: id, profile: 'qwen', coords: 'pixels', contextBudget: 14000, timeoutSec: 600, precise: true, useMarks: true });
    return { ok: true, settings };
  } catch (e) { return { ok: false, error: String(e.message || e) }; } finally { engineCtl = null; }
});
ipcMain.handle('engine-cancel', () => { if (engineCtl) engineCtl.abort(); return true; });
ipcMain.handle('engine-stop', () => { engine.stop(); return true; });
ipcMain.handle('android-status', () => android.devices());
ipcMain.handle('android-setup', async () => { try { return { ok: true, bin: await android.install(require('./engine').download, (p) => win && win.webContents.send('setup-progress', p)) }; } catch (e) { return { ok: false, error: String(e.message || e) }; } });
ipcMain.handle('stop', () => { agent.stop(); return true; });
ipcMain.handle('tokens-info', () => ({ session: TOK.session, prev: TOK.prev, all: TOK.prev + TOK.session, sessions: TOK.sessions }));
ipcMain.handle('pause', () => agent.pause());
ipcMain.handle('unpause', () => agent.unpause());
ipcMain.handle('last-report', () => { if (agent.lastReport) shell.openPath(agent.lastReport); return agent.lastReport || null; });
ipcMain.handle('recipe-save', (_e, name) => { try { recipes.save(dataDir(), name, agent.lastTask, agent.lastActions); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } });
// 1.3.0: «Автономия» — машина времени, навыки, конструктор процессов, заготовки, статистика, аудит
ipcMain.handle('auto', async (_e, op, a = {}) => {
  const A = agent.auto; if (!A) return { ok: false, error: 'Модуль автономии не загрузился' };
  const au = require('./auto');
  try {
    switch (op) {
      case 'tm-list': return { ok: true, list: A.tm.list() };
      case 'tm-create': { const paths = au.existingDirs(a.paths && a.paths.length ? a.paths : settings.projectDirs); return { ok: true, ...A.tm.checkpoint({ label: a.label || 'Вручную', paths, settings: au.cleanSettings(settings) }) }; }
      case 'tm-diff': return { ok: true, diff: A.tm.diff(a.id) };
      case 'tm-restore': {
        if (agent.running) return { ok: false, error: 'Сначала остановите задачу' };
        const r = A.tm.restore(a.id, { files: a.files !== false });
        if (a.settings && r.settings) saveSettings({ ...r.settings, key: settings.key, fallbacks: (r.settings.fallbacks || []).map((f, i) => ({ ...f, key: ((settings.fallbacks || [])[i] || {}).key })) });
        return { ok: true, ...r, settings: undefined };
      }
      case 'tm-remove': A.tm.remove(a.id); return { ok: true };
      case 'skills-list': return { ok: true, list: A.skills.list() };
      case 'skill-get': return { ok: true, skill: A.skills.get(a.name) };
      case 'skill-from-last': if (!agent.lastActions || !agent.lastActions.length) return { ok: false, error: 'Нет последней задачи' }; return { ok: true, skill: A.skills.fromTask(agent.lastTask, agent.lastActions, { name: a.name }) };
      case 'skill-run': { if (agent.running) return { ok: false, error: 'Уже выполняется' }; const sk = A.skills.get(a.name); if (!sk) return { ok: false, error: 'Нет навыка' };
        agent.run(`Выполни навык «${sk.name}»: {"type":"run_skill","name":${JSON.stringify(sk.name)},"params":${JSON.stringify(a.params || {})}}. Затем проверь результат и ответь done.`); return { ok: true }; }
      case 'skill-improve': {
        const sk = A.skills.get(a.name); if (!sk) return { ok: false, error: 'Нет навыка' };
        const chat = (msgs) => agent.chat(settings, msgs);
        const propose = async (skill, failures) => { const r = await chat([{ role: 'user', content: [{ type: 'text', text: `Навык (JSON) ломается. Исправь шаги. Верни ТОЛЬКО JSON {"steps":[...]}.\nНавык: ${JSON.stringify({ name: skill.name, params: skill.params, steps: skill.steps })}\nСбои: ${JSON.stringify(failures.slice(-3))}` }] }]); const j = require('./parse').extractJson(r.text); if (!j || !Array.isArray(j.steps)) throw new Error('Модель не дала шаги'); return { steps: j.steps, params: j.params }; };
        const verify = async (cand) => { // сухой прогон: каждый шаг — известное действие, параметры подставляются, нет критического риска
          const known = /^(click|double_click|right_click|move|type|key|hotkey|scroll|drag|open_app|run|wait|os|checkpoint|run_tests|audit|template_search|template_fetch|github|adb|fastboot|android_devices|browser_\w+|research|memory_add|memory_search|discover|analyze_screen|maintain)$/;
          for (const [i, st] of cand.steps.entries()) {
            if (!known.test(st.type)) return { ok: false, why: `шаг ${i + 1}: неизвестное действие ${st.type}` };
            if (st.type === 'os') try { au.osexec.build(st.intent, st.args || {}); } catch (e) { return { ok: false, why: `шаг ${i + 1}: ${e.message}` }; }
            const r = au.risk.assess(st); if (r.level === 'critical') return { ok: false, why: `шаг ${i + 1}: критический риск (${r.reasons[0]})` };
          }
          return { ok: true, why: 'сухой прогон пройден' };
        };
        return { ok: true, ...(await A.skills.improve(a.name, propose, verify)) };
      }
      case 'skill-rollback': return { ok: true, skill: A.skills.rollback(a.name, a.version) };
      case 'skill-remove': A.skills.remove(a.name); return { ok: true };
      case 'skill-export': return { ok: true, text: A.skills.exportText(a.name, a.fmt || 'yaml') };
      case 'skill-import': return { ok: true, skill: A.skills.importText(a.text, a.fmt || 'yaml') };
      case 'wf-generate': { const steps = a.model ? await au.workflow.generateWithModel(a.text, (m) => agent.chat(settings, m), { skills: A.skills.list() }) : au.workflow.generate(a.text, { skills: A.skills.list() }); return { ok: true, steps: au.workflow.preview(steps) }; }
      case 'wf-run': { if (agent.running) return { ok: false, error: 'Уже выполняется' }; const v = au.workflow.validate(a.steps); if (v && v.length) return { ok: false, error: v.join('; ') }; agent.run(au.workflow.toTask(a.steps)); return { ok: true }; }
      case 'tpl-search': return { ok: true, ...(await au.templates.search(a.request, { kind: a.kind || undefined })) };
      case 'stats': return { ok: true, table: A.stats.table() };
      case 'audit': { const dir = a.dir; if (!dir || !fs.existsSync(dir)) return { ok: false, error: 'Нет папки' }; const files = au.risk.auditFiles(dir); const deps = await au.risk.auditDeps(dir, au.runFile, au.has); return { ok: true, summary: au.risk.auditSummary(files, deps), files: files.slice(0, 100), deps }; }
      case 'risk': return { ok: true, ...au.risk.assessCommand(a.command || '') };
      // 1.2.6
      case 'mem-list': return { ok: true, list: A.memory.all().slice(-200).reverse() };
      case 'mem-add': return { ok: true, item: A.memory.add({ topic: a.topic, solution: a.solution, verified: true, source: 'Иван' }) };
      case 'mem-search': return { ok: true, list: A.memory.search(a.query || '', 10) };
      case 'mem-remove': A.memory.remove(a.id); return { ok: true };
      case 'agent-build': { const p = A.agents.build(a.description, { name: a.name }); A.agents.save(p); return { ok: true, agent: p }; }
      case 'agent-list': return { ok: true, list: A.agents.list(), active: settings.activeAgent || '' };
      case 'agent-activate': saveSettings({ ...settings, activeAgent: a.name || '' }); return { ok: true };
      case 'agent-remove': A.agents.remove(a.name); if (settings.activeAgent === a.name) saveSettings({ ...settings, activeAgent: '' }); return { ok: true };
      case 'discover': { const r = await au.extra.discover({ has: au.has, run: au.runFile }); return { ok: true, ...r, suggest: a.task ? au.extra.suggestTools(a.task, r.tools, process.platform, () => r.tools.some((t) => t.ok && t.cmd === 'curl')) : null }; }
      case 'maintain': { if (a.apply && agent.running) return { ok: false, error: 'Сначала остановите задачу' }; return { ok: true, report: au.extra.maintain(dataDir(), { apply: !!a.apply }) }; }
      case 'research': { if (!a.topic) return { ok: false, error: 'Нет темы' }; const r = await au.extra.research(a.topic, { chat: (m) => agent.chat(settings, m), dataDir: dataDir() }); return { ok: true, file: r.file, report: r.report }; }
      case 'export': { const b = au.extra.exportBundle(dataDir(), settings); const r = await dialog.showSaveDialog(win, { defaultPath: `ivan-operator-перенос-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'Перенос', extensions: ['json'] }] }); if (r.canceled || !r.filePath) return { ok: false, error: 'Отменено' }; fs.writeFileSync(r.filePath, JSON.stringify(b, null, 1)); return { ok: true, file: r.filePath, files: Object.keys(b.files).length }; }
      case 'import': { const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Перенос', extensions: ['json'] }] }); if (r.canceled || !r.filePaths[0]) return { ok: false, error: 'Отменено' }; const b = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); const out = au.extra.importBundle(dataDir(), b, { overwrite: !!a.overwrite }); if (a.settings) saveSettings({ ...settings, ...out.settings, key: settings.key, fallbacks: settings.fallbacks }); return { ok: true, imported: out.imported, skipped: out.skipped }; }
      default: return { ok: false, error: 'Неизвестная операция' };
    }
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle('recipe-list', () => recipes.load(dataDir()));
ipcMain.handle('recipe-delete', (_e, name) => { recipes.remove(dataDir(), name); return true; });
ipcMain.handle('schedule-add', (_e, spec, task) => { try { return { ok: true, job: scheduler.add(spec, task) }; } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle('schedule-list', () => scheduler.list());
ipcMain.handle('schedule-remove', (_e, id) => scheduler.remove(id));
ipcMain.handle('remote-info', () => remote.server ? remote.info() : { running: false });
ipcMain.handle('remote-start', async (_e, o = {}) => { try { settings.remoteEnabled = true; settings.remoteLan = !!o.lan; settings.remoteRelay = o.relay || ''; saveSettings(settings); remote.stop(); const i = await remote.start({ port: Number(o.port) || 8787, lan: !!o.lan }); if (o.relay) await remote.connectRelay(o.relay); return { ok: true, ...remote.info() }; } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle('remote-stop', () => { settings.remoteEnabled = false; saveSettings(settings); return remote.stop(); });
ipcMain.handle('remote-reset-token', () => { const run = !!remote.server, lan = remote.lan, port = remote.port; remote.stop(); resetToken(dataDir()); return run ? remote.start({ port, lan }) : { ok: true }; });
ipcMain.handle('remote-open', () => { if (remote.server) shell.openExternal(`https://127.0.0.1:${remote.port}/#t=${remote.info().token}`); });
ipcMain.handle('open-prompt', () => { shell.openPath(context.ensurePrompt(app)); return context.promptPath(app); });
ipcMain.handle('read-prompt', () => context.readPrompt(app));
ipcMain.handle('write-prompt', (_e, t) => { fs.writeFileSync(context.ensurePrompt(app), t); return true; });
ipcMain.handle('reset-prompt', () => { fs.copyFileSync(path.join(__dirname, 'default_prompt.md'), context.promptPath(app)); return context.readPrompt(app); });
ipcMain.handle('open-data', () => shell.openPath(dataDir()));
ipcMain.handle('preview-env', async () => {
  const mon = await platform.pickMonitor(settings.monitor || 0);
  const t = sizing.targetSize(settings.profile, mon.width, mon.height);
  return context.readPrompt(app) + '\n\n' + await context.environment(app, { mon, img: t, coords: settings.coords, monitors: await platform.monitors() });
});
ipcMain.handle('webchat-sites', () => webchat.SITES);
ipcMain.handle('webchat-login', (_e, id, url) => webchat.openLogin(id, url));
ipcMain.handle('webchat-status', (_e, id) => webchat.loggedIn(id));
ipcMain.handle('webchat-chats', async (_e, id) => { try { const r = await webchat.listChats(id, true); return { ok: true, chats: r.chats, loggedIn: r.loggedIn }; } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle('webchat-pick', (_e, id, url) => { saveSettings({ ...settings, provider: 'webchat', webchat: id, webchatUrl: url || '', webchatKeepChat: true }); try { const w = webchat.wins[id]; if (url && w && !w.isDestroyed() && w.webContents.getURL() !== url) w.loadURL(url); } catch {} return settings; });
ipcMain.handle('webchat-clear', (_e, id) => webchat.clearSession(id));
ipcMain.handle('list-models', (_e, cfg) => providers.listModels(cfg));
ipcMain.handle('guess-profile', (_e, p, m) => sizing.guessProfile(p, m));
ipcMain.handle('test-connection', async (_e, cfg) => {
  try {
    const t0 = Date.now();
    const r = await providers.chat({ ...cfg, maxTokens: 30, timeoutSec: 120 }, [{ role: 'user', content: [{ type: 'text', text: 'Ответь одним словом: работает' }] }]);
    return { ok: true, text: r.text.slice(0, 200), sec: ((Date.now() - t0) / 1000).toFixed(1) };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle('ollama-status', (_e, base) => localsetup.status(base || 'http://127.0.0.1:11434'));
ipcMain.handle('ollama-setup', async (_e, opts) => {
  try {
    const changes = await localsetup.setup({ base: opts.base || 'http://127.0.0.1:11434', model: opts.model, onProgress: (p) => win.webContents.send('setup-progress', p) });
    saveSettings({ ...settings, ...changes, key: '' });
    return { ok: true, settings };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle('open-url', (_e, u) => { if (/^https:\/\//.test(u)) shell.openExternal(u); });
ipcMain.handle('install-ollama-linux', () => {
  const cmd = 'curl -fsSL https://ollama.com/install.sh | sh; echo; echo Готово, закройте окно.; read x';
  for (const t of [['x-terminal-emulator', ['-e', 'bash', '-c', cmd]], ['gnome-terminal', ['--', 'bash', '-c', cmd]], ['konsole', ['-e', 'bash', '-c', cmd]], ['xfce4-terminal', ['-x', 'bash', '-c', cmd]], ['xterm', ['-e', 'bash', '-c', cmd]]])
    if (platform.has(t[0])) { require('child_process').spawn(t[0], t[1], { detached: true, stdio: 'ignore' }).unref(); return { ok: true }; }
  return { ok: false, cmd: 'curl -fsSL https://ollama.com/install.sh | sh' };
});
ipcMain.handle('shot-test', async () => {
  // проверка: снимок экрана и калибровка
  const { img, mon } = await platform.screenshot(settings.monitor || 0);
  const t = sizing.targetSize(settings.profile, mon.width, mon.height);
  return { mon, real: img.getSize(), model: t, preview: 'data:image/jpeg;base64,' + img.resize({ width: 480 }).toJPEG(70).toString('base64') };
});

app.whenReady().then(async () => {
  settings = loadSettings();
  // режим без окна для автотестов: IOP_SETTINGS=файл.json IOP_TASK="..."
  if (process.env.IOP_SETTINGS) settings = { ...settings, ...JSON.parse(fs.readFileSync(process.env.IOP_SETTINGS, 'utf8')) };
  applyProxyAll();
  if (process.env.IOP_KEY_ENV && process.env[process.env.IOP_KEY_ENV]) settings.key = process.env[process.env.IOP_KEY_ENV];
  tokLoad();
  history = new History(process.env.IOP_DATA || dataDir());
  engine = new Engine(dataDir(), (t) => emit({ kind: 'info', text: 'Сторож движка: ' + t }));
  android.init(dataDir());
  // встроенная модель запускается вместе с программой
  if (settings.provider === 'engine' && settings.engineModel) engine.start(settings.engineModel).catch((e) => emit({ kind: 'warn', text: 'Встроенная модель не запустилась: ' + e.message }));
  makeAgent();
  // 1.2.8: без принятия юридического предупреждения агент не запускается (окно, удалённо, по расписанию)
  { const run0 = agent.run.bind(agent); agent.run = (...a) => { if (!legal.isAccepted(settings) && !process.env.IOP_HEADLESS) { emit({ kind: 'error', text: 'Сначала примите условия использования (Настройки → Юридическая информация).' }); return Promise.resolve({ ok: false, error: 'legal' }); } return run0(...a); }; }
  remote = new Remote(dataDir(), {
    run: (t) => { if (agent.running) return { ok: false, error: 'Уже выполняется задача' }; emit({ kind: 'info', text: 'Задача пришла удалённо.' }); agent.run(t); return { ok: true }; },
    stop: () => agent.stop(), pause: () => agent.pause(), unpause: () => agent.unpause(),
    status: () => ({ running: !!agent.running, paused: !!agent.paused, version: app.getVersion() }),
    history: () => history.visible().map((e) => ({ role: e.role, text: e.text, ts: e.ts })),
    screen: async () => { const { img } = await platform.screenshot(settings.monitor || 0); return img.resize({ width: Math.min(1280, img.getSize().width) }).toJPEG(60); },
  });
  scheduler = new Scheduler((t) => agent.run(t), () => agent.running);
  if (settings.remoteEnabled || process.env.IOP_REMOTE) remote.start({ port: Number(process.env.IOP_REMOTE_PORT || settings.remotePort || 8787), lan: !!settings.remoteLan && !process.env.IOP_REMOTE })
    .then((i) => { emit({ kind: 'info', text: `Удалённый доступ: https://${i.lan ? '<IP-компьютера>' : '127.0.0.1'}:${i.port}` }); if (process.env.IOP_REMOTE_INFO) fs.writeFileSync(process.env.IOP_REMOTE_INFO, JSON.stringify(i)); if (settings.remoteRelay) remote.connectRelay(settings.remoteRelay).catch((e) => emit({ kind: 'warn', text: 'Ретранслятор: ' + e.message })); })
    .catch((e) => emit({ kind: 'warn', text: 'Удалённый доступ не запустился: ' + e.message }));
  globalShortcut.register('Control+Alt+Q', () => agent.stop());
  if (process.env.IOP_HEADLESS) {
    const r = process.env.IOP_RESUME && agent.interrupted() ? await agent.run(agent.interrupted().task, { resume: true }) : await agent.run(process.env.IOP_TASK || 'Сделай снимок и опиши экран');
    await browser.close().catch(() => {}); engine.stop();
    console.log('[result]', JSON.stringify(r));
    if (process.env.IOP_RECIPE_SAVE) { try { recipes.save(dataDir(), process.env.IOP_RECIPE_SAVE, agent.lastTask, agent.lastActions); console.log('[event]', JSON.stringify({ kind: 'info', text: 'рецепт сохранён: ' + process.env.IOP_RECIPE_SAVE })); } catch (e) { console.log('[event]', JSON.stringify({ kind: 'warn', text: 'рецепт не сохранён: ' + e.message })); } }
    if (process.env.IOP_SCHEDULE) { const runs0 = scheduler.runs || 0; const j = scheduler.add(process.env.IOP_SCHEDULE, process.env.IOP_SCHEDULE_TASK || process.env.IOP_TASK); console.log('[event]', JSON.stringify({ kind: 'info', text: 'расписание: ' + JSON.stringify(j) })); const end = Date.now() + 200e3; while (Date.now() < end && (scheduler.runs || 0) === runs0) await platform.sleep(1000); while (agent.running) await platform.sleep(1000); console.log('[event]', JSON.stringify({ kind: 'info', text: 'запусков по расписанию: ' + ((scheduler.runs || 0) - runs0) })); }
    if (process.env.IOP_KEEP_SEC) { const end = Date.now() + Number(process.env.IOP_KEEP_SEC) * 1000; while (Date.now() < end) await platform.sleep(1000); }
    app.exit(0); return;
  }
  createWindow();
});
app.on('window-all-closed', () => { platform.stop(); engine && engine.stop(); browser.close().catch(() => {}); app.quit(); });
app.on('before-quit', () => { try { webchat.flushAll(); } catch {} });
app.on('will-quit', () => { globalShortcut.unregisterAll(); webchat.closeAll(); });
