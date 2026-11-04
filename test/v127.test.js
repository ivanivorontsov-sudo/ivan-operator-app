'use strict';
const test = require('node:test'); const assert = require('node:assert');
const X = require('../app/auto/extra'); const P = require('../app/parse');
const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 10) n++; return n / a.length; };

test('голосование: большинство и усреднение координат, не-GUI отбрасываются', () => {
  const v = X.voteActions([{ type: 'click', x: 100, y: 200 }, { type: 'click', x: 110, y: 205 }, { type: 'click', x: 600, y: 50 }, { type: 'run', command: 'rm -rf /' }, null], { width: 1000, height: 800 });
  assert.strictEqual(v.ranked[0].votes, 2); assert.deepStrictEqual([v.ranked[0].action.x, v.ranked[0].action.y], [105, 203]); assert.strictEqual(v.valid, 3); assert.strictEqual(v.total, 5);
  assert.ok(!v.ranked.some((c) => c.action.type === 'run'));
  assert.strictEqual(X.voteActions([{ type: 'type', text: 'Привет' }, { type: 'type', text: 'привет ' }]).ranked[0].votes, 2);
  assert.strictEqual(P.normalizeAction({ type: 'screen_vote', goal: 'x' }).type, 'screen_vote');
});
test('визуальный анализ: модальное окно и загрузка', () => {
  const modal = new Uint8Array(96 * 60).fill(30); for (let y = 15; y < 45; y++) for (let x = 25; x < 71; x++) modal[y * 96 + x] = 230;
  assert.strictEqual(X.analyzeFrames([modal], { diffRatio: diff }).verdict, 'modal');
  const base = Uint8Array.from({ length: 5760 }, (_, i) => (i * 7) % 200); const f = (k) => { const a = base.slice(); for (let i = 0; i < 20; i++) a[i + k] = 255 - a[i + k]; return a; };
  assert.strictEqual(X.analyzeFrames([f(0), f(30), f(60)], { diffRatio: diff }).verdict, 'busy');
});
test('ИИ-анализ снимка разбирает JSON-ответ', async () => {
  let sent; const r = await X.analyzeWithAI(async (m) => { sent = m; return { text: 'вот: {"verdict":"modal","problems":["окно cookies"],"next":"нажать Принять"}' }; }, 'QUJD', { ru: 'ок' }, 'войти');
  assert.strictEqual(r.verdict, 'modal'); assert.deepStrictEqual(r.problems, ['окно cookies']); assert.strictEqual(sent[0].content[1].type, 'image');
});
test('screen_vote: выключенный автовыбор — только выбранная нейросеть, лучший вариант выполняется, при отсутствии изменений — второй', async () => {
  const { Autonomy } = require('../app/auto'); const A = new Autonomy(require('fs').mkdtempSync(require('os').tmpdir() + '/iop127-'));
  const used = new Set(); let k = 0; const answers = ['{"type":"click","x":10,"y":10}', '{"type":"click","x":12,"y":11}', '{"type":"click","x":500,"y":300}'];
  const executed = [];
  const agent = { _chain: [{ provider: 'webchat', webchat: 'a' }, { provider: 'webchat', webchat: 'b' }], provId: (c) => c.webchat, chat: async (c) => { used.add(c.webchat); return { text: answers[k++ % 3] }; }, execute: async (a) => { executed.push(a); return 'ok'; } };
  const plat = require('../app/platform'); const img = require('../app/imaging'); const o1 = plat.screenshot, o2 = img.signature, o3 = plat.sleep;
  plat.screenshot = async () => ({ img: {} }); img.signature = () => new Uint8Array(10); plat.sleep = async () => {};
  try {
    const r = await A.screenVote(agent, { goal: 'нажать', n: 3 }, { webchat: 'a', autoModelSwitch: false }, { data: 'x', tsize: { width: 1000, height: 800 }, sig: new Uint8Array(10) }, {}, {}, () => {});
    assert.deepStrictEqual([...used], ['a']); assert.strictEqual(executed.length, 2); assert.deepStrictEqual([executed[0].x, executed[0].y], [11, 11]); assert.match(r, /голосов 2\/3/);
  } finally { plat.screenshot = o1; img.signature = o2; plat.sleep = o3; }
});
