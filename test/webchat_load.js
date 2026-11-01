const { app } = require('electron'); const wc = require('../app/webchat'); const fs = require('fs');
const CAP = fs.readFileSync(__dirname + '/../app/webchat_capture.js', 'utf8'); const out = {};
app.whenReady().then(async () => {
  for (const id of Object.keys(wc.SITES).filter((k) => k !== 'custom')) {
    try { wc.openLogin(id); const w = wc.wins[id]; w.hide();
      await new Promise((r) => { const t = setTimeout(r, 30000); w.webContents.once('did-finish-load', () => { clearTimeout(t); r(); }); w.webContents.once('did-fail-load', (_e, c, d) => { out[id] = { fail: d }; clearTimeout(t); r(); }); });
      await new Promise((r) => setTimeout(r, 6000)); await w.webContents.executeJavaScript(CAP);
      const m = JSON.parse(await w.webContents.executeJavaScript('window.__pp.mark("x")'));
      const st = await wc.loggedIn(id); out[id] = { ...out[id], loaded: true, title: st.title, url: st.url, site: m.site, editor: m.editor };
      fs.writeFileSync('/tmp/wcl_' + id + '.png', (await w.webContents.capturePage()).toPNG());
    } catch (e) { out[id] = { err: e.message }; }
    console.log('L', id, JSON.stringify(out[id]));
  }
  fs.writeFileSync(__dirname + '/webchat_load_result.json', JSON.stringify(out, null, 1)); wc.closeAll(); app.exit(0);
});
