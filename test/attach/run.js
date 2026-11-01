// electron test/attach/run.js — прогон attachImage на мок-страницах
const { app, BrowserWindow, nativeImage } = require('electron');
const pages = require('./pages'); const A = require('../../app/attach');
app.whenReady().then(async () => {
  const png = nativeImage.createFromBuffer(require('zlib') && Buffer.from(createPng(), 'base64'));
  const b64 = createPng(); const res = {};
  for (const [k, html] of Object.entries(pages).filter(([k]) => !process.env.ONLY || process.env.ONLY === k)) { console.log('[page]', k);
    const w = new BrowserWindow({ show: true, width: 800, height: 600, webPreferences: { sandbox: true } });
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(()=>{}); w.webContents.on('will-navigate', (e) => e.preventDefault());
    const t0 = Date.now(); const r = await A.attachImage(w, b64, { id: k, previewMs: 3000 });
    res[k] = { ok: r.ok, method: r.method, why: r.why, ms: Date.now() - t0 }; w.destroy();
  }
  // повтор «+»: должен использовать запомненную последовательность
  res.memory = A.memory;
  res.empty = await A.attachImage(null, '', {});
  console.log('[RESULT]', JSON.stringify(res)); app.quit();
});
function createPng() { const { BrowserWindow: _ , nativeImage: n } = require('electron'); const c = Buffer.alloc(64 * 48 * 4, 0x80); return n.createFromBitmap(c, { width: 64, height: 48 }).toPNG().toString('base64'); }
