'use strict';
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { Autonomy, cleanSettings } = require('../app/auto');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'iop130i-'));
const fakeAgent = (answer) => { const ev = []; return { ev, emit: (e) => ev.push(e), confirm: async () => answer, chat: async () => ({ text: '{}' }), ctl: new AbortController(), execute: async (a) => 'ok ' + a.type }; };

test('интеграция: checkpoint/os/audit/run_skill через Autonomy.execute', async () => {
  const d = tmp(); const proj = path.join(d, 'proj'); fs.mkdirSync(proj); fs.writeFileSync(path.join(proj, 'a.txt'), '1');
  const A = new Autonomy(path.join(d, 'data')); const ag = fakeAgent(true); const s = { projectDirs: [proj], key: 'SECRET', fallbacks: [{ key: 'S2' }] };
  const r = await A.execute(ag, { type: 'checkpoint', label: 'x' }, s); assert.match(r, /Контрольная точка/);
  const cp = A.tm.get(A.tm.list()[0].id); assert.ok(!JSON.stringify(cp).includes('SECRET') && !JSON.stringify(cp).includes('S2'), 'ключи не попадают в точку');
  const o = await A.execute(ag, { type: 'os', intent: 'list_dir', args: { path: proj } }, s); assert.match(o, /a\.txt/);
  assert.strictEqual(await A.execute(ag, { type: 'click' }, s), undefined);
  const au = await A.execute(ag, { type: 'audit', dir: proj }, s); assert.match(au, /Аудит/);
  A.skills.fromTask('открой https://example.com', [{ type: 'browser_open', url: 'https://example.com' }, { type: 'browser_click', selector: '#a' }], { name: 'тест' });
  const rs = await A.execute(ag, { type: 'run_skill', name: 'тест', params: { url: 'https://example.org' } }, s); assert.match(rs, /выполнен/);
  assert.deepStrictEqual(cleanSettings({ key: 1, a: 2 }), { a: 2 });
});
test('интеграция: опасное действие без подтверждения — отказ и авто-точка', async () => {
  const d = tmp(); const proj = path.join(d, 'p'); fs.mkdirSync(proj); fs.writeFileSync(path.join(proj, 'f'), 'x');
  const A = new Autonomy(path.join(d, 'data')); const ag = fakeAgent(false);
  const r = await A.execute(ag, { type: 'os', intent: 'remove_dir', args: { path: proj } }, { projectDirs: [proj] });
  assert.match(r, /ЗАПРЕТИЛ/); assert.ok(fs.existsSync(path.join(proj, 'f'))); assert.ok(A.tm.list().length >= 1);
});
test('интеграция: run_tests — предел попыток', async () => {
  const d = tmp(); const proj = path.join(d, 'p'); fs.mkdirSync(proj);
  const A = new Autonomy(path.join(d, 'data')); A.startTask(); const ag = fakeAgent(true); const s = { projectDirs: [proj], testMaxIter: 1, riskConfirmThreshold: 101 };
  for (let i = 0; i < 2; i++) assert.match(await A.execute(ag, { type: 'run_tests', dir: proj, command: 'node -e "process.exit(1)"' }, s), /НЕ прошли/);
  assert.match(await A.execute(ag, { type: 'run_tests', dir: proj, command: 'true' }, s), /предел/);
});
