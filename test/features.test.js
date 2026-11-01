'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const domains = require('../app/domains');
const recipes = require('../app/recipes');
const sched = require('../app/scheduler');
const { Recorder } = require('../app/recorder');
const { Remote } = require('../app/remote');
const { WebSocket } = require('ws');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'iop-f-'));
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

test('домены: белый/чёрный список', () => {
  const L = { allowed: ['*.onlinetestpad.com', 'duck.ai'], blocked: [] };
  assert.equal(domains.checkUrl('https://onlinetestpad.com/x', L), null);
  assert.equal(domains.checkUrl('https://www.duck.ai/', L), null);
  assert.match(domains.checkUrl('https://evil.com/', L), /белый/);
  assert.match(domains.checkUrl('https://onlinetestpad.com.evil.com/', L), /белый/);
  assert.match(domains.checkUrl('file:///etc/passwd', L), /Протокол/);
  assert.match(domains.checkUrl('https://bad.com', { blocked: ['bad.com'] }), /чёрном/);
  assert.equal(domains.checkAction({ type: 'click', x: 1 }, L), null);
  assert.match(domains.checkAction({ type: 'browser_open', url: 'evil.com' }, L), /белый/);
});
test('рецепты: сохранение, подсказка, повтор и сбой', async () => {
  const d = tmp();
  assert.throws(() => recipes.save(d, 'x', 't', []));
  recipes.save(d, 'вход', 'войти на сайт', [{ type: 'browser_open', url: 'https://a' }, { type: 'browser_click', selector: '#b' }]);
  assert.match(recipes.hint(d), /вход/);
  const seen = []; let r = await recipes.replay(recipes.load(d)['вход'].actions, async (a) => { seen.push(a.type); return 'ok'; });
  assert.ok(r.ok); assert.deepEqual(seen, ['browser_open', 'browser_click']);
  r = await recipes.replay([{ type: 'a' }, { type: 'b' }], async (a) => a.type === 'b' ? 'ОШИБКА нет' : 'ok'); assert.equal(r.at, 1);
  recipes.remove(d, 'вход'); assert.deepEqual(recipes.load(d), {});
});
test('расписание: разбор и следующий запуск', () => {
  assert.deepEqual(sched.parse('каждые 30 мин'), { kind: 'every', ms: 1800e3 });
  assert.equal(sched.parse('каждые 0 мин'), null); assert.equal(sched.parse('ерунда'), null); assert.equal(sched.parse('ежедневно 25:00'), null);
  const n = sched.next(sched.parse('ежедневно 09:00'), new Date(2026, 0, 1, 10, 0)); assert.equal(n.getDate(), 2); assert.equal(n.getHours(), 9);
  const s = new sched.Scheduler(() => {}, () => false); const j = s.add('каждые 5 мин', 'проверь почту'); assert.equal(s.list().length, 1); s.remove(j.id); assert.equal(s.list().length, 0);
});
test('запись хода: HTML без внедрения разметки', () => {
  const d = tmp(); const r = new Recorder(d, '<script>x</script>');
  r.step(1, { thought: 'т', action: { type: 'click' }, result: 'ok', shot: Buffer.from('jpg').toString('base64') }); r.act({ type: 'click', x: 1 }, true); r.act({ type: 'screenshot' }, true);
  const f = r.finish('ok', 'готово'); const h = fs.readFileSync(f, 'utf8');
  assert.ok(!h.includes('<script>x')); assert.ok(h.includes('step1.jpg'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(f), 'actions.json'))).length, 1);
});

function mockCtl() { const log = []; return { log, run: (t) => { log.push('run:' + t); return { ok: true }; }, stop: () => log.push('stop'), pause: () => true, unpause: () => true, status: () => ({ running: false }), history: () => [{ role: 'user', text: 'привет' }], screen: async () => Buffer.from([0xff, 0xd8, 0xff]) }; }
const req = (port, p, { method = 'GET', token, body } = {}) => fetch(`https://127.0.0.1:${port}${p}`, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });

test('удалённый доступ: только 127.0.0.1, токен, TLS, API, WS, блокировка перебора', async () => {
  const d = tmp(); const ctl = mockCtl(); const r = new Remote(d, ctl);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const i = await r.start({ port });
  try {
    assert.equal(r.server.address().address, '127.0.0.1');
    assert.ok(i.token.length >= 30); assert.match(i.fingerprint, /:/);
    assert.equal((fs.statSync(path.join(d, 'remote.json')).mode & 0o077), 0);
    assert.equal((await req(port, '/')).status, 200);
    assert.equal((await req(port, '/api/status')).status, 401);
    assert.equal((await req(port, '/api/status', { token: 'x' + i.token.slice(1) })).status, 401);
    const st = await (await req(port, '/api/status', { token: i.token })).json(); assert.equal(st.ok, true);
    assert.equal((await req(port, '/api/task', { token: i.token })).status, 405);
    const t = await (await req(port, '/api/task', { method: 'POST', token: i.token, body: { text: 'открой блокнот' } })).json(); assert.ok(t.ok); assert.ok(ctl.log.includes('run:открой блокнот'));
    assert.equal((await req(port, '/api/screen.jpg', { token: i.token })).headers.get('content-type'), 'image/jpeg');
    // WS
    await assert.rejects(new Promise((ok, bad) => { const w = new WebSocket(`wss://127.0.0.1:${port}/ws?t=bad`); w.on('open', ok); w.on('error', bad); }));
    const ws = new WebSocket(`wss://127.0.0.1:${port}/ws?t=${encodeURIComponent(i.token)}`); await new Promise((ok) => ws.on('open', ok));
    const got = new Promise((ok) => ws.on('message', (m) => { const o = JSON.parse(m); if (o.event) ok(o); }));
    const ans = new Promise((ok) => ws.on('message', (m) => { const o = JSON.parse(m); if (o.id === 7) ok(o); }));
    ws.send(JSON.stringify({ id: 7, op: 'stop' })); assert.ok((await ans).ok); assert.ok(ctl.log.includes('stop'));
    r.broadcast({ kind: 'step', text: 'шаг', shot: 'BIG' }); const ev = await got; assert.equal(ev.event.shot, undefined);
    ws.close();
    // перебор: после 10 ошибок даже верный токен блокируется
    for (let k = 0; k < 10; k++) await req(port, '/api/status', { token: 'bad' });
    assert.equal((await req(port, '/api/status', { token: i.token })).status, 401);
  } finally { r.stop(); }
});
test('удалённый доступ: LAN только по явной галке', async () => {
  const r = new Remote(tmp(), mockCtl()); const port = 40001 + Math.floor(Math.random() * 9000);
  await r.start({ port, lan: true }); try { assert.equal(r.server.address().address, '0.0.0.0'); } finally { r.stop(); }
});
test('ретранслятор: сквозное шифрование, неверный токен не расшифрует', async () => {
  const port = 30000 + Math.floor(Math.random() * 9000);
  process.argv[2] = String(port); delete require.cache[require.resolve('../relay/relay.js')];
  const relay = require('../relay/relay.js');
  const ctl = mockCtl(); const r = new Remote(tmp(), ctl); r.st = require('../app/remote').loadState(r.dataDir);
  try {
    await new Promise((ok) => setTimeout(ok, 200));
    await r.connectRelay(`ws://127.0.0.1:${port}`);
    const c = new WebSocket(`ws://127.0.0.1:${port}/client/${r.room()}`); await new Promise((ok) => c.on('open', ok));
    const ans = new Promise((ok) => c.on('message', (m) => { const o = r.open(JSON.parse(m).data); if (o.id === 1) ok(o); }));
    c.send(JSON.stringify({ data: r.seal({ id: 1, op: 'task', text: 'через ретранслятор' }) }));
    assert.ok((await ans).ok); assert.ok(ctl.log.includes('run:через ретранслятор'));
    // чужой ключ
    const fake = Object.create(r); fake.st = { token: 'другой' };
    c.send(JSON.stringify({ data: fake.seal({ id: 2, op: 'stop' }) })); await new Promise((ok) => setTimeout(ok, 300));
    assert.ok(!ctl.log.includes('stop'));
    // плохой путь
    await new Promise((ok) => { const b = new WebSocket(`ws://127.0.0.1:${port}/x`); b.on('close', ok); b.on('error', ok); });
    c.close();
  } finally { r.stop(); relay.close(); relay.httpServer.close(); }
});

test('run_recipe распознаётся парсером', () => {
  const { normalizeAction } = require('../app/parse.js');
  assert.equal(normalizeAction({ type: 'run_recipe', name: 'mkfile' }).type, 'run_recipe');
  assert.equal(normalizeAction({ type: 'run_recipe', recipe: 'x' }).name, 'x');
});
