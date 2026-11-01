// Реальная проверка без входа: Алиса (прикрепить синтетическую картинку и спросить), GigaChat (только анализ DOM)
const { app, BrowserWindow, session } = require('electron');
const A = require('../../app/attach');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const site = process.env.SITE || 'alice'; const url = site === 'alice' ? 'https://alice.yandex.ru/' : 'https://giga.chat/';
  const w = new BrowserWindow({ show: process.env.HIDE ? false : true, width: 1200, height: 850, webPreferences: { partition: 'iop-test-' + site + Date.now(), sandbox: true } });
  await w.loadURL(url).catch((e) => console.log('load', e.message)); await sleep(8000);
  const dom = await w.webContents.executeJavaScript(`(()=>({url:location.href,title:document.title,inputs:[...document.querySelectorAll('input[type=file]')].map(i=>i.accept),editors:[...document.querySelectorAll('textarea,[contenteditable=true]')].filter(e=>e.getClientRects().length).length,login:[...document.querySelectorAll('button,a')].filter(b=>b.getClientRects().length&&/войти|вход|login|sign/i.test(b.innerText||'')).map(b=>b.innerText.trim()).slice(0,3)}))()`).catch((e) => ({ err: e.message }));
  console.log('[DOM]', JSON.stringify(dom));
  console.log('[CLIPS]', JSON.stringify(await w.webContents.executeJavaScript(A.CLIPS_JS).catch((e) => e.message)));
  await w.webContents.capturePage().then((i) => require('fs').writeFileSync(`/tmp/iop-real-${site}-0.png`, i.toPNG()));
  if (site === 'alice') {
    // синтетическая картинка: крупное число 4827
    const img = await new Promise((res) => { const c = new BrowserWindow({ show: false, width: 400, height: 200 }); c.loadURL('data:text/html,<body style="margin:0;background:white"><h1 style="font:bold 120px sans-serif;margin:20px">4827</h1>').then(async () => { await sleep(500); res((await c.capturePage()).toPNG().toString('base64')); c.destroy(); }); });
    const r = await A.attachImage(w, img, { id: 'alice', previewMs: 15000 });
    console.log('[ATTACH]', JSON.stringify(r));
    await w.webContents.capturePage().then((i) => require('fs').writeFileSync('/tmp/iop-real-alice-1.png', i.toPNG()));
    if (r.ok && process.env.ASK) {
      await w.webContents.executeJavaScript(`(()=>{const e=[...document.querySelectorAll('textarea,[contenteditable=true]')].filter(x=>x.getClientRects().length).pop();e.focus();return 1})()`);
      w.webContents.insertText('Какое число на картинке? Ответь только числом.'); await sleep(500);
      for (const type of ['keyDown', 'char', 'keyUp']) w.webContents.sendInputEvent({ type, keyCode: 'Return' });
      await sleep(25000);
      const t = await w.webContents.executeJavaScript('document.body.innerText').catch(() => '');
      console.log('[REPLY]', /4827/.test(t.split('Какое число')[1] || '') ? 'нашёл 4827 в ответе' : 'нет 4827', JSON.stringify((t.split('Какое число')[1] || '').slice(0, 300)));
      await w.webContents.capturePage().then((i) => require('fs').writeFileSync('/tmp/iop-real-alice-2.png', i.toPNG()));
    }
  }
  app.quit();
});
