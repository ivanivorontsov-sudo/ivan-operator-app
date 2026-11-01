'use strict';
// Рецепты: сохранённые успешные последовательности действий и повтор без модели,
// при сбое — продолжение моделью (Agent Workflow Memory, Skyvern workflows, Open Interpreter skills).
const fs = require('fs');
const path = require('path');
const file = (dir) => path.join(dir, 'recipes.json');
function load(dir) { try { return JSON.parse(fs.readFileSync(file(dir), 'utf8')); } catch { return {}; } }
function save(dir, name, task, actions) {
  name = String(name || '').trim().slice(0, 60); if (!name) throw new Error('Пустое имя рецепта');
  if (!actions || !actions.length) throw new Error('Нет действий для сохранения');
  const r = load(dir); r[name] = { task, actions, saved: new Date().toISOString() };
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file(dir), JSON.stringify(r, null, 1)); return r[name];
}
function remove(dir, name) { const r = load(dir); delete r[name]; fs.writeFileSync(file(dir), JSON.stringify(r, null, 1)); }
function hint(dir) {
  const r = load(dir); const n = Object.keys(r);
  return n.length ? `\n\n## РЕЦЕПТЫ (проверенные последовательности)\n${n.slice(0, 15).map((k) => `- «${k}»: ${String(r[k].task).slice(0, 120)}`).join('\n')}\nЕсли задача совпадает с рецептом, верни {"type":"run_recipe","name":"…"} — программа повторит шаги сама.` : '';
}
async function replay(actions, exec, onStep) {
  for (let i = 0; i < actions.length; i++) {
    let res;
    try { res = await exec(actions[i]); } catch (e) { return { ok: false, at: i, error: String(e.message || e) }; }
    onStep && onStep(i, actions[i], res);
    if (/^ОШИБКА/.test(String(res))) return { ok: false, at: i, error: res };
  }
  return { ok: true };
}
module.exports = { load, save, remove, hint, replay };
