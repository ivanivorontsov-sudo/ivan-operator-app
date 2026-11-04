'use strict';
// Цикл агента: снимок → модель → действие → проверочный снимок → …
const platform = require('./platform');
const imaging = require('./imaging');
const sizing = require('./sizing');
const providers = require('./providers');
const context = require('./context');
const { buildMessages, estimateTokens, mechanicalSummary } = require('./history');
const { parseReply, extractJson } = require('./parse');
const { robustChat, classify, RU } = require('./watchdog');
const browser = require('./browser');
const android = require('./android');
const safety = require('./safety');
const github = require('./github');
const fs = require('fs');
const domains = require('./domains');
const recipes = require('./recipes');
const { Recorder } = require('./recorder');
const guard = require('./guard');
const { Autonomy } = require('./auto');

const CLICKS = new Set(['click', 'double_click', 'triple_click', 'right_click', 'middle_click', 'move']);

// Уложить запрос в контекст модели: убираем самые старые реплики (кроме системной и последней),
// затем укорачиваем длинные тексты (системный промпт и наблюдение) — для локальных моделей с -c 4096.
function fitMessages(msgs, budget) {
  if (!budget || estimateTokens(msgs) <= budget) return msgs;
  const out = msgs.slice();
  while (out.length > 2 && estimateTokens(out) > budget) out.splice(1, 1);
  for (let guard = 0; guard < 8 && estimateTokens(out) > budget; guard++) {
    for (const m of out) m.content = m.content.map((c) => (c.type === 'text' && c.text.length > 1500) ? { ...c, text: c.text.slice(0, Math.floor(c.text.length * 0.75)) + '\n…[сокращено]' } : c);
  }
  return out;
}

class Agent {
  constructor({ app, history, getSettings, emit, beforeRun, afterRun, confirm, engine, dataDir }) {
    Object.assign(this, { app, history, getSettings, emit, beforeRun, afterRun, confirm, engine, dataDir });
    this.running = false; this.ctl = null;
    try { this.auto = dataDir ? new Autonomy(dataDir) : null; } catch (e) { this.auto = null; }
  }
  stop() { this.paused = false; if (this.ctl) this.ctl.abort(); browser.stopAll().catch(() => {}); try { require('./webchat').stopGenerating(); } catch {} if (this.running) this.emit({ kind: 'info', text: 'Стоп: всё отменено.' }); }
  async runRecipe(a, s, obs, parsed, stats, setClick) {
    const r = recipes.load(this.dataDir)[a.name];
    if (!r) return 'ОШИБКА: рецепт «' + a.name + '» не найден.';
    this.emit({ kind: 'info', text: `Повторяю рецепт «${a.name}» (${r.actions.length} действий) без модели.` });
    const out = await recipes.replay(r.actions, (x) => this.execute(x, s, obs, parsed, stats, setClick), (i, x, res) => this.emit({ kind: 'result', text: `рецепт #${i + 1} ${x.type}: ${String(res).slice(0, 200)}` }));
    return out.ok ? `Рецепт «${a.name}» выполнен полностью. Проверь результат и верни done.` : `Рецепт «${a.name}» сорвался на шаге ${out.at + 1}: ${String(out.error).slice(0, 300)}. Продолжи задачу сам.`;
  }
  pause() { if (!this.running || this.paused) return false; this.paused = true; this.emit({ kind: 'info', text: 'Пауза: управление у Ивана. Нажмите «Продолжить», когда закончите.' }); return true; }
  unpause() { if (!this.paused) return false; this.paused = false; this._manual = true; this.emit({ kind: 'info', text: 'Продолжаю после ручного управления.' }); return true; }

  // 1.2.0: мгновенная отмена (abortable), счётчик токенов, бюджет задачи, общий лимит повторов
  async chat(s, msgs, schema) {
    const sig = this.ctl && this.ctl.signal;
    const onRetry = () => { const why = this.hops && this.hops.retry(); if (why) throw Object.assign(new Error('Сторож: ' + why + '. Останавливаю, чтобы не зациклиться.'), { kind: 'loop' }); };
    const lim = (s.stepTimeoutSec || 300) * 1000; let tm;
    const timeout = new Promise((_, rej) => { tm = setTimeout(() => rej(Object.assign(new Error(`Модель не ответила за ${lim / 1000} с — переключаюсь/останавливаюсь (шаг не завис).`), { timeout: true, code: 'ETIMEDOUT' })), lim); });
    const r = await Promise.race([timeout, guard.abortable(robustChat({ ...this.modelCfg(s), schema: s.jsonSchema === false ? null : schema }, msgs, { emit: this.emit, engine: this.engine, signal: sig, tries: s.retries || 4, onRetry }), sig)]).finally(() => clearTimeout(tm));
    if (this.meter) { this.meter.add(msgs, r); this.emit({ kind: 'tokens', ...this.meter.snapshot() }); if (this._stats) this._stats.tokens = this.meter.snapshot(); if (this.meter.over()) { const e = guard.budgetError(this.meter); this.emit({ kind: 'warn', text: e.message }); if (this.ctl) this.ctl.abort(); throw e; } }
    return r;
  }
  async quickIntent(qi) {
    try {
      if (qi.type === 'url') { const r = await platform.shellRun(process.platform === 'win32' ? `start "" "${qi.url}"` : `xdg-open '${qi.url.replace(/'/g, '')}'`).catch(() => null); return r === null ? null : `Открыл ${qi.url} в браузере по умолчанию (быстрая команда, без модели).`; }
      for (const n of qi.names) { if (this.ctl.signal.aborted) return null; const r = await platform.openApp(n).catch(() => null); if (r && r.ok !== false && (r.window || r.found)) return `Запустил «${r.launched || n}»${r.window ? ' — окно: «' + r.window + '»' : ' (окно ещё загружается)'} (быстрая команда, без модели).`; }
    } catch {}
    return null; // не вышло — пусть решает модель
  }
  provId(s) { return s.provider === 'webchat' ? 'webchat:' + (s.webchat || 'duckai') : s.provider + ':' + (s.model || ''); }

  saveRun(st) { try { fs.writeFileSync(require('path').join(this.history.dir, 'run.json'), JSON.stringify(st)); } catch {} }
  interrupted() { try { const r = JSON.parse(fs.readFileSync(require('path').join(this.history.dir, 'run.json'), 'utf8')); return r.running ? r : null; } catch { return null; } }

  // ждём, пока экран «успокоится» (анимации, загрузка), чтобы не действовать по устаревшему кадру
  async waitStable(s, maxMs = 3000) {
    if (this.mode(s) === 'dom') return platform.sleep(250); // быстрый режим: без снимков
    let prev = null; const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      try { const { img } = await platform.screenshot(s.monitor || 0); const sig = imaging.signature(img); if (prev && imaging.diffRatio(prev, sig) < 0.003) return; prev = sig; } catch { return; }
      await platform.sleep(s.stablePollMs || 150);
    }
  }
  // 1.2.6: адаптивное ожидание вместо фиксированных пауз — выходим, как только 2 кадра подряд совпали (или истёк предел)
  async settle(s, maxMs, a) {
    const NON_GUI = /^(run|os|run_tests|audit|template_\w+|checkpoint|run_skill|run_recipe|ask_user|done|wait|zoom|screenshot|android_\w+|adb|fastboot|github|browser_read|research|swarm|parallel|memory_\w+|discover|maintain|analyze_screen|build_agent)$/;
    if (a && NON_GUI.test(a.type)) return;
    if (s.adaptiveSettle === false) return platform.sleep(maxMs);
    if (this.mode(s) === 'dom') return platform.sleep(Math.min(maxMs, 250));
    await platform.sleep(Math.min(120, maxMs));
    let prev = null; const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      try { const { img } = await platform.screenshot(s.monitor || 0); const sig = imaging.signature(img); if (prev && imaging.diffRatio(prev, sig) < 0.003) return; prev = sig; } catch { return platform.sleep(Math.max(0, maxMs - (Date.now() - t0))); }
      await platform.sleep(100);
    }
  }

  modelCfg(s) {
    return { provider: s.provider, base: s.base, key: s.key, model: s.model, temperature: s.temperature, maxTokens: s.maxTokens, numCtx: s.numCtx, timeoutSec: s.timeoutSec, webchat: s.webchat, webchatUrl: s.webchatUrl, webchatImages: s.webchatImages, webchatRotateTurns: s.webchatRotateTurns, webchatNewChat: s.webchatNewChat, webchatMaxChars: s.webchatMaxChars, webchatShow: s.webchatShow, webchatKeepChat: s.webchatKeepChat, hangSec: s.hangSec };
  }

  mode(s) {
    const m = s.visionOnly ? 'vision' : (s.uiMode || 'hybrid');
    // веб-чат без загрузки картинок (Duck.ai, HuggingChat, Perplexity…) не видит снимков → автоматически быстрый режим «только код»
    if (m !== 'dom' && s.provider === 'webchat') { let site = null; try { site = require('./webchat').SITES[s.webchat]; } catch {}
      if (site && (s.webchatImages === false || site.images === false)) { if (!this._noImgWarned) { this._noImgWarned = true; this.emit({ kind: 'warn', text: `«${site.label}»: ${s.webchatImages === false ? 'в настройках выключено «Отправлять снимки картинкой»' : 'этот чат не принимает картинки'} — режим «${m === 'vision' ? 'только зрение' : 'гибрид'}» невозможен, работаю в быстром режиме «только код». Для зрения выберите ChatGPT, Алису, Gemini или Grok.` }); } return 'dom'; } }
    return m;
  }
  // Быстрый режим «только код»: снимков нет вообще — модель получает компактное дерево элементов
  async observeDom(s) {
    const snap = await require('./browser').snapshot(80);
    let text = '', elements = [];
    if (snap) text = `Вкладка браузера: ${snap.url} «${snap.title}». Интерактивные элементы (используй selector из списка в browser_click/browser_type/browser_select/browser_check/browser_fill/browser_upload):\n${snap.tree}`;
    else {
      const els = await platform.uiElements(null).catch(() => []);
      let id = 1; for (const e of els) { elements.push({ id, name: e.name, role: e.role, cx: e.x + e.w / 2, cy: e.y + e.h / 2 }); if (++id > 120) break; }
      text = 'Браузер не открыт. Элементы окон (AT-SPI/UIA), кликать через element=N: ' + elements.map((e) => `${e.id}=${e.role}${e.name ? ' «' + e.name.slice(0, 40) + '»' : ''}`).join('; ');
    }
    const h = require('crypto').createHash('md5').update(text).digest('hex');
    return { dom: true, text, elements, sig: h, tsize: { width: 0, height: 0 }, mon: null };
  }
  async observe(s, lastClick) {
    if (this.mode(s) === 'dom') return this.observeDom(s);
    const { img, mon } = await platform.screenshot(s.monitor || 0);
    const real = img.getSize();
    // если снимок не совпал с размером монитора (масштаб), сохраняем реальную геометрию
    const monEff = { ...mon, width: mon.width, height: mon.height };
    const tsize = sizing.targetSize(s.profile, real.width, real.height);
    let marks = [], elements = [];
    const m = this.mode(s);
    if (m === 'dom' ? s.useMarks !== false : (m === 'hybrid' && (this._fallback || 0) > 0)) {
      const els = await platform.uiElements(monEff);
      let id = 1;
      for (const e of els) {
        const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
        if (cx < monEff.x || cy < monEff.y || cx >= monEff.x + monEff.width || cy >= monEff.y + monEff.height) continue;
        const p1 = sizing.screenToModel({ x: e.x, y: e.y }, tsize, monEff, 'pixels');
        const p2 = sizing.screenToModel({ x: e.x + e.w, y: e.y + e.h }, tsize, monEff, 'pixels');
        elements.push({ id, name: e.name, role: e.role, cx, cy });
        marks.push({ id, x: p1.x, y: p1.y, w: Math.max(4, p2.x - p1.x), h: Math.max(4, p2.y - p1.y) });
        if (++id > 120) break;
      }
    }
    const cursor = lastClick ? sizing.screenToModel(lastClick, tsize, monEff, 'pixels') : null;
    const prepared = imaging.prepare(img, { width: tsize.width, height: tsize.height, grid: s.grid, coordMode: s.coords, marks, cursor });
    const jpeg = prepared.toJPEG(s.jpegQuality || 82);
    return { raw: img, mon: monEff, tsize, jpeg, data: jpeg.toString('base64'), tokens: Math.ceil(tsize.width / 28) * Math.ceil(tsize.height / 28), elements, sig: imaging.signature(img) };
  }

  async compact(s, system) {
    const act = this.history.active();
    if (act.length < 8) return false;
    const cut = act[Math.floor(act.length / 2)].id;
    const old = act.filter((e) => e.id <= cut);
    const transcript = old.map((e) => `[${e.role}] ${(e.raw || e.text || '').slice(0, 800)}`).join('\n');
    let summary = '';
    try {
      const r = await this.chat(s, [
        { role: 'system', content: [{ type: 'text', text: 'Ты сжимаешь журнал работы ИИ-оператора компьютера. Сохрани ВСЕ важные факты: задачи Ивана, его предпочтения, что выполнено, что не получилось и почему, найденные пути, названия окон, кнопок, файлов, адреса, договорённости. Пиши по-русски, кратко, списком.' }] },
        { role: 'user', content: [{ type: 'text', text: (this.history.memory ? 'Уже сохранённая память:\n' + this.history.memory + '\n\n' : '') + 'Новый фрагмент журнала:\n' + transcript + '\n\nВерни обновлённую память целиком.' }] },
      ]);
      summary = (r.text || '').trim();
    } catch (e) { summary = ''; }
    if (!summary) summary = (this.history.memory ? this.history.memory + '\n' : '') + mechanicalSummary(old);
    this.history.setMemory(summary.slice(0, 12000), cut);
    this.emit({ kind: 'info', text: 'Историю стало много — старые шаги сжаты в «память» (полный журнал сохранён на диске).' });
    return true;
  }

  async refineClick(s, obs, pt, goal) {
    // Увеличенный фрагмент вокруг точки + вопрос «перекрестие на цели?»
    const box = { w: Math.round(obs.raw.getSize().width / 4), h: Math.round(obs.raw.getSize().height / 4) };
    const rawPt = { x: pt.x - obs.mon.x, y: pt.y - obs.mon.y };
    const zs = sizing.targetSize(s.profile, box.w * 3, box.h * 3);
    const z = imaging.zoom(obs.raw, rawPt.x, rawPt.y, box.w, box.h, zs.width, zs.height, true);
    const prompt = `Это увеличенный в 3 раза фрагмент экрана (${zs.width}×${zs.height} пикселей). Зелёное перекрестие — точка, куда ИИ собирается нажать. Цель нажатия: «${goal}».\n` +
      `Если перекрестие уже стоит на нужном элементе (лучше в его центре) — ответь {"ok": true}.\nИначе ответь координатами центра нужного элемента В ПИКСЕЛЯХ ЭТОГО ФРАГМЕНТА: {"x": ..., "y": ...}` + (s.coords === 'norm1000' ? ' (или в системе 0..1000 этого фрагмента, если так привык — тогда добавь "norm": true)' : '') + `.\nЕсли цели во фрагменте нет — {"ok": false}. Только JSON.`;
    const r = await this.chat(s, [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image', data: z.img.toJPEG(85).toString('base64') }] }], require('./parse').REFINE_SCHEMA);
    const j = extractJson(r.text) || {};
    if (j.ok === true || j.x == null) return { pt, note: j.ok === false ? 'уточнение: цель во фрагменте не найдена' : 'уточнение: точка подтверждена' };
    let zx = Number(j.x), zy = Number(j.y);
    if (j.norm || (s.coords === 'norm1000' && zx <= 1000 && zy <= 1000 && (zx > zs.width || zy > zs.height))) { zx = zx / 1000 * zs.width; zy = zy / 1000 * zs.height; }
    if (!Number.isFinite(zx) || !Number.isFinite(zy)) return { pt, note: '' };
    const nx = obs.mon.x + z.x0 + zx * z.boxW / zs.width, ny = obs.mon.y + z.y0 + zy * z.boxH / zs.height;
    const moved = Math.hypot(nx - pt.x, ny - pt.y);
    if (moved > Math.max(box.w, box.h)) return { pt, note: 'уточнение отклонено (слишком далеко)' };
    return { pt: { x: Math.round(nx), y: Math.round(ny) }, note: `уточнено на ${Math.round(moved)} px` };
  }

  async run(taskText, opts = {}) {
    this._openedTaskUrl = false; this._askNudged = false; browser.reset();
    try { require('./webchat').resetImgFails(); } catch {}
    if (this.running) throw new Error('Уже выполняется задача');
    this.running = true; this.ctl = new AbortController();
    const base = this.getSettings();
    // список провайдеров: основной + запасные (при сбое — переключение)
    const chain = require('./chain').buildChain(base, { provId: (x) => this.provId(x) });
    this._chain = chain;
    if (!require('./chain').autoOn(base)) this.emit({ kind: 'info', text: 'Автовыбор модели выключен: работаю только с выбранным ИИ, без переключений.' });
    if (require('./chain').adaptiveOn(base) && this.auto) try { const ranked = this.auto.stats.rank(require('./auto/modelstats').classify(taskText), chain, (x) => this.provId(x)); if (ranked && ranked.length === chain.length) { if (this.provId(ranked[0]) !== this.provId(chain[0])) this.emit({ kind: 'info', text: `Адаптивный выбор: для задач этого типа лучше «${this.provId(ranked[0])}».` }); chain.splice(0, chain.length, ...ranked); } } catch {}
    if (this.auto) this.auto.startTask();
    let ci = 0, s = chain[0]; let runOk = false;
    this.meter = new guard.TokenMeter(base.taskTokenBudget || 0); this.hops = new guard.HopGuard({ maxHops: base.maxHops || 4, maxRetries: base.maxRetriesTask || 12 }); this.hops.visit(this.provId(s));
    const shots = []; const logLines = []; let handoffNote = '', handoffShots = [];
    if (!opts.resume) { this.history.add({ role: 'user', text: taskText }); this.emit({ kind: 'user', text: taskText }); }
    let lastClick = null, prevSig = null, formatErrors = 0, actErrors = 0, resultText = opts.resume ? 'Работа была прервана (сбой/перезапуск программы). Посмотри на экран и продолжи задачу с того места, где остановился.' : 'Начало задачи.';
    const window = []; // скользящее окно последних действий для поиска зацикливания
    const stats = { steps: 0, refined: 0, retries: 0, switches: 0 }; this._stats = stats;
    const t0run = Date.now();
    this.saveRun({ running: true, task: taskText, started: t0run, step: 0 });
    let rec = null; try { if (base.recordRuns !== false && this.dataDir) rec = new Recorder(this.dataDir, taskText); } catch {} this.rec = rec;
    try {
      // 1.3.0: простые команды («открой хром») — сразу, без модели
      const qi = !opts.resume && s.fastIntents !== false && require('./auto/intent').parse(taskText);
      if (qi) { const r = await this.quickIntent(qi); if (r) { this.history.add({ role: 'assistant', text: r }); this.emit({ kind: 'done', text: r, stats }); runOk = true; return { ok: true, answer: r, stats }; } }
      if (s.hideWindow && this.beforeRun) await this.beforeRun();
      await platform.sleep(400);
      for (let step = 1; step <= (s.maxSteps || 40); step++) {
        if (this.ctl.signal.aborted) throw Object.assign(new Error('Остановлено'), { stopped: true });
        if (Number(s.pauseEvery) > 0 && step > 1 && (step - 1) % Number(s.pauseEvery) === 0 && !this.paused) { this.paused = true; this.emit({ kind: 'paused', step: step - 1, text: `Пауза после ${step - 1} шагов (настройка «Пауза каждые N шагов»). Нажмите «Продолжить», чтобы агент работал дальше.` }); }
        while (this.paused && !this.ctl.signal.aborted) await platform.sleep(250);
        if (this._manual) { this._manual = false; resultText = 'Иван вручную поработал за компьютером (пауза). Посмотри на новый снимок и продолжи с текущего состояния.'; }
        if (s.maxMinutes && Date.now() - t0run > s.maxMinutes * 60000) throw new Error(`Превышено время на задачу (${s.maxMinutes} мин).`);
        stats.steps = step; this.saveRun({ running: true, task: taskText, started: t0run, step });
        await this.waitStable(s);
        let obs;
        try { obs = await this.observe(s, lastClick); }
        catch (e) { this.emit({ kind: 'warn', text: 'Сторож: снимок экрана не удался (' + e.message + '), повтор через 2 с.' }); await platform.sleep(2000); obs = await this.observe(s, lastClick); }
        if (!obs.dom && obs.data) { shots.push({ data: obs.data, sig: obs.sig && obs.sig.join ? obs.sig.join(',') : String(obs.sig), raw: obs.raw }); if (shots.length > 6) shots.shift(); }
        const change = prevSig ? (obs.dom ? (prevSig === obs.sig ? 0 : 1) : imaging.diffRatio(prevSig, obs.sig)) : null; prevSig = obs.sig;
        const win = await platform.activeWindow().catch(() => '');
        let cur = resultText;
        if (change != null && obs.dom) cur += change ? ' Страница изменилась.' : ' Страница НЕ изменилась после действия.';
        else if (change != null) cur += change < 0.002 ? ' Экран НЕ изменился после действия (возможен промах или нужно подождать).' : ` Экран изменился (≈${Math.round(change * 100)}% площади).`;
        if (win) cur += ` Активное окно: «${win}».`;
        if (obs.dom) cur += '\n' + obs.text;
        else if (obs.elements.length) cur += '\nЭлементы с красными метками: ' + obs.elements.map((e) => `${e.id}=${e.role}${e.name ? ' «' + e.name.slice(0, 40) + '»' : ''}`).join('; ');
        const vis = (providers.PRESETS[s.provider] || {}).vision !== false;
        if (!vis) cur += '\nВАЖНО: этот провайдер НЕ видит картинку. Опирайся на список меток/элементов и на действия open_app, run, key, browser_*. Не проси прислать снимок — программа уже приложила его для зрячих моделей. Если меток нет — используй open_app/run/key.';
        if (step > 1 && change != null && change < 0.002 && !/^(click|double_click|right_click|type|key|hotkey|scroll|drag|open_app|run|browser_\w+)$/.test(this._lastType || '')) this._idle = (this._idle || 0) + 1; else this._idle = 0;
        if (this._idle >= 2) { const u = (taskText.match(/https?:\/\/\S+?(?=[\s)»,]|$)/) || [])[0]; cur += `\nСТОРОЖ: ты уже ${this._idle} шага только смотришь, а экран не меняется. Хватит смотреть — выполни первое действие задачи` + (u ? ` (например {"action":"browser_open","url":"${u}"})` : ' (open_app / run / key)') + '.'; }
        const md = this.mode(s);
        if (md === 'hybrid') {
          const lastPix = /^(click|double_click|right_click|type|scroll|drag)$/.test(this._lastType || '');
          if ((lastPix && change != null && change < 0.002) || this._lastErr) { this._fallback = 3; cur += '\nАВТО-ЗАПАСНОЙ ПУТЬ: по снимку не получилось (экран не изменился или ошибка). Теперь включены метки элементов и код страницы: используй element=N, browser_read (список полей с селекторами) и browser_click/browser_type/browser_select/browser_check/browser_fill по selector. Затем вернись к работе по снимку.'; this.emit({ kind: 'info', text: 'Гибридный режим: переход на код страницы/a11y.' }); }
          else if (this._fallback > 0) this._fallback--;
        }
        if (md === 'dom' && (/browser_/i.test(taskText) || /browser_open|duck\.ai|chat\.|huggingface|perplexity|chatgpt/i.test(cur+taskText)))
          cur += '\nДля веб-задач используй ТОЛЬКО browser_open / browser_click / browser_type / browser_read / browser_key — не click/type по пикселям и не element=N.';
        cur += obs.dom ? `\nБЫСТРЫЙ РЕЖИМ (только код): снимков экрана нет. Шаг ${step}. Верни пачку {"actions":[...]}: заполни ВСЕ поля из списка за один ответ (browser_fill с полем fields или несколько browser_type/browser_select/browser_check), затем нажми кнопку отправки/«Далее».` : `\nСнимок экрана после шага (${obs.tsize.width}×${obs.tsize.height}). Шаг ${step}. Можно вернуть одно действие или пачку {"actions":[...]}.${s.provider === 'webchat' ? ' Модель медленная — заполняй сразу ВСЕ видимые поля одной пачкой.' : ''}`;
        const env = await context.environment(this.app, { mon: obs.mon || (await platform.monitors())[s.monitor || 0], img: obs.dom ? { width: 1, height: 1 } : obs.tsize, coords: s.coords, monitors: await platform.monitors(), vision: (providers.PRESETS[s.provider] || {}).vision !== false });
        const system = context.readPrompt(this.app) + '\n\n' + env + (md === 'hybrid' ? '\n\n## ГИБРИДНЫЙ РЕЖИМ (по умолчанию)\nСначала работай по снимку экрана: находи кнопки/поля глазами и кликай по координатам. Если элемент не находится или клик не срабатывает — переходи на код страницы (browser_read/browser_click/… по selector) или метки элементов; программа сама подскажет, когда переключиться.' : '') + (md === 'vision' ? '\n\n## РЕЖИМ «ТОЛЬКО ЗРЕНИЕ»\nДействия browser_* и номера элементов ОТКЛЮЧЕНЫ. Находи кнопки и поля только по снимку экрана и кликай по координатам (click/type/hotkey/scroll). Кнопки ниже края окна — прокручивай (scroll) и ищи заново. После каждой страницы формы проверяй красные сообщения об ошибках и исправляй поля.' : '');
        const system2 = system + (this.dataDir ? recipes.hint(this.dataDir) : '') + (this.auto ? this.auto.skills.hint() + this.auto.extraHint(s, taskText) : '');
        let msgs = buildMessages(this.history, { system: system2, currentShot: obs.dom ? null : { data: obs.data, tokens: obs.tokens }, currentText: cur });
        if (estimateTokens(msgs) > (s.contextBudget || 16000) * 0.75 && await this.compact(s, system))
          msgs = buildMessages(this.history, { system: system2, currentShot: obs.dom ? null : { data: obs.data, tokens: obs.tokens }, currentText: cur });
        if (handoffNote) { const last = msgs[msgs.length - 1]; last.content = [{ type: 'text', text: handoffNote }, ...handoffShots.map((h) => ({ type: 'image', data: h, tokens: 600 })), ...last.content]; handoffNote = ''; handoffShots = []; }
        msgs = fitMessages(msgs, (s.contextBudget || 16000) - (s.maxTokens || 700));
        this.emit({ kind: 'thinking', step, shot: obs.dom ? null : obs.data });
        const t0 = Date.now();
        let reply;
        try { reply = await this.chat(s, msgs, require('./parse').ACTION_SCHEMA); }
        catch (e0) {
          let e = e0;
          const cm = /exceed\w*[^]*?context|context[^]*?(length|size|window)/i.test(e.message || '') && (String(e.message).match(/context size \((\d+)|n_ctx[^\d]*(\d+)|maximum context length is (\d+)/i) || []);
          if (cm && !this.ctl.signal.aborted) {
            const n = Number(cm[1] || cm[2] || cm[3]) || Math.round((s.contextBudget || 16000) * 0.6);
            s.contextBudget = Math.min(s.contextBudget || 16000, n);
            this.emit({ kind: 'warn', text: `Сторож: запрос не влез в контекст модели (${n} токенов) — сокращаю историю и повторяю шаг.` });
            try { reply = await this.chat(s, fitMessages(msgs, Math.floor(n * 0.7) - (s.maxTokens || 700)), require('./parse').ACTION_SCHEMA); e = null; } catch (e2) { e = e2; }
          }
          if (e) {
          if (e.stopped || this.ctl.signal.aborted || e.kind === 'loop') throw e;
          // сторож: основной провайдер не справился — переходим на запасной и повторяем шаг
          if (ci + 1 < chain.length) {
            const from = chain[ci]; ci++; s = chain[ci]; stats.switches++;
            const why = this.hops.visit(this.provId(s)); if (why) throw new Error('Сторож: ' + why + '. Останавливаю.');
            // передать новой нейросети весь контекст + только ключевые снимки (последние отличающиеся, сжатые)
            const key = guard.pickKeyShots(shots, 3);
            handoffShots = key.slice(0, -1).map((k) => { try { return k.raw.resize({ width: 768 }).toJPEG(60).toString('base64'); } catch { return null; } }).filter(Boolean);
            handoffNote = guard.handoff({ task: taskText, memory: this.history.memory, log: logLines, shots: key, from: this.provId(from), to: this.provId(s), reason: RU[classify(e)] || 'зависание' });
            this.emit({ kind: 'warn', text: `Сторож: ${RU[classify(e)] || 'сбой'} у «${chain[ci - 1].provider}/${chain[ci - 1].model}». Переключаюсь на запасной: ${s.provider}/${s.model}.` });
            step--; continue;
          }
          throw new Error(`Модель недоступна (${RU[classify(e)] || 'сбой'}): ${String(e.message).slice(0, 300)}. Состояние сохранено — после восстановления связи напишите «продолжай».`);
          }
        }
        const dt = ((Date.now() - t0) / 1000).toFixed(1);
        const parsed = parseReply(reply.text);
        this.history.add({ role: 'result', text: cur.replace(/\nСнимок экрана после шага[^\n]*/, '\n[снимок шага ' + step + ' в истории не хранится]') });
        this.history.add({ role: 'model', raw: (reply.text || '').slice(0, 4000) });
        if (parsed.error && formatErrors === 0 && !this.ctl.signal.aborted) {
          this.emit({ kind: 'warn', text: `Шаг ${step}: ${parsed.error} Переспрашиваю модель со строгим напоминанием о формате.` });
          try { const r2 = await this.chat(s, [...msgs, { role: 'assistant', content: [{ type: 'text', text: String(reply.text || '').slice(0, 2000) }] }, { role: 'user', content: [{ type: 'text', text: 'Твой ответ не содержит JSON. Ответь ТОЛЬКО одним блоком ```json {"observation":"…","thought":"…","action":{"type":"…"}} ``` без текста вокруг, без ссылок и источников.' }] }], require('./parse').ACTION_SCHEMA); const p2 = parseReply(r2.text); if (!p2.error) { reply = r2; Object.assign(parsed, p2); delete parsed.error; } } catch (e3) { if (e3.stopped || this.ctl.signal.aborted) throw e3; }
        }
        if (parsed.error) {
          formatErrors++;
          this.emit({ kind: 'warn', text: `Шаг ${step}: ${parsed.error}` });
          resultText = `ОШИБКА: ${parsed.error} Ответь строго одним JSON-объектом по формату из инструкции.`;
          if (formatErrors >= 4) throw new Error('Модель 4 раза подряд ответила не по формату. Попробуйте другую модель.');
          continue;
        }
        formatErrors = 0;
        let batch = (parsed.actions && parsed.actions.length) ? parsed.actions : [parsed.action];
        { const u = (taskText.match(/https?:\/\/[^\s)»,]+/) || [])[0];
          if (u && ((this._idle >= 2 && batch.every((a) => /^(screenshot|wait|observe)$/.test(a && a.type))) || (!this._openedTaskUrl && batch.some((a) => a && (a.type === 'ask_user' || a.type === 'done'))))) { batch = [{ type: 'browser_open', url: u }]; this._idle = 0; this.emit({ kind: 'warn', text: 'Сторож: модель только смотрит на пустой экран — открываю адрес из задачи: ' + u }); } }
        this.emit({ kind: 'step', step, sec: dt, observation: parsed.observation, thought: parsed.thought, action: batch[0], batchSize: batch.length });

        const batchLog = [];
        let early = null;
        for (let bi = 0; bi < batch.length; bi++) {
          const a = batch[bi];
          // зацикливание
          const key = JSON.stringify(a);
          window.push({ key, still: change != null && change < 0.01 }); if (window.length > 6) window.shift();
          if (/^browser_(open|navigate|goto)$/.test(a && a.type)) this._openedTaskUrl = true;
          const loops = window.filter((w) => w.key === key && w.still).length;
          if (a.type === 'done') { const ans = a.answer || parsed.thought || 'Готово.'; this.history.add({ role: 'assistant', text: ans }); this.emit({ kind: 'done', text: ans, stats }); runOk = true; return { ok: true, answer: ans, stats }; }
          if (a.type === 'ask_user' && !this._askNudged && !/парол|код|логин|войд|вход|оплат|карт|удал|подтверд|отправ.*(письм|сообщ)/i.test(a.question || '')) {
            this._askNudged = true; this.emit({ kind: 'info', text: 'Сторож: модель спросила Ивана о том, что может решить сама, — прошу продолжить самостоятельно.' });
            resultText = 'Иван не отвечает на такие вопросы: решай сам по смыслу задачи (выбирай лучший вариант) и продолжай. Спрашивай только про пароли, коды, оплату или необратимые действия.'; early = 'nudge'; break; }
          if (a.type === 'ask_user') { const q = a.question || 'Нужен ответ.'; this.history.add({ role: 'assistant', text: q }); this.emit({ kind: 'ask', text: q }); return { ok: true, ask: q, stats }; }
          let res = '';
          try {
            this._lastType = a.type; this._lastErr = false;
            res = await this.execute(a, s, obs, parsed, stats, (p) => { lastClick = p; });
            actErrors = 0;
            if (rec) rec.act(a, !/^(ОШИБКА|ОТКАЗ)/.test(String(res)));
          } catch (e) {
            if (e.stopped || this.ctl.signal.aborted) throw e;
            if (e.code === 'BROWSER_CLOSED') { this.emit({ kind: 'warn', text: e.message }); throw e; }
            actErrors++; this._lastErr = true;
            res = `ОШИБКА при выполнении действия: ${String(e.message || e).slice(0, 500)}. Попробуй другой способ.`;
            if (actErrors >= 5) throw new Error('5 действий подряд завершились ошибкой: ' + e.message);
            // остаток пачки строился под старое состояние страницы — не выполняем его (экономит тайм-ауты)
            if (bi < batch.length - 1 && /^browser_/.test(a.type)) { batchLog.push(`#${bi + 1} ${a.type}: ${res}`); this.emit({ kind: 'result', text: res }); batchLog.push(`(пропущено ещё ${batch.length - bi - 1} действий пачки)`); break; }
          }
          if (res === null) { early = 'zoom'; break; }
          if (loops >= 3) this._loopWarn = (this._loopWarn || 0) + 1; else this._loopWarn = 0;
          if (this._loopWarn >= 3) { const q = 'Я зациклился: одно и то же действие не меняет экран. Подскажите, что сделать иначе, или напишите «продолжай».'; this._loopWarn = 0; this.history.add({ role: 'assistant', text: q }); this.emit({ kind: 'ask', text: q }); return { ok: false, ask: q, stats }; }
          if (loops >= 3) res += '\nВНИМАНИЕ: зацикливание — смени подход.';
          batchLog.push(`#${bi + 1} ${a.type}: ${res}`); logLines.push(`${a.type}: ${String(res).slice(0, 200)}`); if (logLines.length > 30) logLines.shift();
          if (rec) try { rec.step(step + (batch.length > 1 ? '.' + (bi + 1) : ''), { thought: bi ? '' : parsed.thought, action: a, result: res, shot: bi ? null : (obs.dom ? null : obs.data) }); } catch {}
          this.emit({ kind: 'result', text: res });
          await this.settle(s, Math.min(s.settleMs || 900, 500), a);
        }
        if (early === 'zoom' || early === 'nudge') continue;
        // Авто-отчёт пачки + новый скрин на следующем витке цикла
        resultText = `Отчёт пачки (${batchLog.length} действий):\n` + batchLog.join('\n') + '\nПродолжай или done.';
        this.emit({ kind: 'batch_report', text: resultText, count: batchLog.length });
        await this.settle(s, s.settleMs || 900, batch.length === 1 ? batch[0] : null);
      }
      const msg = `Остановился: достигнут предел шагов (${s.maxSteps || 40}). Можно написать «продолжай».`;
      this.history.add({ role: 'assistant', text: msg }); this.emit({ kind: 'done', text: msg, stats });
      return { ok: false, answer: msg, stats };
    } catch (e) {
      const wasStop = e && (e.stopped || (this.ctl && this.ctl.signal.aborted) || /^(aborted|This operation was aborted|The operation was aborted)\.?$/i.test(String(e.message || '')) || e.name === 'AbortError');
      let msg = (e && e.budget ? e.message : wasStop ? 'Остановлено Иваном. Можно сразу давать новую задачу.' : 'Ошибка: ' + (e && e.message || e));
      if (!wasStop && /ECONNREFUSED|fetch failed/i.test(String(e && e.message))) msg = `Ошибка: ИИ «${this.provId(s)}» не отвечает — по адресу ${(s.base || (providers.PRESETS[s.provider] || {}).base || 'локальной модели')} никто не слушает (модель не запущена). Выберите веб-чат в списке «ИИ» под чатом (например Perplexity или Duck.ai) или запустите модель во вкладке «Локальная модель».`;
      if (e && e.budget) { /* сообщение уже показано */ }
      this.history.add({ role: 'assistant', text: msg }); this.emit({ kind: 'error', text: msg });
      return { ok: false, error: msg, stats };
    } finally {
      this.saveRun({ running: false, task: taskText });
      this.paused = false;
      if (rec) try { const last = (this.history.visible ? this.history.visible() : []).slice(-1)[0]; this.lastReport = rec.finish(stats.steps + ' шагов', last && last.text); this.lastActions = rec.actions; this.lastTask = taskText; this.emit({ kind: 'info', text: 'Отчёт о ходе задачи: ' + this.lastReport }); } catch {}
      if (this.auto) try { this.auto.finishTask(this, base, { taskText, ok: runOk, secs: (Date.now() - t0run) / 1000, prov: this.provId(s), actions: rec ? rec.actions : [] }); } catch {}
      this.running = false; this.ctl = null;
      if (base.hideWindow && this.afterRun) await this.afterRun();
    }
  }

  // Выполнение одного действия. Возвращает текст результата (или null, если результат уже записан).
  async execute(a, s, obs, parsed, stats, setClick) {
    const T = a.type;
    { const de = domains.checkAction(a, { allowed: domains.parseList(s.allowedDomains), blocked: domains.parseList(s.blockedDomains) }); if (de) return 'ОТКАЗ: ' + de + ' Выбери разрешённый сайт.'; }
    if (this.auto) { const r = await this.auto.execute(this, a, s, obs, parsed, stats, setClick); if (r !== undefined) return r; }
    if (T === 'run_recipe') return await this.runRecipe(a, s, obs, parsed, stats, setClick);
    if (obs.dom && (T === 'zoom' || T === 'drag' || ((CLICKS.has(T) || T === 'scroll') && a.element == null)))
      return T === 'scroll' ? 'Быстрый режим: прокрутка не нужна — дерево элементов уже содержит всю форму; используй browser_scroll при необходимости.' : 'ОШИБКА: в быстром режиме (только код) координат нет. Используй browser_* по selector из списка или element=N.';
    if (CLICKS.has(T) || T === 'drag' || T === 'scroll' || T === 'zoom') {
      let pt;
      if (a.element != null) {
        const el = obs.elements.find((e) => e.id === Number(a.element));
        if (!el) return `Элемента с меткой ${a.element} нет. Укажи координаты или другой номер.`;
        pt = { x: Math.round(el.cx), y: Math.round(el.cy) };
      } else if (a.x == null || a.y == null) {
        if (T === 'scroll') pt = { x: obs.mon.x + obs.mon.width / 2, y: obs.mon.y + obs.mon.height / 2 };
        else return 'ОШИБКА: для этого действия нужны x и y.';
      } else pt = sizing.modelToScreen({ x: a.x, y: a.y }, obs.tsize, obs.mon, s.coords);
      if (T === 'zoom') return this.zoomStep(s, obs, pt, setClick);
      let note = '';
      if (s.precise && !obs.dom && a.element == null && T !== 'move' && T !== 'scroll' && T !== 'drag') {
        try { const r = await this.refineClick(s, obs, pt, (parsed.thought || '').slice(0, 200)); if (r.pt !== pt) stats.refined++; pt = r.pt; note = r.note ? ' (' + r.note + ')' : ''; }
        catch (e) { if (this.ctl.signal.aborted) throw e; note = ' (уточнение не удалось)'; }
      }
      if (T === 'drag') {
        if (a.x2 == null) return 'ОШИБКА: для drag нужны x2,y2.';
        const p2 = sizing.modelToScreen({ x: a.x2, y: a.y2 }, obs.tsize, obs.mon, s.coords);
        await platform.mouse('drag', pt.x, pt.y, { x2: p2.x, y2: p2.y }); setClick(p2);
        return `Перетащено из (${pt.x},${pt.y}) в (${p2.x},${p2.y}).`;
      }
      if (T === 'scroll') {
        const amt = Math.max(1, Math.abs(a.amount || 5));
        await platform.mouse('scroll', pt.x, pt.y, { amount: a.direction === 'up' ? -amt : amt });
        return `Прокручено ${a.direction === 'up' ? 'вверх' : 'вниз'} на ${amt}.`;
      }
      await platform.mouse(T, pt.x, pt.y); setClick(pt);
      const shown = sizing.screenToModel(pt, obs.tsize, obs.mon, s.coords);
      return `Выполнено ${T} в точке (${shown.x},${shown.y}) снимка = реальные (${pt.x},${pt.y})${note}. Зелёное перекрестие на следующем снимке показывает место клика.`;
    }
    if (T === 'type') { await platform.typeText(String(a.text ?? ''), s.typeViaClipboard || String(a.text ?? '').length > 200); return `Напечатан текст (${String(a.text ?? '').length} символов).`; }
    if (T === 'key') { await platform.key(String(a.keys || '')); return `Нажато ${a.keys}.`; }
    if (T === 'open_app') {
      if (this.ctl && this.ctl.signal.aborted) throw Object.assign(new Error('Остановлено'), { stopped: true });
      const r = await platform.openApp(String(a.name || ''));
      return `Запущено «${r.launched || a.name}». ` + (r.window ? `Появилось окно: «${r.window}».` : (r.note || 'Окно пока не видно — подожди.'));
    }
    if (T === 'run') {
      const cmd = String(a.command || '');
      const risk = safety.check(cmd);
      if (!risk && this.auto) { const deny = await this.auto.gate(this, a, s, cmd); if (deny) return deny; }
      else if (risk && this.auto) this.auto.autoCheckpoint(s, cmd);
      if (risk || (s.confirmCommands && !this.auto)) {
        const ok = this.confirm && await this.confirm(cmd, risk);
        if (!ok) return 'Иван ЗАПРЕТИЛ выполнять эту команду. Найди другой способ или спроси (ask_user).';
      }
      if (a.background) { const r = platform.shellBackground(cmd); return `Запущено в фоне (pid ${r.pid}). Вывод пишется в ${r.log}.`; }
      const r = await platform.shellRun(cmd, Math.min(3600, a.timeout || s.cmdTimeoutSec || 120) * 1000, { extraPath: android.binDir(), signal: this.ctl && this.ctl.signal });
      return `Команда выполнена, код ${r.code}. Вывод:\n${r.output || '(пусто)'}`;
    }
    if (T === 'browser_open' && this.mode(s) === 'vision') { const r = await browser.act(a, this.dataDir); return r.split('\nЭлементы')[0] + '\n(режим «только зрение»: дальше — только по снимку экрана)'; }
    if (browser.isBrowserAction(T) && this.mode(s) === 'vision') return 'ОТКАЗ: режим «только зрение» — browser_* запрещены. Найди элемент на снимке и кликни по координатам.';
    if (browser.isBrowserAction(T) && this.ctl && this.ctl.signal.aborted) throw Object.assign(new Error('Остановлено'), { stopped: true });
    if (browser.isBrowserAction(T)) return await browser.act(a, this.dataDir);
    if (T === 'android_devices') { const d = await android.devices(); return d.available ? (d.list.length ? 'Устройства: ' + d.list.map((x) => `${x.serial} [${x.state}] ${x.info || ''}`).join('; ') + (d.list.some((x) => x.state === 'unauthorized') ? '\nСтатус unauthorized: попроси Ивана подтвердить «Разрешить отладку по USB» на экране телефона.' : '') : 'Устройств нет. Проверь кабель, включена ли «Отладка по USB» (Параметры → Для разработчиков), драйвер (Windows).') : 'adb не установлен. Используй {"type":"android_setup"}.'; }
    if (T === 'android_setup') { const b = await android.install(require('./engine').download, (p) => this.emit({ kind: 'info', text: `${p.status} ${p.pct ?? ''}%` })); return 'adb/fastboot установлены: ' + b; }
    if (T === 'adb' || T === 'fastboot') {
      const args = Array.isArray(a.args) ? a.args.map(String) : String(a.args || '').match(/"[^"]*"|\S+/g).map((x) => x.replace(/^"|"$/g, ''));
      if (a.serial) args.unshift('-s', String(a.serial));
      const risk = android.riskOf(T, args) || (safety.check(T + ' ' + args.join(' ')) || [])[0];
      if (risk) {
        const ok = this.confirm && await this.confirm(`${T} ${args.join(' ')}`, [risk], { android: true });
        if (!ok) return `Иван НЕ подтвердил опасную операцию «${T} ${args.join(' ')}». Не повторяй её без его явной просьбы.`;
      }
      const r = await android.run(T, args, Math.min(3600, a.timeout || 600) * 1000);
      return `${T} ${args.join(' ')} → код ${r.code}\n${r.output || '(пусто)'}`;
    }
    if (T === 'github') {
      const r = await github.run(a, { settings: s, dataDir: this.dataDir, confirm: this.confirm });
      return r.text || (r.ok ? 'OK' : 'Ошибка GitHub');
    }
    if (T === 'wait') { await platform.sleep(Math.min(60, Math.max(0.2, a.seconds || 1)) * 1000); return 'Подождал.'; }
    if (T === 'screenshot') return 'Новый снимок.';
    return `Неизвестное действие «${T}». Используй только действия из списка.`;
  }

  async zoomStep(s, obs, pt, setClick) {
    const zs = sizing.targetSize(s.profile, obs.mon.width / 2, obs.mon.height / 2);
    const z = imaging.zoom(obs.raw, pt.x - obs.mon.x, pt.y - obs.mon.y, Math.round(obs.mon.width / 3), Math.round(obs.mon.height / 3), zs.width, zs.height, true);
    const tl = sizing.screenToModel({ x: obs.mon.x + z.x0, y: obs.mon.y + z.y0 }, obs.tsize, obs.mon, s.coords);
    const br = sizing.screenToModel({ x: obs.mon.x + z.x0 + z.boxW, y: obs.mon.y + z.y0 + z.boxH }, obs.tsize, obs.mon, s.coords);
    this.history.add({ role: 'result', text: `Увеличенный фрагмент показан. Он охватывает область полного снимка от (${tl.x},${tl.y}) до (${br.x},${br.y}); перекрестие — указанная точка.` });
    const env = await context.environment(this.app, { mon: obs.mon, img: obs.tsize, coords: s.coords, monitors: await platform.monitors() });
    const system = context.readPrompt(this.app) + '\n\n' + env;
    const r2 = await this.chat(s, buildMessages(this.history, { system, currentShot: { data: z.img.toJPEG(85).toString('base64'), tokens: 1000 },
      currentText: `Увеличенный фрагмент области (${tl.x},${tl.y})–(${br.x},${br.y}) полного снимка. Определи точную точку и верни действие клика с "zx","zy" — координатами во ФРАГМЕНТЕ (${zs.width}×${zs.height}), программа пересчитает сама.` }));
    const p2 = parseReply(r2.text);
    this.history.add({ role: 'model', raw: (r2.text || '').slice(0, 4000) });
    const j2 = extractJson(r2.text) || {}; const aj = (j2.action && typeof j2.action === 'object') ? j2.action : j2;
    let res;
    if (aj.zx != null && aj.zy != null) {
      const px = { x: Math.round(obs.mon.x + z.x0 + Number(aj.zx) * z.boxW / zs.width), y: Math.round(obs.mon.y + z.y0 + Number(aj.zy) * z.boxH / zs.height) };
      const t = (p2.action && CLICKS.has(p2.action.type)) ? p2.action.type : 'click';
      await platform.mouse(t, px.x, px.y); setClick(px);
      res = `Выполнено ${t} по уточнённой точке (реальные ${px.x},${px.y}).`;
    } else if (p2.action && CLICKS.has(p2.action.type) && p2.action.x != null) {
      // модель ответила в координатах фрагмента без zx/zy — считаем их координатами фрагмента
      const px = { x: Math.round(obs.mon.x + z.x0 + Number(p2.action.x) * z.boxW / zs.width), y: Math.round(obs.mon.y + z.y0 + Number(p2.action.y) * z.boxH / zs.height) };
      await platform.mouse(p2.action.type, px.x, px.y); setClick(px);
      res = `Выполнено ${p2.action.type} после увеличения → реальные (${px.x},${px.y}).`;
    } else res = 'Увеличение просмотрено, действие не выполнено.';
    return res;
  }
}

module.exports = { Agent };
