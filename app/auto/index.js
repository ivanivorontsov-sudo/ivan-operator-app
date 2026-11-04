'use strict';
// 1.3.0: связка модулей автономии с агентом (действия, контрольные точки, навыки, статистика моделей).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { TimeMachine } = require('./timemachine');
const { SkillLibrary } = require('./skills');
const { ModelStats, classify } = require('./modelstats');
const risk = require('./risk');
const osexec = require('./osexec');
const tester = require('./tester');
const templates = require('./templates');
const workflow = require('./workflow');
const extra = require('./extra');

function runFile(cmd, args, cwd, timeout = 300000) {
  return new Promise((res) => execFile(cmd, args, { cwd, timeout, maxBuffer: 8 << 20, shell: false }, (e, so, se) => res({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, output: String(so || '') + String(se || '') })));
}
function has(cmd) { return new Promise((res) => execFile(process.platform === 'win32' ? 'where' : 'which', [cmd], (e) => res(!e))); }
function cleanSettings(s) { if (!s) return s; const c = JSON.parse(JSON.stringify(s)); delete c.key; delete c.keyEnc; for (const f of c.fallbacks || []) { delete f.key; } return c; }
function existingDirs(list) { return (list || []).map((p) => String(p).replace(/^~(?=$|[\\/])/, os.homedir())).filter((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } }); }

class Autonomy {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.tm = new TimeMachine(path.join(dataDir, 'timemachine'));
    this.skills = new SkillLibrary(dataDir);
    this.stats = new ModelStats(dataDir);
    this.testRuns = 0;
    this.memory = new extra.SharedMemory(dataDir);
    this.agents = new extra.AgentBuilder(dataDir);
    this._locks = {};
  }
  startTask() { this.testRuns = 0; this._cpDone = false; }
  autoCheckpoint(s, reason) {
    if (s.autoCheckpoint === false) return null;
    const paths = existingDirs(s.projectDirs);
    try { const r = this.tm.checkpoint({ label: 'Авто: перед рискованным действием', paths, settings: cleanSettings(s), reason }); this.tm.prune(); return r; } catch (e) { return { error: e.message }; }
  }
  // проверка риска + подтверждение + авто-точка. Возвращает строку отказа или null.
  async gate(agent, a, s, shownCmd) {
    const r = risk.assess(a);
    const thr = s.riskConfirmThreshold || 55;
    let score = r.score;
    if (s.modelRisk && score >= 25 && score < thr) { try { const m = await risk.assessWithModel(a, (msgs) => agent.chat(s, msgs)); score = m.score; r.reasons = m.reasons; r.level = m.level; } catch {} }
    if (score >= 40) { const cp = this.autoCheckpoint(s, shownCmd); if (cp && cp.id) agent.emit({ kind: 'info', text: `Машина времени: создана точка ${cp.id} перед «${String(shownCmd).slice(0, 80)}».` }); }
    if (score >= thr || s.confirmCommands) {
      const ok = agent.confirm && await agent.confirm(shownCmd, [`Риск ${score}/100 (${risk.RU_LEVEL[r.level] || r.level}): ${r.reasons.join('; ')}`]);
      if (!ok) return 'Иван ЗАПРЕТИЛ выполнять это действие. Найди другой способ или спроси (ask_user).';
    }
    return null;
  }
  // 1.2.6: подсказки в системный промпт — профиль активного помощника + общая память
  extraHint(s, task) {
    let h = '';
    try { if (s.activeAgent) { const p = this.agents.get(s.activeAgent); if (p) h += '\n\n## РОЛЬ\n' + p.prompt; } } catch {}
    try { if (s.sharedMemory !== false) h += this.memory.hint(task); } catch {}
    return h;
  }
  // нейросети для роя/параллельного решения: при выключенном «Автовыборе модели» — только выбранная
  chats(agent, s) {
    const auto = require('../chain').autoOn(s);
    const list = auto && agent._chain && agent._chain.length ? agent._chain : [s];
    const seen = new Set(); const out = [];
    for (const c of list) { const id = agent.provId(c); if (seen.has(id)) continue; seen.add(id);
      // один и тот же веб-чат нельзя дёргать параллельно — очередь на каждый id
      out.push({ id, chat: (m) => { const prev = this._locks[id] || Promise.resolve(); const p = prev.catch(() => {}).then(() => agent.chat(c, m)); this._locks[id] = p; return p; } }); }
    return out.slice(0, Math.max(1, s.swarmSize || 3));
  }
  // 1.2.7: параллельное решение для управления экраном — несколько ответов (разные ИИ при «Автовыборе», иначе тот же ИИ несколько раз),
  // голосование по кластерам действий, выполнение лучшего с проверкой (экран изменился?), при неудаче — следующий вариант.
  async screenVote(agent, a, s, obs, parsed, stats, setClick) {
    if (!obs || !obs.data) return 'ОШИБКА: screen_vote нужен снимок экрана (режим зрения/гибрид).';
    const goal = String(a.goal || a.task || (parsed && parsed.thought) || '').slice(0, 600); const n = Math.max(2, Math.min(5, a.n || s.swarmSize || 3));
    const chats = this.chats(agent, s); const jobs = []; for (let i = 0; i < n; i++) jobs.push(chats[i % chats.length]);
    const prompt = `Цель: ${goal}\nСнимок ${obs.tsize.width}x${obs.tsize.height}. Предложи ОДНО следующее действие с экраном. Ответ ТОЛЬКО JSON: {"type":"click|double_click|right_click|type|key|scroll|drag|wait","x":…,"y":…,"text":"…","keys":"…","direction":"…"} в координатах снимка.` + (obs.text ? '\n' + String(obs.text).slice(0, 3000) : '');
    const P = require('../parse'); const res = await Promise.allSettled(jobs.map((c) => c.chat([{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image', data: obs.data, tokens: obs.tokens || 1000 }] }])));
    const cands = res.map((r) => { if (r.status !== 'fulfilled') return null; try { const j = P.extractJson(r.value.text); return j ? P.normalizeAction(j.action || j) : null; } catch { return null; } });
    const v = extra.voteActions(cands, obs.tsize); if (!v.ranked.length) return `Голосование: нет корректных вариантов (${v.valid}/${v.total}).`;
    const I = require('../imaging'); const Pl = require('../platform'); const log = [];
    for (const c of v.ranked.slice(0, 2)) {
      const before = obs.sig; const r = await agent.execute(c.action, s, obs, parsed, stats, setClick); await Pl.sleep(400);
      let changed = 1; try { changed = I.diffRatio(before, I.signature((await Pl.screenshot(s.monitor || 0)).img)); } catch {}
      log.push(`${c.action.type}${c.action.x != null ? ` (${c.action.x},${c.action.y})` : ''} — голосов ${c.votes}/${v.total}: ${String(r).slice(0, 200)}; экран ${changed > 0.002 || /^(wait|key|type)$/.test(c.action.type) ? 'изменился ✓' : 'не изменился'}`);
      if (changed > 0.002 || /^(wait|key|type)$/.test(c.action.type) || /ОТКАЗ|не разрешил/.test(String(r))) break;
    }
    return 'Голосование за действие (' + chats.length + ' ИИ, ' + n + ' вариантов):\n' + log.join('\n');
  }
  async execute(agent, a, s, obs, parsed, stats, setClick) {
    const T = a.type;
    if (T === 'research') { const r = await extra.research(String(a.topic || a.query || ''), { chat: (m) => agent.chat(s, m), dataDir: this.dataDir, pages: Math.min(6, a.pages || 3), signal: agent.ctl && agent.ctl.signal }); return `Отчёт сохранён: ${r.file}\n${r.report.slice(0, 6000)}`; }
    if (T === 'swarm') { const ch = this.chats(agent, s); const r = await extra.swarm(String(a.task || ''), ch, { maxParts: Math.min(6, a.parts || 4), signal: agent.ctl && agent.ctl.signal }); return `Рой (${ch.map((c) => c.id).join(', ')}): частей ${r.parts.length}.\n${String(r.result).slice(0, 6000)}`; }
    if (T === 'parallel') {
      const ch = this.chats(agent, s); let verify;
      if (a.test_command && a.dir) verify = async (text) => { const code = (String(text).match(/```[a-z]*\n([\s\S]*?)```/) || [])[1]; if (!code || !a.file) return { score: 0.1, why: 'нет кода' }; const f = path.resolve(a.dir, a.file); if (!f.startsWith(path.resolve(a.dir))) return { score: 0, why: 'путь вне папки' }; const old = fs.existsSync(f) ? fs.readFileSync(f) : null; fs.writeFileSync(f, code); const deny = await this.gate(agent, { type: 'run', command: a.test_command }, s, a.test_command); if (deny) { if (old) fs.writeFileSync(f, old); return { score: 0, why: deny }; } const r = await (require('../platform')).shellRun(a.test_command, 300000, { cwd: a.dir }); if (old) fs.writeFileSync(f, old); else fs.unlinkSync(f); return { score: r.code === 0 ? 1 : 0, why: 'тест: код ' + r.code }; };
      const r = await extra.parallel(String(a.task || ''), ch, { n: Math.min(5, a.n || 3), verify, judge: (m) => agent.chat(s, m) });
      return `Лучший вариант (${r.best.who}, оценка ${r.best.score.toFixed(2)}, ${r.best.why}) из ${r.candidates.length}:\n${String(r.best.text).slice(0, 6000)}`;
    }
    if (T === 'memory_add') { const x = this.memory.add({ topic: a.topic, solution: a.solution, tags: a.tags || [], verified: !!a.verified }); return `В общую память записано: «${x.topic}».`; }
    if (T === 'memory_search') { const r = this.memory.search(a.query || '', 5); return r.length ? r.map((x) => `- ${x.topic}: ${x.solution.slice(0, 500)}`).join('\n') : 'В общей памяти ничего похожего.'; }
    if (T === 'discover') { const r = await extra.discover({ has, run: (c, ar, cwd, t) => runFile(c, ar, cwd, t) }); const sug = a.task ? extra.suggestTools(String(a.task), r.tools, process.platform, () => r.tools.some((t) => t.cmd === 'apt-get')) : null;
      return `Есть: ${r.tools.filter((t) => t.ok).map((t) => t.cmd).join(', ')}\nНет: ${r.tools.filter((t) => !t.ok).map((t) => t.cmd).join(', ')}\nВозможности: ${r.capabilities.join(' ') || '—'}` + (sug ? `\nДля задачи нужны: ${sug.want.join(', ') || '—'}; не хватает: ${sug.missing.join(', ') || '—'}${sug.install.length ? '\nУстановить (через {"type":"install_tool","tool":"…"}): ' + sug.install.map((x) => x.command).join(' ; ') : ''}` : ''); }
    if (T === 'install_tool') { const mgr = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'brew' : 'apt'; const cmd = extra.installCmd(String(a.tool || ''), mgr); if (!cmd) return 'ОШИБКА: не знаю, как поставить ' + a.tool + ' на этой системе.';
      const ok = agent.confirm && await agent.confirm(cmd, ['Установка программы ' + a.tool + ' (менеджер пакетов системы)']); if (!ok) return 'Иван не разрешил установку.';
      const r = await (require('../platform')).shellRun(cmd, 900000, { signal: agent.ctl && agent.ctl.signal }); return `Код ${r.code}: ${(r.output || '').slice(-1500)}`; }
    if (T === 'maintain') { const r = extra.maintain(this.dataDir, { apply: false }); if (a.apply && r.cleaned.length) { const ok = agent.confirm && await agent.confirm(`Удалить старые файлы (${r.cleaned.length})`, r.cleaned.slice(0, 10)); if (ok) Object.assign(r, extra.maintain(this.dataDir, { apply: true })); } return 'Обслуживание: ' + JSON.stringify(r).slice(0, 3000); }
    if (T === 'analyze_screen') { const P = require('../platform'); const I = require('../imaging'); const sigs = []; let last = null; for (let i = 0; i < 3; i++) { try { last = (await P.screenshot(s.monitor || 0)).img; sigs.push(I.signature(last)); } catch {} if (i < 2) await P.sleep(400); }
      const r = extra.analyzeFrames(sigs, { diffRatio: I.diffRatio, windowTitle: await P.activeWindow().catch(() => '') }); let out = 'Анализ экрана: ' + r.ru + ` (изменение ${r.changed}, яркость ${r.brightness})`;
      // ИИ-анализ по снимку — по запросу (ai:true) или настройке visualAI; не отправляем картинки, если они выключены
      if ((a.ai || s.visualAI) && last && s.webchatImages !== false) { try { const ai = await extra.analyzeWithAI((m) => agent.chat(s, m), last.resize({ width: 1024 }).toJPEG(70).toString('base64'), r, a.goal || ''); out += `\nИИ: ${ai.verdict}${ai.problems.length ? ' — ' + ai.problems.join('; ') : ''}${ai.next ? '\nДальше: ' + ai.next : ''}`; } catch (e) { out += '\n(ИИ-анализ не удался: ' + e.message + ')'; } }
      return out; }
    if (T === 'screen_vote') return await this.screenVote(agent, a, s, obs, parsed, stats, setClick);
    if (T === 'build_agent') { const p = this.agents.build(a.description, { name: a.name }); this.agents.save(p); return `Создан помощник «${p.name}». Включить: настройка «Активный помощник» во вкладке «Автономия».`; }
    if (T === 'checkpoint') { const r = this.tm.checkpoint({ label: a.label || 'Точка от агента', paths: existingDirs(a.paths && a.paths.length ? a.paths : s.projectDirs), settings: cleanSettings(s) }); this.tm.prune(); return `Контрольная точка ${r.id}: файлов ${r.files}${r.skipped ? ', пропущено ' + r.skipped : ''}.`; }
    if (T === 'os') {
      const b = osexec.build(a.intent, a.args || {});
      const deny = await this.gate(agent, a, s, b.command); if (deny) return deny;
      const r = await (require('../platform')).shellRun(b.command, Math.min(600, a.timeout || 120) * 1000, { signal: agent.ctl && agent.ctl.signal });
      return `[${b.os}/${b.shell}] ${b.command}\nКод ${r.code}. Вывод:\n${(r.output || '(пусто)').slice(0, 6000)}`;
    }
    if (T === 'run_tests') {
      const dir = a.dir || existingDirs(s.projectDirs)[0]; if (!dir) return 'ОШИБКА: укажи dir — папку проекта.';
      const max = s.testMaxIter || 5;
      if (this.testRuns > max) return `ОТКАЗ: предел запусков тестов (${max}) исчерпан. Сообщи Ивану итог через done.`;
      if (agent.meter && agent.meter.over && agent.meter.over()) return 'ОТКАЗ: бюджет токенов задачи исчерпан.';
      this.testRuns++;
      const d = a.command ? { cmd: String(a.command) } : tester.detect(dir); if (!d) return 'ОШИБКА: не нашёл, как запускать тесты. Передай command.';
      const deny = await this.gate(agent, { type: 'run', command: d.cmd }, s, d.cmd); if (deny) return deny;
      const r = await (require('../platform')).shellRun(d.cmd, Math.min(1800, a.timeout || 600) * 1000, { cwd: dir, signal: agent.ctl && agent.ctl.signal });
      if (r.code === 0) return `Тесты прошли (${d.cmd}), попытка ${this.testRuns}/${max + 1}.`;
      const errs = tester.parseErrors(r.output);
      return `Тесты НЕ прошли (${d.cmd}), попытка ${this.testRuns}/${max + 1}. Ошибки:\n${tester.summarize(errs, r.output)}\nИсправь файлы и снова вызови run_tests.`;
    }
    if (T === 'audit') {
      const dir = a.dir || existingDirs(s.projectDirs)[0]; if (!dir) return 'ОШИБКА: укажи dir.';
      return 'Аудит безопасности:\n' + risk.auditSummary(risk.auditFiles(dir), await risk.auditDeps(dir, runFile, has));
    }
    if (T === 'run_skill') {
      const sk = this.skills.get(a.name); if (!sk) return `ОШИБКА: навыка «${a.name}» нет. Есть: ${this.skills.list().map((x) => x.name).join(', ') || 'пусто'}.`;
      const r = await this.skills.run(a.name, a.params || {}, (st) => agent.execute(st, s, obs, parsed, stats, setClick), (i, st, res) => agent.emit({ kind: 'result', text: `Навык «${sk.name}» шаг ${i + 1}: ${st.type} → ${String(res).slice(0, 200)}` }));
      return r.ok ? `Навык «${sk.name}» выполнен (${r.steps} шагов).` : `Навык «${sk.name}» сломался на шаге ${r.at + 1}: ${String(r.error).slice(0, 300)}. Сбой записан — продолжи вручную.`;
    }
    if (T === 'template_search') { const r = await templates.search(a.request || a.query || '', { kind: a.kind }); return `Заготовки (${r.kind})${r.apiError ? ' [GitHub API: ' + r.apiError + ', показан каталог]' : ''}:\n` + r.items.slice(0, 10).map((x) => `- ${x.repo} — ${x.why || ''} ${x.license ? '[' + x.license + ']' : ''}`).join('\n'); }
    if (T === 'template_fetch') {
      const dest = path.resolve(String(a.dest || path.join(os.homedir(), 'IvanOperator-projects', String(a.repo || '').split('/').pop())));
      if (fs.existsSync(dest)) return 'ОШИБКА: папка уже существует: ' + dest;
      const deny = await this.gate(agent, { type: 'run', command: 'git clone ' + a.repo }, s, `git clone https://github.com/${a.repo} ${dest}`); if (deny) return deny;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const r = await runFile('git', templates.fetchArgs(a.repo, dest), path.dirname(dest), 600000);
      if (r.code !== 0) return 'ОШИБКА git clone: ' + r.output.slice(-800);
      let lic = ''; try { const f = fs.readdirSync(dest).find((x) => /^(LICEN[CS]E|COPYING)/i.test(x)); if (f) lic = (fs.readFileSync(path.join(dest, f), 'utf8').split('\n').find((l) => l.trim()) || '').trim().slice(0, 80); } catch {}
      templates.writeNotice(dest, { repo: a.repo, license: lic, request: a.request || '' });
      this.tm.checkpoint({ label: 'Заготовка: исходное состояние ' + a.repo, paths: [dest] });
      return templates.prompt(a.request || '', { repo: a.repo, license: lic, dest });
    }
    return undefined;
  }
  finishTask(agent, s, { taskText, ok, secs, prov, actions }) {
    try { this.stats.record(classify(taskText), prov, { ok, secs }); } catch {}
    if (ok && s.autoSkills !== false && actions && actions.filter((x) => x && x.ok !== false).length >= 2 && !/^run_skill$/.test((actions[0] || {}).type)) {
      try { const sk = this.skills.fromTask(taskText, actions); if (sk) agent.emit({ kind: 'info', text: `Сохранён навык «${sk.name}» (параметры: ${(sk.params || []).map((p) => p.name).join(', ') || 'нет'}).` }); } catch {}
    }
  }
}
module.exports = { Autonomy, cleanSettings, runFile, has, existingDirs, risk, osexec, tester, templates, workflow, extra };
