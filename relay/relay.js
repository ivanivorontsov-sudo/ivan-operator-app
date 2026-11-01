'use strict';
// Маленький ретранслятор ИванОператора (WebSocket). Запуск: node relay.js [порт]  (нужен пакет ws; за TLS — nginx/caddy или cloudflared).
// Агент подключается к /agent/<room>, клиенты — к /client/<room>. Содержимое зашифровано (AES-256-GCM ключом из токена) —
// ретранслятор только пересылает шифротекст и не знает токена. Комната = sha256 от токена.
const { WebSocketServer, WebSocket } = require('ws');
const port = Number(process.argv[2] || process.env.PORT || 8790);
const rooms = new Map(); // room -> { agent, clients:Set }
const fs = require('fs'); const path = require('path'); const http = require('http');
const page = [path.join(__dirname, 'index.html'), path.join(__dirname, '..', 'app', 'remote_ui', 'index.html')].find((f) => fs.existsSync(f));
const srv = http.createServer((req, res) => { if (page && /^\/(\?|$)/.test(req.url)) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(fs.readFileSync(page)); } res.writeHead(404); res.end(); });
const wss = new WebSocketServer({ server: srv, maxPayload: 2 * 1024 * 1024 });
srv.listen(port, process.env.HOST || '127.0.0.1');
wss.on('connection', (ws, req) => {
  const m = /^\/(agent|client)\/([0-9a-f]{32})$/.exec(req.url || '');
  if (!m) return ws.close(1008, 'bad path');
  const [, role, id] = m; const r = rooms.get(id) || { agent: null, clients: new Set() }; rooms.set(id, r);
  if (role === 'agent') { if (r.agent) r.agent.close(1000, 'replaced'); r.agent = ws; } else { if (r.clients.size >= 8) return ws.close(1008, 'room full'); r.clients.add(ws); }
  ws.on('message', (msg) => {
    let data; try { data = JSON.parse(msg).data; } catch { return; } if (typeof data !== 'string') return;
    const out = JSON.stringify({ data });
    if (role === 'agent') { for (const c of r.clients) if (c.readyState === WebSocket.OPEN) c.send(out); }
    else if (r.agent && r.agent.readyState === WebSocket.OPEN) r.agent.send(out);
  });
  ws.on('close', () => { if (role === 'agent' && r.agent === ws) r.agent = null; r.clients.delete(ws); if (!r.agent && !r.clients.size) rooms.delete(id); });
});
console.log('relay listening on', (process.env.HOST || '127.0.0.1') + ':' + port);
wss.httpServer = srv;
module.exports = wss;
