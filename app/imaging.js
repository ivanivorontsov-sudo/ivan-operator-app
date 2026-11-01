'use strict';
// Обработка снимков без внешних библиотек: масштаб, обрезка, сетка, метки, курсор, сравнение кадров.
const { nativeImage } = require('electron');

// Шрифт 5x7 для цифр и нескольких букв
const FONT = {
  '0': ['01110','10001','10011','10101','11001','10001','01110'], '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00010','00100','01000','11111'], '3': ['11110','00001','00001','01110','00001','00001','11110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'], '5': ['11111','10000','11110','00001','00001','10001','01110'],
  '6': ['00110','01000','10000','11110','10001','10001','01110'], '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'], '9': ['01110','10001','10001','01111','00001','00010','01100'],
  ',': ['00000','00000','00000','00000','00110','00100','01000'], 'x': ['00000','00000','10001','01010','00100','01010','10001'], 'y': ['00000','10001','10001','01111','00001','10001','01110'],
};

class Canvas {
  constructor(img) { const s = img.getSize(); this.w = s.width; this.h = s.height; this.buf = Buffer.from(img.toBitmap()); }
  px(x, y, [r, g, b], a = 1) {
    x |= 0; y |= 0; if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4; // BGRA
    this.buf[i] = this.buf[i] * (1 - a) + b * a; this.buf[i + 1] = this.buf[i + 1] * (1 - a) + g * a; this.buf[i + 2] = this.buf[i + 2] * (1 - a) + r * a; this.buf[i + 3] = 255;
  }
  rect(x, y, w, h, c, a = 1) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.px(i, j, c, a); }
  frame(x, y, w, h, c, t = 2) { this.rect(x, y, w, t, c); this.rect(x, y + h - t, w, t, c); this.rect(x, y, t, h, c); this.rect(x + w - t, y, t, h, c); }
  text(x, y, s, c, scale = 2, bg = null) {
    const W = s.length * 6 * scale + scale, H = 9 * scale;
    if (bg) this.rect(x - scale, y - scale, W + scale, H, bg, 0.85);
    for (let k = 0; k < s.length; k++) { const g = FONT[s[k]]; if (!g) continue;
      for (let r = 0; r < 7; r++) for (let q = 0; q < 5; q++) if (g[r][q] === '1') this.rect(x + (k * 6 + q) * scale, y + r * scale, scale, scale, c); }
  }
  cross(x, y, c, size = 14) {
    this.rect(x - size, y - 1, size * 2 + 1, 3, [0, 0, 0], 0.6); this.rect(x - 1, y - size, 3, size * 2 + 1, [0, 0, 0], 0.6);
    this.rect(x - size, y, size * 2 + 1, 1, c); this.rect(x, y - size, 1, size * 2 + 1, c);
    this.frame(x - 5, y - 5, 11, 11, c, 1);
  }
  toImage() { return nativeImage.createFromBitmap(this.buf, { width: this.w, height: this.h }); }
}

// Подготовить снимок для модели
// opts: { width, height, grid: bool, gridStep (в пикселях модели), marks: [{id,x,y,w,h}] в пикселях модели, cursor: {x,y} в пикселях модели, coordMode }
function prepare(img, opts) {
  let out = img.resize({ width: opts.width, height: opts.height, quality: 'best' });
  if (opts.grid || (opts.marks && opts.marks.length) || opts.cursor) {
    const c = new Canvas(out);
    if (opts.grid) {
      const n = opts.coordMode === 'norm1000';
      const step = opts.gridStep || (n ? 100 : 100);
      const sx = n ? c.w / 1000 : 1, sy = n ? c.h / 1000 : 1;
      for (let v = step; v < (n ? 1000 : c.w); v += step) { const X = Math.round(v * sx); for (let y = 0; y < c.h; y++) c.px(X, y, [255, 0, 255], 0.35); c.text(X + 2, 2, String(v), [255, 255, 255], 1, [120, 0, 120]); }
      for (let v = step; v < (n ? 1000 : c.h); v += step) { const Y = Math.round(v * sy); for (let x = 0; x < c.w; x++) c.px(x, Y, [255, 0, 255], 0.35); c.text(2, Y + 2, String(v), [255, 255, 255], 1, [120, 0, 120]); }
    }
    for (const m of opts.marks || []) {
      c.frame(m.x, m.y, m.w, m.h, [255, 40, 40], 1);
      c.text(m.x + 1, Math.max(0, m.y - 1), String(m.id), [255, 255, 255], 1, [200, 0, 0]);
    }
    if (opts.cursor) c.cross(opts.cursor.x, opts.cursor.y, [0, 255, 80]);
    out = c.toImage();
  }
  return out;
}

// Увеличенный фрагмент вокруг точки (в физических пикселях снимка) с перекрестием
function zoom(img, cx, cy, boxW, boxH, outW, outH, markPoint = true) {
  const s = img.getSize();
  boxW = Math.min(boxW, s.width); boxH = Math.min(boxH, s.height);
  const x0 = Math.max(0, Math.min(s.width - boxW, Math.round(cx - boxW / 2)));
  const y0 = Math.max(0, Math.min(s.height - boxH, Math.round(cy - boxH / 2)));
  let out = img.crop({ x: x0, y: y0, width: boxW, height: boxH }).resize({ width: outW, height: outH, quality: 'best' });
  if (markPoint) { const c = new Canvas(out); c.cross(Math.round((cx - x0) * outW / boxW), Math.round((cy - y0) * outH / boxH), [0, 255, 80], 20); out = c.toImage(); }
  return { img: out, x0, y0, boxW, boxH };
}

// Сигнатура кадра для сравнения «изменился ли экран»
function signature(img) {
  const t = img.resize({ width: 96, height: 60, quality: 'good' });
  const b = t.toBitmap(); const sig = new Uint8Array(96 * 60);
  for (let i = 0; i < sig.length; i++) sig[i] = (b[i * 4] + b[i * 4 + 1] * 2 + b[i * 4 + 2]) >> 2;
  return sig;
}
function diffRatio(a, b) {
  if (!a || !b || a.length !== b.length) return 1;
  let n = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 10) n++;
  return n / a.length;
}
function toDataUrl(img, quality = 80) { return 'data:image/jpeg;base64,' + img.toJPEG(quality).toString('base64'); }

module.exports = { prepare, zoom, signature, diffRatio, toDataUrl, Canvas };
