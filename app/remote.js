'use strict';
// Удалённый доступ к ИванОператору: встроенный веб-интерфейс + API + WebSocket.
// По умолчанию ВЫКЛЮЧЕН. Включённый слушает только 127.0.0.1; LAN (0.0.0.0) — отдельной галкой.
// Защита: случайный токен сопряжения (32 байта), самоподписанный TLS, сравнение токена за постоянное время,
// блокировка IP после 10 неверных попыток, лимит размера запросов.
// Интернет: cloudflared/tailscale (запускает сам Иван) или маленький ретранслятор relay/relay.js.
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const UI = path.join(__dirname, 'remote_ui', 'index.html');
function loadState(dir) {
  const f = path.join(dir, 'remote.json');
  let st = {}; try { st = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  if (!st.token) st.token = crypto.randomBytes(24).toString('base64url');
  if (!st.cert || !st.key) {
    const pems = require('selfsigned').generate([{ name: 'commonName', value: 'ivanoperator.local' }], { days: 3650, keySize: 2048, algorithm: 'sha256',
      extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] }] });
    st.cert = pems.cert; st.key = pems.private;
  }
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, JSON.stringify(st), { mode: 0o600 });
  st.fingerprint = new crypto.X509Certificate(st.cert).fingerprint256;
  return st;
}
function resetToken(dir) { const f = path.join(dir, 'remote.json'); let st = {}; try { st = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {} st.token = crypto.randomBytes(24).toString('base64url'); fs.writeFileSync(f, JSON.stringify(st), { mode: 0o600 }); return st.token; }
const same = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && crypto.timingSafeEqual(x, y); };

class Remote {
  // ctl: { run(text), stop(), pause(), unpause(), status(), history(), screen() → Promise<Buffer jpeg> }
  constructor(dataDir, ctl) { this.dataDir = dataDir; this.ctl = ctl; this.server = null; this.clients = new Set(); this.fails = new Map(); this.relay = null; }
  authOk(ip, tok) {
    const f = this.fails.get(ip) || { n: 0, until: 0 };
    if (f.until > Date.now()) return false;
    if (same(tok, this.st.token)) { this.fails.delete(ip); return true; }
    f.n++; if (f.n >= 10) { f.until = Date.now() + 10 * 60e3; f.n = 0; } this.fails.set(ip, f); return false;
  }
  async handle(cmd) { // общий обработчик для HTTP, WS и ретранслятора
    const c = this.ctl;
    switch (cmd && cmd.op) {
      case 'status': return { ok: true, ...c.status() };
      case 'history': return { ok: true, history: c.history().slice(-100) };
      case 'task': if (!String(cmd.text || '').trim()) return { ok: false, error: 'пустая задача' }; return c.run(String(cmd.text).slice(0, 8000));
      case 'stop': c.stop(); return { ok: true };
      case 'pause': return { ok: c.pause() };
      case 'resume': return { ok: c.unpause() };
      case 'screen': return { ok: true, jpeg: (await c.screen()).toString('base64') };
      default: return { ok: false, error: 'неизвестная команда' };
    }
  }
  start({ port = 8787, lan = false } = {}) {
    if (this.server) return this.info();
    this.st = loadState(this.dataDir); this.port = port; this.lan = !!lan;
    const srv = https.createServer({ cert: this.st.cert, key: this.st.key }, (req, res) => this.http(req, res).catch((e) => { try { res.writeHead(500); res.end(JSON.stringify({ ok: false, error: String(e.message) })); } catch {} }));
    const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
    srv.on('upgrade', (req, sock, head) => {
      const u = new URL(req.url, 'https://x');
      if (u.pathname !== '/ws' || !this.authOk(req.socket.remoteAddress, u.searchParams.get('t') || req.headers['sec-websocket-protocol'])) { sock.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return sock.destroy(); }
      wss.handleUpgrade(req, sock, head, (ws) => {
        this.clients.add(ws); ws.on('close', () => this.clients.delete(ws));
        ws.on('message', async (m) => { let q; try { q = JSON.parse(m); } catch { return; } const r = await this.handle(q).catch((e) => ({ ok: false, error: String(e.message) })); ws.send(JSON.stringify({ id: q.id, ...r })); });
      });
    });
    srv.listen(port, lan ? '0.0.0.0' : '127.0.0.1');
    this.server = srv; this.wss = wss;
    return new Promise((ok, bad) => { srv.once('listening', () => ok(this.info())); srv.once('error', (e) => { this.server = null; bad(e); }); });
  }
  async http(req, res) {
    const u = new URL(req.url, 'https://x');
    const sec = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; connect-src 'self' wss:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'" };
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) { res.writeHead(200, { ...sec, 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(UI)); }
    if (!u.pathname.startsWith('/api/')) { res.writeHead(404, sec); return res.end(); }
    const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!this.authOk(req.socket.remoteAddress, tok)) { res.writeHead(401, sec); return res.end('{"ok":false,"error":"нужен токен"}'); }
    let body = {};
    if (req.method === 'POST') { const chunks = []; let n = 0; for await (const ch of req) { n += ch.length; if (n > 64 * 1024) { res.writeHead(413, sec); return res.end(); } chunks.push(ch); } try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { body = {}; } }
    const op = u.pathname.slice(5);
    if (op === 'screen.jpg') { const j = await this.ctl.screen(); res.writeHead(200, { ...sec, 'Content-Type': 'image/jpeg' }); return res.end(j); }
    if (req.method !== 'POST' && !['status', 'history'].includes(op)) { res.writeHead(405, sec); return res.end(); }
    const r = await this.handle({ ...body, op });
    res.writeHead(r.ok === false ? 400 : 200, { ...sec, 'Content-Type': 'application/json' }); res.end(JSON.stringify(r));
  }
  broadcast(ev) {
    const msg = JSON.stringify({ event: { ...ev, shot: undefined } });
    for (const ws of this.clients) if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    if (this.relay && this.relay.readyState === WebSocket.OPEN) this.relay.send(JSON.stringify({ to: 'clients', data: this.seal({ event: { ...ev, shot: undefined } }) }));
  }
  // --- ретранслятор: сообщения шифруются AES-256-GCM ключом из токена, ретранслятор видит только шифротекст ---
  key() { return crypto.createHash('sha256').update('iop-relay:' + this.st.token).digest(); }
  room() { return crypto.createHash('sha256').update('iop-room:' + this.st.token).digest('hex').slice(0, 32); }
  seal(obj) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', this.key(), iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'); }
  open(b64) { const b = Buffer.from(b64, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', this.key(), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString()); }
  connectRelay(url) {
    if (!this.st) this.st = loadState(this.dataDir);
    if (!/^wss?:\/\//.test(url)) throw new Error('адрес ретранслятора должен начинаться с wss://');
    const ws = new WebSocket(url.replace(/\/$/, '') + '/agent/' + this.room(), { rejectUnauthorized: !/^wss:\/\/(localhost|127\.)/.test(url) });
    ws.on('message', async (m) => { try { const { data } = JSON.parse(m); const q = this.open(data); const r = await this.handle(q); ws.send(JSON.stringify({ to: 'clients', data: this.seal({ id: q.id, ...r }) })); } catch {} });
    ws.on('close', () => { if (this.relay === ws) this.relay = null; });
    this.relay = ws; return new Promise((ok, bad) => { ws.once('open', () => ok(true)); ws.once('error', bad); });
  }
  info() { return { running: !!this.server, port: this.port, lan: this.lan, token: this.st && this.st.token, fingerprint: this.st && this.st.fingerprint, relay: !!this.relay, room: this.st && this.room() }; }
  stop() { if (this.relay) { try { this.relay.close(); } catch {} this.relay = null; } for (const c of this.clients) try { c.terminate(); } catch {} this.clients.clear(); if (this.server) { this.server.close(); this.server = null; } return true; }
}
module.exports = { Remote, loadState, resetToken };
