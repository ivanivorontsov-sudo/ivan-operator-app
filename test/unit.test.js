'use strict';
const test = require('node:test');
const assert = require('node:assert');
const sizing = require('../app/sizing');
const { parseReply } = require('../app/parse');
const safety = require('../app/safety');
const android = require('../app/android');
const { classify } = require('../app/watchdog');

test('smart_resize кратен 28 и не больше лимита', () => {
  for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160], [1366, 768], [1280, 1024]]) {
    const r = sizing.smartResize(h, w);
    const W = r.width ?? r[1], H = r.height ?? r[0];
    assert.equal(W % 28, 0); assert.equal(H % 28, 0);
  }
});
test('координаты: туда и обратно (пиксели и 0..1000), несколько мониторов и DPI', () => {
  for (const mon of [{ x: 0, y: 0, width: 1920, height: 1080 }, { x: 1920, y: 0, width: 3840, height: 2160 }, { x: -1280, y: 200, width: 1280, height: 1024 }]) {
    for (const prof of ['qwen', 'anthropic', 'openai']) {
      const t = sizing.targetSize(prof, mon.width, mon.height);
      for (const coords of ['pixels', 'norm1000']) {
        const real = { x: mon.x + Math.round(mon.width * 0.37), y: mon.y + Math.round(mon.height * 0.81) };
        const m = sizing.screenToModel(real, t, mon, coords);
        const back = sizing.modelToScreen(m, t, mon, coords);
        const tol = coords === 'norm1000' ? mon.width / 1000 + 1 : mon.width / t.width + 1;
        assert.ok(Math.abs(back.x - real.x) <= tol && Math.abs(back.y - real.y) <= tol, `${prof}/${coords} ${JSON.stringify(real)}→${JSON.stringify(back)}`);
        assert.ok(back.x >= mon.x && back.x < mon.x + mon.width);
      }
    }
  }
});
test('разбор ответов модели', () => {
  assert.equal(parseReply('{"thought":"x","action":{"type":"click","x":10,"y":20}}').action.type, 'click');
  assert.equal(parseReply('```json\n{"action":{"type":"key","keys":"ctrl+l"}}\n```').action.keys, 'ctrl+l');
  assert.equal(parseReply('Думаю... {"type":"done","answer":"ok"} конец').action.type, 'done');
  assert.ok(parseReply('просто текст').error);
});
test('опасные команды требуют подтверждения', () => {
  for (const c of ['rm -rf /', 'rm -rf ~', 'sudo mkfs.ext4 /dev/sdb1', 'dd if=a of=/dev/sda', 'fastboot flash boot b.img', 'adb sideload x.zip', 'Format-Volume -DriveLetter D', 'diskpart', 'reboot']) assert.ok(safety.check(c), c);
  for (const c of ['ls -la', 'rm -rf ./build', 'npm install', 'git status', 'adb devices', 'fastboot devices', 'pip install --user requests']) assert.equal(safety.check(c), null, c);
  assert.ok(android.riskOf('fastboot', ['flash', 'boot', 'x.img']));
  assert.ok(android.riskOf('fastboot', ['oem', 'unlock']));
  assert.equal(android.riskOf('fastboot', ['getvar', 'all']), null);
  assert.equal(android.riskOf('adb', ['install', 'a.apk']), null);
});
test('сторож различает ошибки', () => {
  assert.equal(classify(Object.assign(new Error('x'), { status: 429 })), 'rate');
  assert.equal(classify(Object.assign(new Error('x'), { status: 503 })), 'server');
  assert.equal(classify(Object.assign(new Error('x'), { status: 401 })), 'auth');
  assert.equal(classify(new Error('fetch failed ECONNREFUSED')), 'network');
});

test('github без токена (мок) отказывает', async () => {
  const github = require('../app/github');
  const r = await github.run({ op: 'list_repos' }, { settings: {}, dataDir: require('os').tmpdir(), confirm: async () => false });
  assert.equal(r.ok, false);
});
test('пачка actions разбирается', () => {
  const r = parseReply('{"thought":"t","actions":[{"type":"click","x":1,"y":2},{"type":"type","text":"привет"}]}');
  assert.ok(r.actions && r.actions.length === 2);
  assert.equal(r.action.type, 'click');
  assert.equal(r.actions[1].type, 'type');
});
