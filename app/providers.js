'use strict';
// Провайдеры моделей. Внутренний формат сообщения:
// { role: 'system'|'user'|'assistant', content: [ {type:'text', text}, {type:'image', data:<base64 jpeg>} ] }

const PRESETS = {
  openrouter_free: { label: '★ Бесплатно: OpenRouter (Gemma 4 31B :free, 50 запросов/день)', base: 'https://openrouter.ai/api/v1', kind: 'openai', model: 'google/gemma-4-31b-it:free', vision: true, needsKey: true, free: true, keyUrl: 'https://openrouter.ai/keys' },
  gemini_free: { label: '★ Бесплатно: Google Gemini (бесплатный уровень AI Studio)', base: 'https://generativelanguage.googleapis.com/v1beta/openai', kind: 'openai', model: 'gemini-2.5-flash', vision: true, needsKey: true, free: true, keyUrl: 'https://aistudio.google.com/apikey' },
  webchat: { label: '🌐 Встроенный браузер: веб-чат ИИ (DeepSeek, ChatGPT, Qwen, GigaChat, Алиса, Copilot…)', base: '', kind: 'webchat', model: '', vision: true, needsKey: false, free: true },
  pollinations: { label: '★ Бесплатно без ключа: Pollinations (только текст, по списку элементов)', base: 'https://text.pollinations.ai/openai', kind: 'openai', model: 'openai-fast', vision: false, needsKey: false, free: true, jsonMode: true },
  groq:       { label: '★ Бесплатно: Groq (qwen3.8-27b, ~3 снимка/мин)', base: 'https://api.groq.com/openai/v1', kind: 'openai', model: 'qwen/qwen3.8-27b', vision: true, needsKey: true, free: true, keyUrl: 'https://console.groq.com/keys' },
  openai:     { label: 'OpenAI', base: 'https://api.openai.com/v1', kind: 'openai', model: 'gpt-4.1', vision: true, needsKey: true },
  anthropic:  { label: 'Anthropic (Claude)', base: 'https://api.anthropic.com', kind: 'anthropic', model: 'claude-sonnet-4-5', vision: true, needsKey: true },
  gemini:     { label: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', kind: 'openai', model: 'gemini-2.5-flash', vision: true, needsKey: true },
  openrouter: { label: 'OpenRouter', base: 'https://openrouter.ai/api/v1', kind: 'openai', model: 'qwen/qwen2.5-vl-72b-instruct', vision: true, needsKey: true },
  deepseek:   { label: 'DeepSeek (без зрения!)', base: 'https://api.deepseek.com', kind: 'openai', model: 'deepseek-chat', vision: false, needsKey: true },
  ollama:     { label: 'Ollama (локально)', base: 'http://127.0.0.1:11434', kind: 'ollama', model: 'ivan-operator', vision: true, needsKey: false },
  engine:     { label: 'Встроенная модель (скачивается в программе)', base: 'http://127.0.0.1:8091/v1', kind: 'openai', model: 'local', vision: true, needsKey: false },
  llamacpp:   { label: 'llama.cpp server (локально)', base: 'http://127.0.0.1:8080/v1', kind: 'openai', model: 'local', vision: true, needsKey: false },
  custom:     { label: 'Свой адрес (OpenAI-совместимый)', base: 'http://127.0.0.1:1234/v1', kind: 'openai', model: '', vision: true, needsKey: false },
};

function textOf(m) { return m.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'); }

async function http(url, body, headers, timeoutMs, signal) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(new Error('timeout')), timeoutMs);
  const onAbort = () => ctl.abort(new Error('stopped'));
  if (signal) signal.addEventListener('abort', onAbort);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    const txt = await r.text();
    if (!r.ok) { const e = new Error(`HTTP ${r.status}: ${txt.slice(0, 600)}`); e.status = r.status; e.retryAfter = Number(r.headers.get('retry-after')) || null;
      const m = /Retry after (\d+)/i.exec(txt); if (m) e.retryAfter = Number(m[1]);
      throw e; }
    return JSON.parse(txt);
  } catch (e) {
    if (ctl.signal.aborted) { if (signal && signal.aborted) { const e2 = new Error('Остановлено'); e2.stopped = true; throw e2; } const e2 = new Error(`Модель не ответила за ${Math.round(timeoutMs / 1000)} с`); e2.timeout = true; throw e2; }
    const cause = e && e.cause ? (e.cause.code || e.cause.message || String(e.cause)) : '';
    if (cause && !e.status) { const e2 = new Error(`${e.message}: ${cause}`); e2.cause = e.cause; throw e2; }
    throw e;
  } finally { clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); }
}

// cfg: { provider, base, key, model, temperature, maxTokens, numCtx, timeoutSec }
async function chat(cfg, messages, signal) {
  const p = PRESETS[cfg.provider] || PRESETS.custom;
  const kind = p.kind;
  if (kind === 'webchat') { if (!module.exports.webchat) throw new Error('Веб-чат доступен только в приложении'); return module.exports.webchat(cfg, messages, signal); }
  const base = ((cfg.base && String(cfg.base).trim()) || p.base).replace(/\/+$/, '');
  const timeout = (cfg.timeoutSec || 300) * 1000;
  const temperature = cfg.temperature ?? 0.1;
  const maxTokens = cfg.maxTokens || 1024;
  const vision = p.vision !== false;

  if (kind === 'anthropic') {
    const sys = messages.filter((m) => m.role === 'system').map(textOf).join('\n\n');
    const msgs = mergeSameRole(messages.filter((m) => m.role !== 'system')).map((m) => ({
      role: m.role,
      content: m.content.map((c) => c.type === 'image' ? { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: c.data } } : { type: 'text', text: c.text }),
    }));
    const j = await http(base + '/v1/messages', { model: cfg.model, system: sys, messages: msgs, max_tokens: maxTokens, temperature },
      { 'x-api-key': cfg.key || '', 'anthropic-version': '2023-06-01' }, timeout, signal);
    return { text: (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n'), usage: j.usage };
  }

  if (kind === 'ollama') {
    const msgs = messages.map((m) => {
      const o = { role: m.role, content: textOf(m) };
      const imgs = m.content.filter((c) => c.type === 'image').map((c) => c.data);
      if (imgs.length) o.images = imgs;
      return o;
    });
    const j = await http(base + '/api/chat', { model: cfg.model, messages: msgs, stream: false, keep_alive: '30m',
      ...(cfg.schema ? { format: cfg.schema } : {}), options: { temperature, num_ctx: cfg.numCtx || 16384, num_predict: maxTokens } }, {}, timeout, signal);
    return { text: (j.message && j.message.content) || '', usage: { input: j.prompt_eval_count, output: j.eval_count } };
  }

  // OpenAI-совместимые (OpenAI, Gemini, OpenRouter, DeepSeek, llama.cpp, LM Studio, vLLM …)
  // Сливаем подряд идущие роли (Pollinations/portkey ломается на «грязной» истории → 400 to=assistant).
  const mapped = mergeSameRole(messages).map((m) => {
    const role = (m.role === 'system' || m.role === 'assistant') ? m.role : 'user';
    if (role === 'system' || !m.content.some((c) => c.type === 'image') || !vision) {
      let t = textOf(m) || '(пусто)';
      if (!vision && m.content.some((c) => c.type === 'image')) t += '\n[Снимок экрана не передан: модель не поддерживает изображения. Пользуйтесь списком элементов интерфейса.]';
      return { role, content: t };
    }
    return { role, content: m.content.map((c) => c.type === 'image' ? { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + c.data, detail: 'high' } } : { type: 'text', text: c.text || '' }) };
  }).filter((m) => m.content && (typeof m.content === 'string' ? m.content.trim() : m.content.length));
  const msgs = mapped;
  const headers = {};
  if (cfg.key) headers.authorization = 'Bearer ' + cfg.key;
  if (cfg.provider === 'openrouter') { headers['HTTP-Referer'] = 'https://github.com/ivanivorontsov-sudo'; headers['X-Title'] = 'IvanOperator'; }
  const body = { model: cfg.model, messages: msgs, temperature };
  if (/^(llamacpp|engine|ollama)$/.test(cfg.provider || '') || /127\.0\.0\.1|localhost/.test(base)) { body.repeat_penalty = 1.05; if (cfg.schema) body.json_schema = cfg.schema; }
  else if (cfg.schema && p.jsonMode) body.response_format = { type: 'json_object' };
  if (/^(o\d|gpt-5)/.test(cfg.model || '')) body.max_completion_tokens = maxTokens; else body.max_tokens = maxTokens;
  const j = await http(base + '/chat/completions', body, headers, timeout, signal);
  const ch = j.choices && j.choices[0];
  return { text: (ch && ch.message && (ch.message.content || '')) || '', usage: j.usage };
}

function mergeSameRole(msgs) {
  const out = [];
  for (const m of msgs) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content = last.content.concat(m.content);
    else out.push({ role: m.role, content: m.content.slice() });
  }
  if (out.length && out[0].role !== 'user') out.unshift({ role: 'user', content: [{ type: 'text', text: '(начало)' }] });
  return out;
}

async function listModels(cfg) {
  const p = PRESETS[cfg.provider] || PRESETS.custom;
  const base = ((cfg.base && String(cfg.base).trim()) || p.base).replace(/\/+$/, '');
  try {
    if (p.kind === 'ollama') { const r = await fetch(base + '/api/tags'); const j = await r.json(); return (j.models || []).map((m) => m.name); }
    if (p.kind === 'anthropic') { const r = await fetch(base + '/v1/models', { headers: { 'x-api-key': cfg.key || '', 'anthropic-version': '2023-06-01' } }); const j = await r.json(); return (j.data || []).map((m) => m.id); }
    const r = await fetch(base + '/models', { headers: cfg.key ? { authorization: 'Bearer ' + cfg.key } : {} });
    const j = await r.json(); return (j.data || []).map((m) => m.id);
  } catch (e) { return []; }
}

module.exports = { PRESETS, chat, listModels, mergeSameRole };
