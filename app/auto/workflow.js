'use strict';
// Генератор рабочих процессов: обычное описание → редактируемая цепочка шагов (предпросмотр с оценкой риска перед запуском).
const risk = require('./risk');
const SPLIT = /\n+|;\s*|\s*(?:,\s*)?(?<![\p{L}])(?:затем|потом|после этого|далее|и после|в конце|наконец|then|after that)(?![\p{L}])\s*,?\s*/iu;
const INTENT_RULES = [
  [/(?:создай|сделай)\s+папку\s+(?:«([^»]+)»|"([^"]+)"|(\S+))/i, (m) => ({ intent: 'make_dir', args: { path: m[1] || m[2] || m[3] } })],
  [/удали\s+папку\s+(?:«([^»]+)»|"([^"]+)"|(\S+))/i, (m) => ({ intent: 'remove_dir', args: { path: m[1] || m[2] || m[3] } })],
  [/удали\s+файл\s+(?:«([^»]+)»|"([^"]+)"|(\S+))/i, (m) => ({ intent: 'remove_file', args: { path: m[1] || m[2] || m[3] } })],
  [/скопируй\s+(?:«([^»]+)»|(\S+))\s+(?:в|во)\s+(?:«([^»]+)»|(\S+))/i, (m) => ({ intent: 'copy', args: { from: m[1] || m[2], to: m[3] || m[4] } })],
  [/(?:перемести|переименуй)\s+(?:«([^»]+)»|(\S+))\s+(?:в|во)\s+(?:«([^»]+)»|(\S+))/i, (m) => ({ intent: 'move', args: { from: m[1] || m[2], to: m[3] || m[4] } })],
  [/скачай\s+(https?:\/\/\S+)\s+(?:в|во)\s+(?:«([^»]+)»|(\S+))/i, (m) => ({ intent: 'download', args: { url: m[1], to: m[2] || m[3] } })],
  [/распакуй\s+(?:«([^»]+)»|(\S+))\s+(?:в|во)\s+(?:«([^»]+)»|(\S+))/i, (m) => ({ intent: 'unzip', args: { path: m[1] || m[2], to: m[3] || m[4] } })],
  [/свободное место|сколько места на диске/i, () => ({ intent: 'disk_free', args: {} })],
  [/сведения о системе|какая (?:у меня )?(?:ос|система)/i, () => ({ intent: 'os_info', args: {} })],
];
function stepFrom(text, i, skills) {
  const t = text.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim(); if (!t) return null;
  const base = { id: i + 1, text: t };
  if (/^(контрольн\w* точк|сохрани состояние|checkpoint)/i.test(t)) return { ...base, kind: 'checkpoint' };
  if (/(?:^|\s)(запусти|прогони|выполни)\s+тест/i.test(t)) return { ...base, kind: 'test', dir: (t.match(/(?:в|во)\s+(?:папке\s+)?(?:«([^»]+)»|(\/\S+|[A-Za-z]:\\\S+))/) || []).slice(1).find(Boolean) || '' };
  if (/(?:^|\s)(аудит|проверь безопасност)/i.test(t)) return { ...base, kind: 'audit', dir: (t.match(/(?:«([^»]+)»|(\/\S+|[A-Za-z]:\\\S+))/) || []).slice(1).find(Boolean) || '' };
  const sk = /навык\s+«([^»]+)»/i.exec(t) || (skills && skills.match && (() => { const m = skills.match(t, 0.7); return m ? [null, m.name] : null; })());
  if (sk) return { ...base, kind: 'skill', name: sk[1], params: {} };
  for (const [re, f] of INTENT_RULES) { const m = re.exec(t); if (m) return { ...base, kind: 'os', ...f(m) }; }
  return { ...base, kind: 'task' };
}
function generate(text, { skills } = {}) {
  const lines = String(text || '').trim().split(SPLIT).map((x) => x && x.trim()).filter(Boolean);
  const steps = lines.map((l, i) => stepFrom(l, i, skills)).filter(Boolean).map((s, i) => ({ ...s, id: i + 1 }));
  return preview(steps);
}
function preview(steps) {
  return steps.map((s) => { let r = { score: 0, level: 'low', reasons: [] };
    if (s.kind === 'os') r = risk.assess({ type: 'os', intent: s.intent, args: s.args });
    else if (s.kind === 'task') r = risk.assessCommand(s.text.replace(/«|»/g, ''));
    return { ...s, risk: r }; });
}
function validate(steps) {
  const errs = []; if (!Array.isArray(steps) || !steps.length) return ['Пустая цепочка'];
  steps.forEach((s, i) => { if (!s || !['task', 'os', 'skill', 'checkpoint', 'test', 'audit'].includes(s.kind)) errs.push(`Шаг ${i + 1}: неизвестный вид «${s && s.kind}»`);
    else if (s.kind === 'os') { try { require('./osexec').build(s.intent, s.args || {}); } catch (e) { errs.push(`Шаг ${i + 1}: ${e.message}`); } }
    else if (s.kind === 'task' && !String(s.text || '').trim()) errs.push(`Шаг ${i + 1}: пустой текст`); });
  return errs;
}
// Модель может улучшить разбиение: refine(text) → JSON-массив шагов
async function generateWithModel(text, chat, opts) {
  const base = generate(text, opts); if (!chat) return base;
  try {
    const t = await chat(`Разбей задачу на шаги для агента на компьютере. Ответь ТОЛЬКО JSON-массивом объектов {"kind":"task|os|skill|checkpoint|test|audit","text":"…","intent"?,"args"?,"name"?}. Намерения os: ${require('./osexec').list().map((x) => x.intent).join(', ')}.\nЗадача: ${text}`);
    const m = String(t).match(/\[[\s\S]*\]/); if (!m) return base;
    const arr = JSON.parse(require('jsonrepair').jsonrepair(m[0])).map((s, i) => ({ id: i + 1, ...s }));
    return validate(arr).length ? base : preview(arr);
  } catch { return base; }
}
// для агента: цепочка → текст задачи с явными подсказками действий
function toTask(steps) {
  return 'Выполни строго по шагам (после каждого шага проверь результат):\n' + steps.map((s, i) => `${i + 1}. ` + (s.kind === 'os' ? `${s.text} → действие {"type":"os","intent":"${s.intent}","args":${JSON.stringify(s.args || {})}}`
    : s.kind === 'skill' ? `${s.text} → {"type":"run_skill","name":"${s.name}","params":${JSON.stringify(s.params || {})}}`
    : s.kind === 'checkpoint' ? `${s.text} → {"type":"checkpoint","label":${JSON.stringify(s.text)}}`
    : s.kind === 'test' ? `${s.text} → {"type":"run_tests","dir":${JSON.stringify(s.dir || '')}}`
    : s.kind === 'audit' ? `${s.text} → {"type":"audit","dir":${JSON.stringify(s.dir || '')}}` : s.text)).join('\n');
}
module.exports = { generate, generateWithModel, preview, validate, toTask };
