const test = require('node:test'); const assert = require('node:assert');
const browser = require('../app/browser');
test('после Стоп браузер не запускается до новой задачи', async () => {
  browser.reset(); await browser.stopAll();
  assert.strictEqual(browser._stopped(), true);
  await assert.rejects(browser.ensure('/tmp/iop-stop-test'), (e) => e.code === 'BROWSER_CLOSED' && e.stopped);
  await assert.rejects(browser.act({ type: 'browser_open', url: 'https://example.com' }, '/tmp/iop-stop-test'));
  browser.reset(); assert.strictEqual(browser._stopped(), false);
});
test('Agent.stop вызывает browser.stopAll', () => {
  const { Agent } = require('../app/agent');
  browser.reset(); const a = Object.create(Agent.prototype); a.ctl = new AbortController();
  a.stop(); assert.ok(a.ctl.signal.aborted); assert.strictEqual(browser._stopped(), true); browser.reset();
});
