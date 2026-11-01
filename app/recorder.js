'use strict';
// Запись хода задачи + HTML-отчёт с кадрами (идея Skyvern / Browser Use recordings, история задач OpenAI Operator).
const fs = require('fs');
const path = require('path');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PASSIVE = /^(screenshot|wait|observe|zoom|done|ask_user|run_recipe)$/;
class Recorder {
  constructor(dir, task) {
    this.id = new Date().toISOString().replace(/[:.]/g, '-');
    this.dir = path.join(dir, 'runs', this.id); fs.mkdirSync(this.dir, { recursive: true });
    this.task = task; this.steps = []; this.actions = [];
  }
  step(n, { thought, action, result, shot }) {
    let img = null;
    if (shot && typeof shot === 'string' && shot.length < 4e6) { img = `step${n}.jpg`; try { fs.writeFileSync(path.join(this.dir, img), Buffer.from(shot.replace(/^data:image\/\w+;base64,/, ''), 'base64')); } catch { img = null; } }
    this.steps.push({ n, thought: thought || '', action: JSON.stringify(action || {}), result: String(result || ''), img });
  }
  act(a, ok) { if (a && ok && !PASSIVE.test(a.type)) this.actions.push(a); }
  finish(status, answer) {
    const html = `<!doctype html><meta charset="utf-8"><title>Ход задачи</title><style>body{font:14px sans-serif;max-width:1000px;margin:auto}img{max-width:100%;border:1px solid #ccc}.s{border-bottom:1px solid #ddd;padding:8px}code{background:#f4f4f4;display:block;white-space:pre-wrap}</style>
<h1>ИванОператор — ход задачи</h1><p><b>Задача:</b> ${esc(this.task)}</p><p><b>Итог:</b> ${esc(status)} — ${esc(answer)}</p>
${this.steps.map((s) => `<div class="s"><h3>Шаг ${s.n}</h3><p>${esc(s.thought)}</p><code>${esc(s.action)}</code><p>${esc(s.result)}</p>${s.img ? `<img src="${s.img}">` : ''}</div>`).join('\n')}`;
    fs.writeFileSync(path.join(this.dir, 'report.html'), html);
    fs.writeFileSync(path.join(this.dir, 'actions.json'), JSON.stringify(this.actions, null, 1));
    return path.join(this.dir, 'report.html');
  }
}
module.exports = { Recorder, PASSIVE };
