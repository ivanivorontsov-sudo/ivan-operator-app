const { app, BrowserWindow } = require('electron'); const { FIND_JS } = require(process.env.WC);
app.whenReady().then(async () => { const w = new BrowserWindow({ show: false, width: 1000, height: 800 });
 const pages = {
  a: '<body><div style="height:600px"></div><div contenteditable="true" aria-label="Напишите сообщение" style="width:600px;height:40px"></div></body>',
  b: '<body><input type="search" placeholder="Search chats"><div style="height:500px"></div><div class="x"><p data-placeholder="Ask anything"></p><div contenteditable="true" id="r1" style="width:700px;height:40px">\u200b</div></div></body>',
  c: '<body><div style="height:700px"></div><input placeholder="??" style="width:800px;position:fixed;bottom:5px;left:50px"></body>' };
 for (const [k, h] of Object.entries(pages)) { await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(h)); console.log('R', k, JSON.stringify(await w.webContents.executeJavaScript(FIND_JS('')))); }
 await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(pages.a)); console.log('R cache', JSON.stringify(await w.webContents.executeJavaScript(FIND_JS('div[aria-label="Напишите сообщение"]'))));
 app.exit(0); });
