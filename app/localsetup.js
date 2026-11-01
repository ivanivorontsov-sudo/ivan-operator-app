'use strict';
// Мастер локальной модели: Ollama → скачать модель со зрением → создать «ivan-operator» с нужными параметрами.
const os = require('os');
const sizing = require('./sizing');

const CHOICES = [
  { id: 'qwen2.5vl:3b', label: 'Qwen2.5-VL 3B — 3,2 ГБ, для слабых ПК (≥8 ГБ ОЗУ)', minRam: 0 },
  { id: 'qwen2.5vl:7b', label: 'Qwen2.5-VL 7B — 6 ГБ, рекомендуется (≥16 ГБ ОЗУ или видеокарта 8 ГБ)', minRam: 14 },
  { id: 'qwen3-vl:8b', label: 'Qwen3-VL 8B — 6 ГБ, новее, координаты 0..1000', minRam: 14 },
  { id: 'qwen2.5vl:32b', label: 'Qwen2.5-VL 32B — 21 ГБ, точнее всего (видеокарта 24 ГБ)', minRam: 40 },
];
function recommend() {
  const gb = os.totalmem() / 2 ** 30;
  return gb >= 14 ? 'qwen2.5vl:7b' : 'qwen2.5vl:3b';
}
const SYSTEM = 'Ты — ИИ-оператор компьютера. Ты видишь снимки экрана и отвечаешь ОДНИМ JSON-объектом с действием. Координаты — центр нужного элемента. Пиши по-русски.';

async function status(base = 'http://127.0.0.1:11434') {
  try { const r = await fetch(base + '/api/version', { signal: AbortSignal.timeout(3000) }); const j = await r.json(); const t = await (await fetch(base + '/api/tags')).json(); return { running: true, version: j.version, models: (t.models || []).map((m) => m.name) }; }
  catch { return { running: false }; }
}

async function pull(base, model, onProgress, signal) {
  const r = await fetch(base + '/api/pull', { method: 'POST', body: JSON.stringify({ model, stream: true }), signal });
  if (!r.ok) throw new Error('Ollama: ' + (await r.text()).slice(0, 300));
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
      const j = JSON.parse(line); if (j.error) throw new Error(j.error);
      onProgress && onProgress({ status: j.status, pct: j.total ? Math.round((j.completed || 0) * 100 / j.total) : null });
    }
  }
}

async function createOperatorModel(base, from, numCtx = 16384) {
  const r = await fetch(base + '/api/create', { method: 'POST', body: JSON.stringify({ model: 'ivan-operator', from, system: SYSTEM, parameters: { num_ctx: numCtx, temperature: 0.1, top_p: 0.9 }, stream: false }) });
  if (!r.ok) throw new Error('Не удалось создать ivan-operator: ' + (await r.text()).slice(0, 300));
}

// Полная настройка; возвращает изменения настроек
async function setup({ base = 'http://127.0.0.1:11434', model, onProgress, signal }) {
  const st = await status(base);
  if (!st.running) throw new Error('OLLAMA_NOT_RUNNING');
  model = model || recommend();
  if (!st.models.some((m) => m === model || m === model + ':latest')) { onProgress && onProgress({ status: 'Скачиваю ' + model }); await pull(base, model, onProgress, signal); }
  const numCtx = os.totalmem() / 2 ** 30 >= 14 ? 16384 : 8192;
  onProgress && onProgress({ status: 'Создаю профиль ivan-operator' });
  await createOperatorModel(base, model, numCtx);
  const g = sizing.guessProfile('ollama', model);
  return { provider: 'ollama', base, model: 'ivan-operator', baseModel: model, profile: g.profile, coords: g.coords, numCtx, contextBudget: numCtx - 2000,
    temperature: 0.1, maxTokens: 512, timeoutSec: 600, precise: true, useMarks: true };
}

module.exports = { CHOICES, recommend, status, setup, pull };
