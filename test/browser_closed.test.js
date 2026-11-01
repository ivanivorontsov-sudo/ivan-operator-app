const test = require('node:test'); const assert = require('node:assert');
const browser = require('../app/browser');
test('браузер, закрытый пользователем, не перезапускается сам; reset() снимает запрет', async () => {
  browser._setUserClosed(true);
  await assert.rejects(browser.ensure('/tmp'), (e) => e.code === 'BROWSER_CLOSED' && /закрыт вами/.test(e.message));
  await assert.rejects(browser.act({ type: 'browser_open', url: 'https://www.perplexity.ai/' }, '/tmp'), (e) => e.code === 'BROWSER_CLOSED');
  browser.reset();
  assert.strictEqual(browser._state().userClosed, false);
});
