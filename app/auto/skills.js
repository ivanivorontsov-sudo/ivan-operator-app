'use strict';
// Библиотека навыков: успешная задача → многоразовый сценарий с параметрами ({{имя}}), JSON или YAML.
// Самоулучшение: журнал сбоев, исправление моделью, новая версия принимается только если прошла проверка/повтор.
// Идеи: Voyager (skill library), Agent Workflow Memory, Skyvern workflows; YAML — js-yaml (MIT).
const fs = require('fs');
const path = require('path');
let yaml = null; try { yaml = require('js-yaml'); } catch {}

const slug = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'skill';
const words = (s) => new Set(String(s).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
// значения, которые обычно меняются от запуска к запуску: адреса, «кавычки», "кавычки", пути, числа ≥ 2 знаков, email
const PARAM_RES = [
  ['url', /https?:\/\/[^\s"'«»<>]+/g], ['email', /[\w.+-]+@[\w-]+\.[\w.]+/g], ['path', /(?:[A-Za-z]:\\|~\/|\/)(?:[^\s"'«»]+)/g],
  ['text', /«([^»]{1,200})»|"([^"]{1,200})"|“([^”]{1,200})”/g], ['number', /(?<![\w.])\d{2,}(?:[.,]\d+)?(?![\w.])/g],
];
function extractParams(task) {
  const out = []; const seen = new Set(); let t = String(task || '');
  for (const [kind, re] of PARAM_RES) { re.lastIndex = 0; let m; while ((m = re.exec(t))) { const v = (m[1] || m[2] || m[3] || m[0]).replace(/[.,;:!?)]+$/, ''); if (v.length < 2 || seen.has(v)) continue; seen.add(v); out.push({ name: kind + (out.filter((p) => p.kind === kind).length + 1), kind, default: v }); } }
  return out;
}
function templatize(value, params) {
  if (typeof value === 'string') { let s = value; for (const p of params.slice().sort((a, b) => b.default.length - a.default.length)) s = s.split(p.default).join('{{' + p.name + '}}'); return s; }
  if (Array.isArray(value)) return value.map((v) => templatize(v, params));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, templatize(v, params)]));
  return value;
}
function render(value, vals) {
  if (typeof value === 'string') return value.replace(/\{\{(\w+)\}\}/g, (m, k) => (vals[k] != null ? String(vals[k]) : m));
  if (Array.isArray(value)) return value.map((v) => render(v, vals));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, render(v, vals)]));
  return value;
}
const VOLATILE = /^(screenshot|wait|observe|zoom|done|ask_user)$/;

class SkillLibrary {
  constructor(dir) { this.dir = path.join(dir, 'skills'); fs.mkdirSync(this.dir, { recursive: true }); }
  file(name, ext = 'json') { return path.join(this.dir, slug(name) + '.' + ext); }
  list() {
    return fs.readdirSync(this.dir).filter((f) => /\.(json|ya?ml)$/.test(f)).map((f) => { try { return this.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'), f); } catch { return null; } }).filter(Boolean)
      .map((s) => ({ name: s.name, description: s.description, params: s.params, version: s.version, steps: s.steps.length, stats: s.stats, failures: (s.failures || []).length, updated: s.updated }));
  }
  parse(text, f = '.json') { const s = /\.ya?ml$/.test(f) ? (yaml ? yaml.load(text) : null) : JSON.parse(text); if (!s || !s.name || !Array.isArray(s.steps)) throw new Error('Неверный формат навыка'); s.params = s.params || []; s.stats = s.stats || { runs: 0, ok: 0, fail: 0 }; s.version = s.version || 1; return s; }
  get(name) {
    for (const ext of ['json', 'yaml', 'yml']) { const p = this.file(name, ext); if (fs.existsSync(p)) return this.parse(fs.readFileSync(p, 'utf8'), p); }
    const m = this.list().find((s) => s.name.toLowerCase() === String(name).toLowerCase()); if (m && slug(m.name) !== slug(name)) return this.get(m.name);
    return null;
  }
  put(skill) { skill.updated = new Date().toISOString(); for (const ext of ['yaml', 'yml']) { const p = this.file(skill.name, ext); if (fs.existsSync(p)) { fs.writeFileSync(p, yaml.dump(skill, { lineWidth: 200 })); return skill; } } fs.writeFileSync(this.file(skill.name), JSON.stringify(skill, null, 1)); return skill; }
  remove(name) { for (const ext of ['json', 'yaml', 'yml']) { const p = this.file(name, ext); if (fs.existsSync(p)) fs.unlinkSync(p); } }
  // успешная задача → навык (повторяющиеся смотровые шаги убираются, значения из задачи становятся параметрами)
  fromTask(task, actions, { name, description } = {}) {
    const steps0 = (actions || []).map((a) => (a && a.action) || a).filter((a) => a && a.type && !VOLATILE.test(a.type));
    if (!steps0.length) throw new Error('Нет действий для навыка');
    const params = extractParams(task).map(({ name, kind, default: d }) => ({ name, kind, default: d }));
    const used = params.filter((p) => JSON.stringify(steps0).includes(p.default));
    const steps = templatize(steps0, used);
    const nm = String(name || String(task).replace(/https?:\/\/\S+/g, '').replace(/[«"“][^»"”]*[»"”]/g, '').trim().split(/\s+/).slice(0, 6).join(' ') || 'Навык').slice(0, 60);
    const prev = this.get(nm);
    const skill = { name: nm, description: description || String(task).slice(0, 300), params: used, steps, version: prev ? prev.version + 1 : 1, versions: prev ? [...(prev.versions || []), { version: prev.version, steps: prev.steps, params: prev.params, at: prev.updated }].slice(-10) : [], stats: prev ? prev.stats : { runs: 0, ok: 0, fail: 0 }, failures: [], source: 'auto', created: prev ? prev.created : new Date().toISOString() };
    return this.put(skill);
  }
  importText(text, fmt = 'json') { const s = this.parse(text, fmt === 'yaml' ? 'x.yaml' : 'x.json'); return this.put(s); }
  exportText(name, fmt = 'yaml') { const s = this.get(name); if (!s) throw new Error('Нет навыка'); return fmt === 'yaml' && yaml ? yaml.dump(s, { lineWidth: 200 }) : JSON.stringify(s, null, 1); }
  // подобрать навык к задаче (пересечение слов описания/имени)
  match(task, min = 0.5) {
    const w = words(task); let best = null;
    for (const s of this.list()) { const sw = words(s.name + ' ' + s.description); const inter = [...sw].filter((x) => w.has(x)).length; const sc = inter / Math.max(1, Math.min(sw.size, w.size)); if (sc >= min && (!best || sc > best.score)) best = { name: s.name, score: +sc.toFixed(2) }; }
    return best;
  }
  stepsFor(name, vals = {}) {
    const s = this.get(name); if (!s) throw new Error(`Навык «${name}» не найден`);
    const all = Object.fromEntries(s.params.map((p) => [p.name, p.default])); Object.assign(all, vals || {});
    const steps = render(s.steps, all); const left = JSON.stringify(steps).match(/\{\{(\w+)\}\}/); if (left) throw new Error('Не задан параметр «' + left[1] + '»');
    return { skill: s, steps };
  }
  async run(name, vals, exec, onStep) {
    const { skill, steps } = this.stepsFor(name, vals);
    for (let i = 0; i < steps.length; i++) {
      let res; try { res = await exec(steps[i]); } catch (e) { res = 'ОШИБКА: ' + (e.message || e); }
      onStep && onStep(i, steps[i], res);
      if (/^(ОШИБКА|ОТКАЗ|Иван ЗАПРЕТИЛ)/.test(String(res))) { this.recordResult(skill.name, false, { step: i, action: steps[i], error: String(res).slice(0, 500) }); return { ok: false, at: i, error: res }; }
    }
    this.recordResult(skill.name, true); return { ok: true, steps: steps.length };
  }
  recordResult(name, ok, failure) {
    const s = this.get(name); if (!s) return; s.stats.runs++; ok ? s.stats.ok++ : s.stats.fail++;
    if (!ok && failure) s.failures = [...(s.failures || []), { ...failure, at: new Date().toISOString(), version: s.version }].slice(-20);
    this.put(s);
  }
  // Самоулучшение: propose(skill, failures) → {steps, params?} (от модели); verify(candidate) → {ok, why}
  async improve(name, propose, verify) {
    const s = this.get(name); if (!s) throw new Error('Нет навыка');
    if (!(s.failures || []).length) return { changed: false, why: 'Сбоев нет — улучшать нечего' };
    let cand; try { cand = await propose(s, s.failures); } catch (e) { return { changed: false, why: 'Модель не предложила исправление: ' + e.message }; }
    if (!cand || !Array.isArray(cand.steps) || !cand.steps.length || !cand.steps.every((a) => a && typeof a.type === 'string')) return { changed: false, why: 'Предложение не в формате навыка' };
    const next = { ...s, steps: cand.steps, params: cand.params || s.params };
    const v = await verify(next).catch((e) => ({ ok: false, why: e.message }));
    s.improveLog = [...(s.improveLog || []), { at: new Date().toISOString(), from: s.version, accepted: !!(v && v.ok), why: v && v.why || '' }].slice(-20);
    if (!v || !v.ok) { this.put(s); return { changed: false, why: 'Новая версия не прошла проверку: ' + (v && v.why || '') }; }
    next.versions = [...(s.versions || []), { version: s.version, steps: s.steps, params: s.params, at: s.updated }].slice(-10);
    next.version = s.version + 1; next.failures = []; next.improveLog = s.improveLog; this.put(next);
    return { changed: true, version: next.version };
  }
  rollback(name, version) {
    const s = this.get(name); const v = (s && s.versions || []).find((x) => x.version === Number(version)); if (!v) throw new Error('Нет такой версии');
    s.versions.push({ version: s.version, steps: s.steps, params: s.params, at: s.updated }); s.steps = v.steps; s.params = v.params; s.version = Math.max(...s.versions.map((x) => x.version)) + 1; return this.put(s);
  }
  hint(limit = 15) {
    const l = this.list(); if (!l.length) return '';
    return `\n\n## НАВЫКИ (проверенные сценарии)\n${l.slice(0, limit).map((s) => `- «${s.name}»${s.params.length ? ' (параметры: ' + s.params.map((p) => p.name + '=' + JSON.stringify(p.default).slice(0, 40)).join(', ') + ')' : ''}: ${String(s.description).slice(0, 100)}`).join('\n')}\nЕсли задача подходит под навык, верни {"type":"run_skill","name":"…","params":{…}} — программа выполнит шаги сама.`;
  }
}
module.exports = { SkillLibrary, extractParams, templatize, render, slug };
