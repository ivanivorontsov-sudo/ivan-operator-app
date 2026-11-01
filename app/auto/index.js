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
  async execute(agent, a, s, obs, parsed, stats, setClick) {
    const T = a.type;
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
module.exports = { Autonomy, cleanSettings, runFile, has, existingDirs, risk, osexec, tester, templates, workflow };
