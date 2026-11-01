'use strict';
// Сторож: 429 → 500 → обрыв соединения → успех; и переключение на запасной при «мёртвом» основном
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { robustChat } = require('../app/watchdog');

test('повторы при 429/500/обрыве', async () => {
  let n = 0;
  const srv = http.createServer((req, res) => {
    n++;
    if (n === 1) { res.writeHead(429, { 'retry-after': '1' }); return res.end('{"error":"rate"}'); }
    if (n === 2) { res.writeHead(500); return res.end('{"error":"boom"}'); }
    if (n === 3) { return req.socket.destroy(); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '{"action":{"type":"done"}}' } }] }));
  }).listen(0);
  const port = srv.address().port;
  const ev = [];
  const r = await robustChat({ provider: 'custom', base: `http://127.0.0.1:${port}/v1`, model: 'm', timeoutSec: 10, maxTokens: 50 }, [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], { emit: (e) => ev.push(e.text), tries: 5 });
  srv.close();
  assert.match(r.text, /done/); assert.equal(n, 4);
  console.log(ev.join('\n'));
});
test('ошибка ключа — без повторов', async () => {
  let n = 0;
  const srv = http.createServer((req, res) => { n++; res.writeHead(401); res.end('{"error":"bad key"}'); }).listen(0);
  await assert.rejects(robustChat({ provider: 'custom', base: `http://127.0.0.1:${srv.address().port}/v1`, model: 'm', timeoutSec: 5 }, [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], { tries: 4 }), (e) => e.kind === 'auth');
  srv.close(); assert.equal(n, 1);
});
