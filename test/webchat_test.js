// Electron-тест провайдера веб-чата: мок (детерминированный) + гостевой сайт. Без логинов.
const { app } = require('electron'); const wc = require('../app/webchat');
const out = []; const log = (k, v) => { out.push({ k, v }); console.log('T', k, JSON.stringify(v).slice(0, 300)); };
const png = require('fs').readFileSync(process.env.IMG).toString('base64');
const M = (sys, txt, img) => [{ role: 'system', content: [{ type: 'text', text: sys }] }, { role: 'user', content: [{ type: 'text', text: txt }, ...(img ? [{ type: 'image', data: png }] : [])] }];
app.whenReady().then(async () => {
  try {
    wc.SITES.mock = { label: 'Mock', url: 'http://127.0.0.1:8765/mockchat.html', images: true };
    const r1 = await wc.chat({ webchat: 'mock', timeoutSec: 30 }, M('SYS', 'шаг 1', true)); log('mock_first', r1);
    const r2 = await wc.chat({ webchat: 'mock', timeoutSec: 30 }, [...M('SYS', 'x'), { role: 'assistant', content: [{ type: 'text', text: 'a' }] }, { role: 'user', content: [{ type: 'text', text: 'шаг 2' }] }]); log('mock_second', r2);
    log('login_flow', wc.openLogin('mock')); log('status', await wc.loggedIn('mock')); await wc.clearSession('mock'); log('cleared', true);
    log('code_extract', wc.lastCode('text\n```json\n{"a":1}\n```\nmore\n```json\n{"b":2}\n```'));
    for (const g of (process.env.GUEST || '').split(',').filter(Boolean)) {
      try { const r = await wc.chat({ webchat: g, timeoutSec: 90 }, M('Ты тестовый помощник.', 'Ответь только блоком ```json {"ok":1} ```')); log('guest_' + g, r); const w=wc.wins[g]; if(w) require('fs').writeFileSync('/tmp/wc_'+g+'.png',(await w.webContents.capturePage()).toPNG()); }
      catch (e) { log('guest_' + g + '_err', e.message); const w=wc.wins[g]; if(w) require('fs').writeFileSync('/tmp/wc_'+g+'.png',(await w.webContents.capturePage()).toPNG()); }
    }
  } catch (e) { log('fatal', e.stack); }
  require('fs').writeFileSync(process.env.OUT || '/tmp/webchat_test.json', JSON.stringify(out, null, 1)); wc.closeAll(); app.exit(0);
});
