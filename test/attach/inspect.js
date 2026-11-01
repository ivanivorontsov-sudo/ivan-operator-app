const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => { const w = new BrowserWindow({ show: true, width: 1200, height: 850, webPreferences: { partition: 'iop-insp' + Date.now() } });
 await w.loadURL(process.env.U).catch(()=>{}); await new Promise(r=>setTimeout(r,8000));
 console.log('[X]', await w.webContents.executeJavaScript(`(()=>{const e=[...document.querySelectorAll('textarea,[contenteditable=true]')].filter(x=>x.getClientRects().length).pop();let f=e;for(let i=0;i<5&&f;i++)f=f.parentElement;return [...(f||document).querySelectorAll('button,[role=button]')].map(b=>b.outerHTML.slice(0,350)).join('\\n---\\n')})()`).catch(e=>e.message)); app.quit(); });
