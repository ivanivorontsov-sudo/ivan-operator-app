'use strict';
// Сторож: повторы при сбоях API, ожидание при лимитах, перезапуск локального движка, переход на запасного провайдера.
const providers = require('./providers');

function classify(e) {
  const m = String(e && e.message || e);
  if (e && e.stopped) return 'stopped';
  if (e && (e.status === 429 || e.status === 402) || /rate.?limit|too many requests|quota|RESOURCE_EXHAUSTED|FREE_LIMIT|1 reply every/i.test(m)) return 'rate';
  if (e && e.status >= 500 || /overloaded|unavailable|bad gateway/i.test(m)) return 'server';
  if (e && e.timeout) return 'timeout';
  if (/fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket|network|terminated|UND_ERR/i.test(m)) return 'network';
  if (e && (e.status === 401 || e.status === 403)) return 'auth';
  if (e && (e.status === 400 || e.status === 404 || e.status === 413)) return 'request';
  return 'other';
}
const RU = { rate: 'лимит запросов', server: 'ошибка сервера', timeout: 'модель зависла (таймаут)', network: 'обрыв связи', auth: 'неверный ключ', request: 'запрос отклонён', other: 'ошибка' };
const sleep = (ms, signal) => new Promise((res, rej) => { const t = setTimeout(res, ms); if (signal) signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('Остановлено'); e.stopped = true; rej(e); }, { once: true }); });

// cfg — настройки текущего провайдера; hooks: { emit, engine, signal }
async function robustChat(cfg, messages, { emit, engine, signal, tries = 4, onRetry } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await providers.chat(cfg, messages, signal); }
    catch (e) {
      last = e; const kind = classify(e);
      if (kind === 'stopped') throw e;
      if (kind === 'auth' || (kind === 'request' && i > 0)) break; // повтор не поможет
      let wait = Math.min(60000, 2000 * 2 ** i);
      if (kind === 'rate') {
        const ra = e.retryAfter ? e.retryAfter * 1000 : null;
        const hinted = /Retry after (\d+)/i.exec(String(e.message));
        wait = Math.min(120000, ra || (hinted ? (Number(hinted[1]) + 2) * 1000 : 35000 * (i + 1)));
      }
      if ((kind === 'network' || kind === 'timeout') && engine && /^(llamacpp|engine|ollama)$/.test(cfg.provider)) {
        emit && emit({ kind: 'warn', text: `Сторож: локальная модель не отвечает (${RU[kind]}) — перезапускаю движок…` });
        const ok = await engine.ensure().catch(() => false);
        emit && emit({ kind: 'info', text: ok ? 'Сторож: движок снова работает.' : 'Сторож: перезапустить движок не удалось.' });
        wait = 500;
      }
      if (i < tries - 1) { if (onRetry) onRetry(kind); emit && emit({ kind: 'warn', text: `Сторож: ${RU[kind]} (${String(e.message).slice(0, 120)}). Повтор ${i + 2}/${tries} через ${Math.round(wait / 1000)} с.` }); await sleep(wait, signal); }
    }
  }
  last.kind = classify(last); throw last;
}

module.exports = { robustChat, classify, RU, sleep };
