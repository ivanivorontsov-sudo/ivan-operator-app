// Калибровка: синтетический «экран» с кнопками в известных местах → модель называет координаты → ошибка в пикселях.
const { execFileSync } = require('child_process');
const fs = require('fs');
const providers = require('../app/providers');
const W = +process.env.W || 1260, H = +process.env.H || 784, coords = process.env.COORDS || 'pixels';
const T = [['Сохранить', 120, 90, 'blue'], ['Отмена', 1050, 700, 'gray'], ['Удалить', 640, 400, 'red'], ['Настройки', 980, 130, 'green'], ['Файл', 60, 20, 'black'], ['OK', 300, 600, 'orange'], ['Справка', 820, 520, 'purple'], ['Поиск', 450, 250, 'teal']];
const args = ['-size', `${W}x${H}`, 'xc:#f0f0f0', '-font', 'DejaVu-Sans', '-pointsize', '16'];
for (const [t, x, y, c] of T) args.push('-fill', c, '-draw', `rectangle ${x - 50},${y - 15} ${x + 50},${y + 15}`, '-fill', 'white', '-gravity', 'NorthWest', '-annotate', `+${x - 40}+${y - 10}`, t);
execFileSync('convert', [...args, '/tmp/calib.jpg']);
const data = fs.readFileSync('/tmp/calib.jpg').toString('base64');
(async () => {
  let hits = 0, errs = [];
  for (const [t, x, y] of T) {
    const q = `Изображение ${W}×${H} пикселей. Найди кнопку с надписью «${t}» и верни координаты её центра ` + (coords === 'pixels' ? 'в пикселях изображения' : 'в системе 0..1000') + ` строго JSON: {"x":..,"y":..}`;
    const r = await providers.chat({ provider: process.env.PROV || 'llamacpp', base: process.env.BASE || 'http://127.0.0.1:8080/v1', model: 'x', key: process.env.KEY || '', maxTokens: 60, temperature: 0, timeoutSec: 300 }, [{ role: 'user', content: [{ type: 'text', text: q }, { type: 'image', data }] }]);
    const m = /"x"\s*:\s*(\d+(?:\.\d+)?)[^\d]+(\d+(?:\.\d+)?)/.exec(r.text) || /(\d+)\D+(\d+)/.exec(r.text);
    let px = m ? +m[1] : NaN, py = m ? +m[2] : NaN;
    if (coords === 'norm1000') { px = px / 1000 * W; py = py / 1000 * H; }
    const e = Math.hypot(px - x, py - y), hit = Math.abs(px - x) <= 50 && Math.abs(py - y) <= 15;
    hits += hit; errs.push(e);
    console.log(t, 'истина', x, y, '→', Math.round(px), Math.round(py), 'ошибка', Math.round(e), hit ? 'ПОПАЛ' : 'мимо', '|', r.text.trim().slice(0, 60));
  }
  console.log(`ИТОГ: попаданий ${hits}/${T.length}, медиана ошибки ${Math.round(errs.sort((a, b) => a - b)[errs.length >> 1])} px`);
})();
