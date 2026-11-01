'use strict';
// Единый постоянный чат: полный журнал на диске + сжатая «память» для длинных диалогов.
const fs = require('fs');
const path = require('path');

class History {
  constructor(dir) {
    this.dir = dir; fs.mkdirSync(path.join(dir, 'shots'), { recursive: true });
    this.file = path.join(dir, 'chat.jsonl'); this.memFile = path.join(dir, 'memory.md'); this.stateFile = path.join(dir, 'state.json');
    this.entries = [];
    try { this.entries = fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch {}
    try { this.state = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); } catch { this.state = { compactedUpto: 0 }; }
    try { this.memory = fs.readFileSync(this.memFile, 'utf8'); } catch { this.memory = ''; }
  }
  add(e) {
    e.id = (this.entries.length ? this.entries[this.entries.length - 1].id : 0) + 1; e.ts = Date.now();
    this.entries.push(e); fs.appendFileSync(this.file, JSON.stringify(e) + '\n'); return e;
  }
  saveShot(id, jpegBuf) { const f = `shot-${id}.jpg`; fs.writeFileSync(path.join(this.dir, 'shots', f), jpegBuf); this.pruneShots(); return f; }
  shotPath(f) { return path.join(this.dir, 'shots', f); }
  pruneShots(keep = 300) {
    try { const fl = fs.readdirSync(path.join(this.dir, 'shots')).sort((a, b) => parseInt(a.slice(5)) - parseInt(b.slice(5)));
      for (const f of fl.slice(0, Math.max(0, fl.length - keep))) fs.unlinkSync(path.join(this.dir, 'shots', f)); } catch {}
  }
  active() { return this.entries.filter((e) => e.id > this.state.compactedUpto); }
  setMemory(text, upto) {
    this.memory = text; this.state.compactedUpto = upto;
    fs.writeFileSync(this.memFile, text); fs.writeFileSync(this.stateFile, JSON.stringify(this.state));
  }
  visible(limit = 400) { return this.entries.filter((e) => e.role !== 'internal').slice(-limit); }
}

// Оценка токенов: ~3 символа на токен для русского/JSON, снимок ≈ (w*h)/(28*28) токенов
function estimateTokens(messages) {
  let t = 0;
  for (const m of messages) for (const c of m.content) t += c.type === 'image' ? (c.tokens || 1300) : Math.ceil((c.text || '').length / 3);
  return t;
}

// Собрать сообщения для модели.
// opts: { system, keepShots, currentShot: {data, tokens}, budget }
function buildMessages(hist, opts) {
  const sys = opts.system + (hist.memory ? '\n\n## Память о прошлых задачах и разговоре (сжато)\n' + hist.memory : '');
  const msgs = [{ role: 'system', content: [{ type: 'text', text: sys }] }];
  const act = hist.active();
  for (const e of act) {
    if (e.role === 'user') msgs.push({ role: 'user', content: [{ type: 'text', text: 'Задача/сообщение от Ивана: ' + e.text }] });
    else if (e.role === 'model') msgs.push({ role: 'assistant', content: [{ type: 'text', text: e.raw || e.text }] });
    else if (e.role === 'result') msgs.push({ role: 'user', content: [{ type: 'text', text: e.text }] });
    else if (e.role === 'assistant') msgs.push({ role: 'assistant', content: [{ type: 'text', text: e.text }] });
  }
  if (!opts.currentShot && opts.currentText) { const last = msgs[msgs.length - 1]; const part = [{ type: 'text', text: opts.currentText }];
    if (last && last.role === 'user') last.content = last.content.concat(part); else msgs.push({ role: 'user', content: part }); }
  if (opts.currentShot) {
    const last = msgs[msgs.length - 1];
    const part = [{ type: 'text', text: opts.currentText || 'Текущий снимок экрана:' }, { type: 'image', data: opts.currentShot.data, tokens: opts.currentShot.tokens }];
    if (last.role === 'user') last.content = last.content.concat(part); else msgs.push({ role: 'user', content: part });
  }
  return msgs;
}

// Механическая выжимка (если модель не смогла сжать)
function mechanicalSummary(entries) {
  const out = [];
  for (const e of entries) {
    if (e.role === 'user') out.push(`- Иван попросил: ${e.text.slice(0, 300)}`);
    if (e.role === 'assistant') out.push(`- Итог: ${e.text.slice(0, 300)}`);
  }
  return out.join('\n');
}

module.exports = { History, estimateTokens, buildMessages, mechanicalSummary };
