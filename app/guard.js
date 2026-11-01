'use strict';
// 1.2.0: счётчик токенов, бюджет задачи, запрет бесконечных переходов между моделями,
// передача контекста другой нейросети (только ключевые снимки), мгновенная отмена.

// Оценка токенов, когда провайдер не прислал usage: кириллица ≈ 2,6 симв/токен, латиница ≈ 4.
function estimateText(t) {
  t = String(t || ''); if (!t) return 0;
  const cyr = (t.match(/[\u0400-\u04FF]/g) || []).length;
  return Math.ceil(cyr / 2.6 + (t.length - cyr) / 4);
}
function estimateMessages(msgs) {
  let n = 0;
  for (const m of msgs || []) for (const c of (Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }])) {
    if (c.type === 'text') n += estimateText(c.text);
    else if (c.type === 'image') n += c.tokens || Math.min(1600, Math.ceil((c.data || '').length * 0.75 / 750)); // ~1 токен на 750 байт JPEG
  }
  return n + 4 * (msgs || []).length;
}
function usageOf(r) {
  const u = r && r.usage; if (!u) return null;
  const i = u.prompt_tokens ?? u.input_tokens ?? u.input, o = u.completion_tokens ?? u.output_tokens ?? u.output;
  return (Number.isFinite(i) || Number.isFinite(o)) ? { input: i || 0, output: o || 0 } : null;
}

class TokenMeter {
  constructor(limit = 0) { this.limit = Number(limit) || 0; this.input = 0; this.output = 0; this.calls = 0; this.estimated = false; }
  add(msgs, reply) {
    const u = usageOf(reply); this.calls++;
    if (u) { this.input += u.input; this.output += u.output; }
    else { this.estimated = true; this.input += estimateMessages(msgs); this.output += estimateText(reply && reply.text); }
    return this.total;
  }
  get total() { return this.input + this.output; }
  over() { return this.limit > 0 && this.total >= this.limit; }
  snapshot() { return { input: this.input, output: this.output, total: this.total, calls: this.calls, estimated: this.estimated, limit: this.limit }; }
}
function budgetError(m) { const e = new Error(`Достигнут бюджет задачи: ${m.total} из ${m.limit} токенов. Остановлено автоматически.`); e.stopped = true; e.budget = true; return e; }

// Запрет бесконечных циклов между моделями: лимит переходов, лимит повторов и поиск повторяющейся последовательности.
class HopGuard {
  constructor({ maxHops = 4, maxRetries = 12 } = {}) { this.maxHops = maxHops; this.maxRetries = maxRetries; this.path = []; this.retries = 0; }
  visit(id) {
    this.path.push(id);
    const hops = this.path.length - 1;
    if (hops > this.maxHops) return `слишком много переключений между моделями (${hops} > ${this.maxHops})`;
    // A→B→A→B: последовательность длины 2..3 повторилась подряд
    for (let k = 2; k <= 3; k++) { const p = this.path; if (p.length >= 2 * k && p.slice(-k).join('>') === p.slice(-2 * k, -k).join('>')) return 'зацикливание между моделями: ' + p.slice(-2 * k).join(' → '); }
    return null;
  }
  retry() { return ++this.retries > this.maxRetries ? `превышен лимит повторов (${this.maxRetries})` : null; }
}

// Ключевые снимки для передачи: последний + отличающиеся предыдущие (по подписи), не более n.
function pickKeyShots(shots, n = 3) {
  const out = []; const seen = new Set();
  for (let i = shots.length - 1; i >= 0 && out.length < n; i--) { const s = shots[i]; const k = s.sig || (s.data || '').slice(-64); if (seen.has(k)) continue; seen.add(k); out.unshift(s); }
  return out;
}
// Пакет передачи контекста новой нейросети
function handoff({ task, memory, log, shots, from, to, reason }) {
  const lines = (log || []).slice(-12).map((l) => '• ' + String(l).slice(0, 300));
  return `ПЕРЕДАЧА ЗАДАЧИ от «${from}» к «${to}» (причина: ${reason}).\nЗадача Ивана: ${task}\n` + (memory ? `Память: ${String(memory).slice(0, 3000)}\n` : '') +
    (lines.length ? `Последние шаги:\n${lines.join('\n')}\n` : '') + (shots && shots.length ? `Приложено ключевых снимков: ${shots.length} (последний — текущий экран).\n` : '') + 'Продолжи с текущего состояния, не начинай сначала.';
}

// Мгновенная отмена: любая ожидающая операция отклоняется в момент abort()
function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(Object.assign(new Error('Остановлено'), { stopped: true }));
  return new Promise((res, rej) => {
    const on = () => rej(Object.assign(new Error('Остановлено'), { stopped: true }));
    signal.addEventListener('abort', on, { once: true });
    promise.then((v) => { signal.removeEventListener('abort', on); res(v); }, (e) => { signal.removeEventListener('abort', on); rej(e); });
  });
}
const sleepA = (ms, signal) => abortable(new Promise((r) => setTimeout(r, ms)), signal);

module.exports = { estimateText, estimateMessages, usageOf, TokenMeter, budgetError, HopGuard, pickKeyShots, handoff, abortable, sleepA };
