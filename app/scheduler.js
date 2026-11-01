'use strict';
// Расписание задач (идея scheduled tasks у OpenAI Operator/ChatGPT agent): «каждые N мин/ч», «ежедневно ЧЧ:ММ».
function parse(s) {
  s = String(s || '').trim().toLowerCase();
  let m = s.match(/^(?:каждые|каждый|every)\s+(\d+)\s*(мин|m|ч|h)/);
  if (m) { const ms = Number(m[1]) * (/^(ч|h)/.test(m[2]) ? 3600e3 : 60e3); return ms >= 60e3 ? { kind: 'every', ms } : null; }
  m = s.match(/^(?:ежедневно|daily)\s+(\d{1,2}):(\d{2})$/);
  if (m && +m[1] < 24 && +m[2] < 60) return { kind: 'daily', h: +m[1], mi: +m[2] };
  return null;
}
function next(rule, from = new Date()) {
  if (rule.kind === 'every') return new Date(from.getTime() + rule.ms);
  const d = new Date(from); d.setSeconds(0, 0); d.setHours(rule.h, rule.mi);
  if (d <= from) d.setDate(d.getDate() + 1); return d;
}
class Scheduler {
  constructor(run, busy) { this.run = run; this.busy = busy; this.jobs = new Map(); this.seq = 0; }
  add(spec, task) {
    const rule = parse(spec); if (!rule) throw new Error('Не понял расписание. Примеры: «каждые 30 мин», «ежедневно 09:00»');
    if (!String(task || '').trim()) throw new Error('Пустая задача');
    const id = ++this.seq; const job = { id, spec, task, rule, next: next(rule) };
    const arm = () => { job.timer = setTimeout(async () => { job.next = next(rule); arm(); if (!this.busy()) { this.runs = (this.runs || 0) + 1; try { await this.run(task); } catch {} } }, Math.max(1000, job.next - Date.now())); if (job.timer.unref) job.timer.unref(); };
    arm(); this.jobs.set(id, job); return this.view(job);
  }
  view({ id, spec, task, next: n }) { return { id, spec, task, next: n.toISOString() }; }
  remove(id) { const j = this.jobs.get(id); if (j) { clearTimeout(j.timer); this.jobs.delete(id); } return !!j; }
  list() { return [...this.jobs.values()].map((j) => this.view(j)); }
  stopAll() { for (const id of [...this.jobs.keys()]) this.remove(id); }
}
module.exports = { parse, next, Scheduler };
