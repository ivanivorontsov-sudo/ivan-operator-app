// Тестовое окно-мишень: ярко-зелёная кнопка в известном месте; клик пишется в файл с экранными координатами
const { app, BrowserWindow, ipcMain } = require('electron'); const fs = require('fs');
const X = +process.env.TX || 1300, Y = +process.env.TY || 700, OUT = process.env.HIT_FILE || '/tmp/iop-e2e-hit.json';
app.whenReady().then(() => {
  const w = new BrowserWindow({ x: X, y: Y, width: 260, height: 160, frame: false, alwaysOnTop: true, webPreferences: { nodeIntegration: true, contextIsolation: false } });
  w.loadURL('data:text/html,' + encodeURIComponent(`<body style="margin:0;background:#222"><button id=b style="position:absolute;left:30px;top:30px;width:200px;height:100px;background:rgb(0,220,0);border:0">TARGET</button><script>const {ipcRenderer}=require('electron');document.onmousedown=e=>ipcRenderer.send('hit',{onTarget:e.target.id==='b',sx:e.screenX,sy:e.screenY,key:''});document.onkeydown=e=>ipcRenderer.send('hit',{key:e.key});</script>`));
  ipcMain.on('hit', (_e, h) => { let a = []; try { a = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {} a.push(h); fs.writeFileSync(OUT, JSON.stringify(a)); });
});
