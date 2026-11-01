'use strict';
// Машина времени проекта: контрольные точки (файлы + настройки + состояние) в хранилище по содержимому
// (как объекты git: sha256 → файл, одинаковые файлы хранятся один раз). Восстановление в любую точку.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IGNORE = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.cache', 'dist', 'build', 'target', '.gradle', '.next', '.ivan-tm']);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

class TimeMachine {
  constructor(dir, o = {}) {
    this.dir = dir; this.objDir = path.join(dir, 'objects'); this.cpDir = path.join(dir, 'checkpoints');
    this.maxCheckpoints = o.maxCheckpoints || 60; this.maxFileBytes = (o.maxFileMB || 20) * 2 ** 20;
    this.maxFiles = o.maxFiles || 20000; this.maxTotalBytes = (o.maxTotalMB || 1024) * 2 ** 20;
    fs.mkdirSync(this.objDir, { recursive: true }); fs.mkdirSync(this.cpDir, { recursive: true });
  }
  // обход папки без игнорируемых; ссылки не разыменовываются (безопасность)
  walk(root) {
    const out = []; let bytes = 0; const stack = [''];
    while (stack.length) {
      const rel = stack.pop(); let ents;
      try { ents = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        const r = rel ? path.join(rel, e.name) : e.name;
        if (e.isDirectory()) { if (!IGNORE.has(e.name)) stack.push(r); continue; }
        if (!e.isFile()) continue;
        const st = fs.statSync(path.join(root, r));
        if (st.size > this.maxFileBytes) continue;
        bytes += st.size; out.push({ rel: r, size: st.size, mode: st.mode & 0o777 });
        if (out.length > this.maxFiles || bytes > this.maxTotalBytes) throw new Error(`Папка слишком большая для контрольной точки: ${root} (> ${this.maxFiles} файлов или ${Math.round(this.maxTotalBytes / 2 ** 20)} МБ)`);
      }
    }
    return out;
  }
  putObject(buf) { const h = sha(buf); const p = path.join(this.objDir, h.slice(0, 2), h); if (!fs.existsSync(p)) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, buf); } return h; }
  getObject(h) { return fs.readFileSync(path.join(this.objDir, h.slice(0, 2), h)); }
  checkpoint({ label = 'Контрольная точка', paths = [], settings = null, state = null, reason = '' } = {}) {
    const roots = []; const skipped = [];
    for (const p0 of paths) {
      const p = path.resolve(String(p0)); if (!fs.existsSync(p)) { skipped.push(p + ': нет такой папки'); continue; }
      const st = fs.statSync(p);
      try {
        const files = st.isDirectory() ? this.walk(p).map((f) => ({ ...f, sha: this.putObject(fs.readFileSync(path.join(p, f.rel))) }))
          : [{ rel: path.basename(p), size: st.size, mode: st.mode & 0o777, sha: this.putObject(fs.readFileSync(p)) }];
        roots.push({ root: st.isDirectory() ? p : path.dirname(p), single: !st.isDirectory(), files });
      } catch (e) { skipped.push(e.message); }
    }
    const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
    const cp = { id, ts: Date.now(), label: String(label).slice(0, 200), reason, roots, settings, state, skipped };
    fs.writeFileSync(path.join(this.cpDir, id + '.json'), JSON.stringify(cp));
    this.prune(); return { id, files: roots.reduce((n, r) => n + r.files.length, 0), skipped };
  }
  list() {
    return fs.readdirSync(this.cpDir).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(this.cpDir, f), 'utf8')); } catch { return null; } })
      .filter(Boolean).sort((a, b) => b.ts - a.ts).map((c) => ({ id: c.id, ts: c.ts, label: c.label, reason: c.reason, roots: c.roots.map((r) => r.single ? path.join(r.root, r.files[0] ? r.files[0].rel : '') : r.root), files: c.roots.reduce((n, r) => n + r.files.length, 0), hasSettings: !!c.settings, hasState: !!c.state }));
  }
  get(id) { if (!/^[\w-]+$/.test(id)) throw new Error('Неверный id'); return JSON.parse(fs.readFileSync(path.join(this.cpDir, id + '.json'), 'utf8')); }
  // что изменится при восстановлении
  diff(id) {
    const cp = this.get(id); const res = { changed: [], missing: [], added: [] };
    for (const r of cp.roots) {
      const known = new Map(r.files.map((f) => [f.rel, f]));
      for (const f of r.files) { const p = path.join(r.root, f.rel); if (!fs.existsSync(p)) res.missing.push(p); else if (sha(fs.readFileSync(p)) !== f.sha) res.changed.push(p); }
      if (!r.single) { let cur = []; try { cur = this.walk(r.root); } catch {} for (const f of cur) if (!known.has(f.rel)) res.added.push(path.join(r.root, f.rel)); }
    }
    return res;
  }
  restore(id, { files = true, deleteNew = true, safety = true } = {}) {
    const cp = this.get(id); let before = null;
    if (safety) before = this.checkpoint({ label: 'Перед восстановлением «' + cp.label + '»', paths: cp.roots.map((r) => r.single ? path.join(r.root, r.files[0].rel) : r.root), reason: 'auto-restore' }).id;
    const d = this.diff(id); let written = 0, removed = 0;
    if (files) for (const r of cp.roots) {
      for (const f of r.files) { const p = path.join(r.root, f.rel); const buf = this.getObject(f.sha); if (fs.existsSync(p) && sha(fs.readFileSync(p)) === f.sha) continue; fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, buf); try { fs.chmodSync(p, f.mode); } catch {} written++; }
      if (deleteNew && !r.single) for (const p of d.added) if (p.startsWith(r.root + path.sep)) { try { fs.unlinkSync(p); removed++; } catch {} }
    }
    return { ok: true, written, removed, settings: cp.settings, state: cp.state, safetyCheckpoint: before };
  }
  remove(id) { fs.unlinkSync(path.join(this.cpDir, this.get(id).id + '.json')); this.gc(); }
  prune() { const all = this.list(); for (const c of all.slice(this.maxCheckpoints)) fs.unlinkSync(path.join(this.cpDir, c.id + '.json')); if (all.length > this.maxCheckpoints) this.gc(); }
  gc() {
    const used = new Set(); for (const f of fs.readdirSync(this.cpDir)) { try { for (const r of JSON.parse(fs.readFileSync(path.join(this.cpDir, f), 'utf8')).roots) for (const x of r.files) used.add(x.sha); } catch {} }
    let n = 0; for (const d of fs.readdirSync(this.objDir)) for (const h of fs.readdirSync(path.join(this.objDir, d))) if (!used.has(h)) { fs.unlinkSync(path.join(this.objDir, d, h)); n++; }
    return n;
  }
}
module.exports = { TimeMachine, IGNORE };
