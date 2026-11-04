// Замер скорости снимков/ввода (запуск: electron bench/bench.js под Xvfb)
const { app } = require('electron');
app.commandLine.appendSwitch('no-sandbox');
app.whenReady().then(async () => {
  const P = require('../app/platform'); const I = require('../app/imaging');
  const t = async (name, n, f) => { await f(); const t0 = process.hrtime.bigint(); for (let i = 0; i < n; i++) await f(); const ms = Number(process.hrtime.bigint() - t0) / 1e6 / n; console.log(`BENCH ${name}: ${ms.toFixed(2)} мс`); return ms; };
  const out = {};
  out.has = await t('has(xdotool)', 50, async () => P.has('xdotool'));
  let shot; out.shot = await t('screenshot', 5, async () => { shot = await P.screenshot(0); });
  out.prepare = await t('prepare 1280', 5, async () => I.prepare(shot.img, { width: 1280, height: 720, grid: true }));
  out.jpeg = await t('toJPEG(70)', 5, async () => shot.img.resize({ width: 1280 }).toJPEG(70));
  out.png = await t('toPNG', 5, async () => shot.img.resize({ width: 1280 }).toPNG());
  out.click = await t('mouse click', 10, async () => P.mouse('click', 100, 100));
  out.key = await t('key ctrl+a', 10, async () => P.key('ctrl+a'));
  out.type = await t('type 20 chars', 3, async () => P.typeText('Привет мир hello 123'));
  console.log('JSON ' + JSON.stringify(out)); app.quit();
}).catch((e) => { console.error(e); process.exit(1); });
