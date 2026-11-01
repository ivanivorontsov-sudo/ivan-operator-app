'use strict';
// Размер снимка под модель и перевод координат (чистые функции, покрыты тестами).

// Qwen2.5-VL: стороны кратны 28, площадь в [min,max] пикселей (как qwen_vl_utils.smart_resize)
function smartResize(h, w, factor = 28, minPixels = 56 * 56, maxPixels = 1280 * 28 * 28) {
  let hb = Math.max(factor, Math.round(h / factor) * factor);
  let wb = Math.max(factor, Math.round(w / factor) * factor);
  if (hb * wb > maxPixels) {
    const beta = Math.sqrt((h * w) / maxPixels);
    hb = Math.max(factor, Math.floor(h / beta / factor) * factor);
    wb = Math.max(factor, Math.floor(w / beta / factor) * factor);
  } else if (hb * wb < minPixels) {
    const beta = Math.sqrt(minPixels / (h * w));
    hb = Math.ceil((h * beta) / factor) * factor;
    wb = Math.ceil((w * beta) / factor) * factor;
  }
  return { width: wb, height: hb };
}

function fitBox(w, h, maxLong, maxPixels) {
  let s = Math.min(1, maxLong / Math.max(w, h), Math.sqrt(maxPixels / (w * h)));
  return { width: Math.max(1, Math.floor(w * s)), height: Math.max(1, Math.floor(h * s)) };
}

// Профили размера снимка
const PROFILES = {
  qwen: { label: 'Qwen2.5-VL (кратно 28, ≈1 Мпикс)', fn: (w, h) => smartResize(h, w) },
  qwen3: { label: 'Qwen3-VL (кратно 32, ≈1,3 Мпикс, координаты 0..1000)', fn: (w, h) => smartResize(h, w, 32, 64 * 64, 1280 * 32 * 32) },
  anthropic: { label: 'Claude (≤1568 px, ≤1,15 Мпикс)', fn: (w, h) => fitBox(w, h, 1568, 1150000) },
  openai: { label: 'OpenAI/Gemini (≤1366 px)', fn: (w, h) => fitBox(w, h, 1366, 1366 * 800) },
  small: { label: 'Экономный (≤1024 px)', fn: (w, h) => fitBox(w, h, 1024, 1024 * 640) },
  native: { label: 'Без уменьшения (не рекомендуется)', fn: (w, h) => ({ width: w, height: h }) },
};

function targetSize(profile, w, h) { return (PROFILES[profile] || PROFILES.openai).fn(w, h); }

// Система координат ответа модели: 'pixels' — пиксели присланного снимка; 'norm1000' — 0..1000
function modelToScreen(pt, img, mon, coordMode = 'pixels') {
  let fx, fy;
  if (coordMode === 'norm1000') { fx = pt.x / 1000; fy = pt.y / 1000; }
  else { fx = pt.x / img.width; fy = pt.y / img.height; }
  fx = Math.min(Math.max(fx, 0), 0.9999); fy = Math.min(Math.max(fy, 0), 0.9999);
  return { x: Math.round(mon.x + fx * mon.width), y: Math.round(mon.y + fy * mon.height) };
}
function screenToModel(pt, img, mon, coordMode = 'pixels') {
  const fx = (pt.x - mon.x) / mon.width, fy = (pt.y - mon.y) / mon.height;
  if (coordMode === 'norm1000') return { x: Math.round(fx * 1000), y: Math.round(fy * 1000) };
  return { x: Math.round(fx * img.width), y: Math.round(fy * img.height) };
}

// Автовыбор по названию модели/провайдера
function guessProfile(provider, model = '') {
  const m = model.toLowerCase();
  if (/qwen.?2\.5.?vl|qwen2\.5-vl|qwen2_5_vl/.test(m)) return { profile: 'qwen', coords: 'pixels' };
  if (/qwen.?3|ui-?tars|qwen2-vl|glm-4\.\dv|gemma|nemotron.*vl|openrouter\/free/.test(m)) return { profile: 'qwen', coords: 'norm1000' };
  if (provider === 'anthropic' || /claude/.test(m)) return { profile: 'anthropic', coords: 'pixels' };
  if (provider === 'gemini' || provider === 'gemini_free' || /gemini/.test(m)) return { profile: 'openai', coords: 'norm1000' };
  return { profile: 'openai', coords: 'pixels' };
}

module.exports = { smartResize, fitBox, PROFILES, targetSize, modelToScreen, screenToModel, guessProfile };
