'use strict';
// Разбор ответа модели в действие. Устойчив к ```json, лишнему тексту, вызовам вида click(x=1,y=2), <tool_call>, координатам [x,y].

const ALIASES = { left_click: 'click', leftclick: 'click', tap: 'click', doubleclick: 'double_click', rightclick: 'right_click', press: 'key', hotkey: 'key', keypress: 'key', input: 'type', write: 'type', type_text: 'type',
  launch: 'open_app', open: 'open_app', open_application: 'open_app', start_app: 'open_app', run_app: 'open_app',
  open_chrome: 'browser_open', launch_chrome: 'browser_open', open_browser: 'browser_open', launch_browser: 'browser_open', start_browser: 'browser_open', start_chrome: 'browser_open', chrome: 'browser_open', browser: 'browser_open', navigate: 'browser_open', goto: 'browser_open', go_to: 'browser_open', open_url: 'browser_open', open_link: 'browser_open', visit: 'browser_open', browse: 'browser_open', browser_navigate: 'browser_open', browser_goto: 'browser_open', open_website: 'browser_open', open_site: 'browser_open', shell: 'run', bash: 'run', exec: 'run', command: 'run', sleep: 'wait', finish: 'done', finished: 'done', answer: 'done', stop: 'done', terminate: 'done', ask: 'ask_user', mouse_move: 'move', scroll_down: 'scroll', scroll_up: 'scroll', left_click_drag: 'drag' };
const TYPES = new Set(['click', 'double_click', 'triple_click', 'right_click', 'middle_click', 'move', 'drag', 'scroll', 'type', 'key', 'open_app', 'run', 'wait', 'zoom', 'screenshot', 'ask_user', 'done',
  'browser_open', 'browser_click', 'browser_type', 'browser_key', 'browser_read', 'browser_back', 'browser_scroll', 'browser_close', 'browser_dismiss', 'browser_select', 'browser_check', 'browser_upload', 'browser_fill', 'android_devices', 'android_setup', 'adb', 'fastboot', 'github', 'run_recipe',
  // 1.3.0/1.2.6: автономия (раньше эти типы отбрасывались как invalid — исправлено)
  'run_skill', 'checkpoint', 'os', 'run_tests', 'audit', 'template_search', 'template_fetch',
  'research', 'swarm', 'parallel', 'memory_add', 'memory_search', 'discover', 'install_tool', 'maintain', 'analyze_screen', 'build_agent']);

let jsonrepair = null; try { ({ jsonrepair } = require('jsonrepair')); } catch {}
// jsonrepair (josdejong/jsonrepair, ISC): чинит комментарии //, висячие запятые, кавычки, обрезанный JSON — частое у веб-чатов
function tryParse(c) {
  try { return JSON.parse(c); } catch {}
  try { return JSON.parse(c.replace(/,\s*([}\]])/g, '$1').replace(/'/g, '"')); } catch {}
  if (jsonrepair) { try { return JSON.parse(jsonrepair(c)); } catch {} }
  return null;
}
// Спасение из сломанного JSON: все вложенные объекты {...} с полем "type" — как пачка действий
function salvageActions(s) {
  s = String(s || '').replace(/\/\/[^\n"]*$/gm, '');
  const out = []; const stack = []; let inStr = false, esc = false, lastEnd = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') stack.push(i);
    else if (ch === '}' && stack.length) { const st = stack.pop(); const frag = s.slice(st, i + 1);
      if (/"type"\s*:/.test(frag)) { const o = tryParse(frag); if (o && o.type) { while (out.length && out[out.length - 1].st > st) out.pop(); out.push({ st, o }); } } }
  }
  return out.map(x => { const o = { ...x.o }; delete o.next_action; return o; });
}

// 1.2.0: очистка ответа поисковых чатов (Perplexity и др.): сноски [1], 【1†источник】, надстрочные цифры, «чипы» источников,
// markdown-ссылки [текст](url) внутри строк, типографские кавычки, неразрывные пробелы.
function cleanReply(t) {
  return String(t || '')
    .replace(/[\u201C\u201D\u201E\u00AB\u00BB](?=[^\n]*[:,}])/g, '"').replace(/[\u2018\u2019]/g, "'").replace(/[\u00A0\u202F\u200B]/g, ' ')
    .replace(/【[^】]{0,80}】/g, '')
    .replace(/[\u00B9\u00B2\u00B3\u2070-\u2079]+/g, '')
    .replace(/(["}\]])(\s*\[\d{1,3}\])+/g, '$1')
    .replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^)\s]+)\)/g, (m, txt, u) => (/^https?:/.test(txt) ? txt : u))
    .replace(/^\s*(?:[a-z0-9-]+(?:\.[a-z]{2,})?\+\d+)\s*$/gim, '')
    .replace(/\b([a-z0-9-]+\.(?:com|ru|org|io|ai|net))\+\d+\b/gi, '');
}
// Проверка обязательных полей: неполная команда → переспросить модель, а не выполнять вслепую
function validateAction(a) {
  if (!a) return 'нет действия';
  const need = { browser_open: ['url'], type: ['text'], open_app: ['name'], run: ['command'], key: ['keys'], browser_type: ['text'] };
  for (const k of need[a.type] || []) if (a[k] == null || a[k] === '') return `в действии ${a.type} нет поля "${k}"`;
  if (/^(click|double_click|right_click|triple_click|middle_click|move)$/.test(a.type) && a.element == null && (a.x == null || a.y == null)) return `в действии ${a.type} нет координат x,y или element`;
  return null;
}
function extractJson(text) {
  const s = String(text || '');
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const cands = [];
  if (fence) cands.push(fence[1]);
  const tc = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i.exec(s);
  if (tc) cands.push(tc[1]);
  // самый внешний объект {...}
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}' && depth > 0) { depth--; if (depth === 0 && start >= 0) { cands.push(s.slice(start, i + 1)); start = -1; } }
  }
  for (const c of cands) { const o = tryParse(c); if (o && typeof o === 'object') return o; }
  return null;
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : undefined; }

function normalizeAction(a) {
  if (!a || typeof a !== 'object') return null;
  // форматы {name, arguments} / {action:"click", coordinate:[x,y]}
  if (a.name && a.arguments) a = { type: a.name, ...(typeof a.arguments === 'string' ? JSON.parse(a.arguments) : a.arguments) };
  if (a.arguments && a.arguments.action) a = { ...a.arguments, type: a.arguments.action };
  let type = String(a.type || a.action || a.name || '').toLowerCase().trim();
  type = ALIASES[type] || type;
  if (!TYPES.has(type)) { const t2 = type.replace(/_(batch|many|all|multi|fields)$/, ''); if (TYPES.has(t2)) type = t2; }
  const out = { ...a, type };
  delete out.action;
  const coord = a.coordinate || a.coordinates || a.point || a.position || a.start_box || a.bbox;
  if (Array.isArray(coord) && coord.length >= 2) {
    if (coord.length === 4) { out.x = (num(coord[0]) + num(coord[2])) / 2; out.y = (num(coord[1]) + num(coord[3])) / 2; }
    else { out.x = num(coord[0]); out.y = num(coord[1]); }
  }
  if (typeof coord === 'string') { const m = /(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/.exec(coord); if (m) { out.x = +m[1]; out.y = +m[2]; } }
  const end = a.end_coordinate || a.to || a.end_box;
  if (Array.isArray(end) && end.length >= 2) { out.x2 = num(end[0]); out.y2 = num(end[1]); }
  for (const k of ['x', 'y', 'x2', 'y2', 'element', 'amount', 'seconds']) if (out[k] != null) out[k] = num(out[k]);
  if (type === 'scroll_down' || a.type === 'scroll_down') out.direction = 'down';
  if (type === 'scroll' && !out.direction) out.direction = (out.amount || 0) < 0 ? 'up' : 'down';
  if (type === 'type' && out.text == null) out.text = a.content ?? a.value ?? '';
  if (type === 'key' && out.keys == null) out.keys = a.key ?? a.combo ?? a.text ?? '';
  if (Array.isArray(out.keys)) out.keys = out.keys.join('+');
  if (type === 'run' && out.command == null) out.command = a.cmd ?? a.text ?? '';
  if (type === 'open_app' && out.name == null) out.name = a.app ?? a.text ?? '';
  if (type === 'done' && out.answer == null) out.answer = a.text ?? a.result ?? a.message ?? '';
  if (type === 'ask_user' && out.question == null) out.question = a.text ?? a.message ?? '';
  if (type === 'run_recipe' && out.name == null) out.name = a.recipe ?? a.text ?? '';
  // «открой Chrome/браузер» → управляемый браузер агента (а не отдельный неуправляемый Chrome)
  if (type === 'open_app' && /^(google[ -]?)?chrom(e|ium)|^браузер|^хром|^browser$|^edge$|^msedge$/i.test(String(out.name || '').trim())) { type = out.type = 'browser_open'; out.url = a.url || a.link || 'about:blank'; }
  if (type === 'browser_open') { if (out.url == null) out.url = a.link ?? a.href ?? a.address ?? a.target ?? a.website ?? (typeof a.text === 'string' && /\./.test(a.text) ? a.text : null) ?? 'about:blank'; out.url = String(out.url).trim().replace(/^<|>$/g, ''); }
  if (!TYPES.has(type)) return { type: 'invalid', raw: a };
  return out;
}

// Возвращает { observation, thought, action } или { error }
function parseReply(text) {
  const r = parseRaw(text);
  const c = cleanReply(text);
  const r2 = (r.error || (r.action && validateAction(r.action))) && c !== String(text || '') ? parseRaw(c) : null;
  const best = r2 && !r2.error ? r2 : r;
  if (!best.error) { const bad = (best.actions || [best.action]).map(validateAction).find(Boolean); if (bad) return { error: 'Неполная команда: ' + bad + '.' }; }
  return best;
}
function parseRaw(text) {
  const j = extractJson(text);
  if (j) {
    // Пачка действий: {"actions":[...]} — выполняем по очереди, после пачки новый скрин
    if (Array.isArray(j.actions) && j.actions.length) {
      const actions = j.actions.map(normalizeAction).filter(a => a && a.type !== 'invalid');
      if (actions.length) return { observation: j.observation || '', thought: j.thought || j.reasoning || '', action: actions[0], actions };
      return { error: 'Пустая пачка actions' };
    }
    // next_action / вложенные цепочки — разворачиваем в пачку
    if (j.action && typeof j.action === 'object' && j.action.next_action) {
      const chain = []; let cur = j.action; while (cur && typeof cur === 'object' && chain.length < 10) { const { next_action, ...rest } = cur; chain.push(rest); cur = next_action; }
      const actions = chain.map(normalizeAction).filter(a => a && a.type !== 'invalid');
      if (actions.length) return { observation: j.observation || '', thought: j.thought || '', action: actions[0], actions };
    }
    const actionObj = j.action && typeof j.action === 'object' ? j.action : (j.type || (typeof j.action === 'string') || j.name ? j : null);
    // {"type":"actions","actions":[...]} внутри action — это пачка
    if (actionObj && Array.isArray(actionObj.actions)) { const actions = actionObj.actions.map(normalizeAction).filter(a => a && a.type !== 'invalid'); if (actions.length) return { observation: j.observation || '', thought: j.thought || '', action: actions[0], actions }; }
    if (actionObj) {
      const action = normalizeAction(actionObj);
      if (action && action.type !== 'invalid') return { observation: j.observation || j['наблюдение'] || '', thought: j.thought || j['мысль'] || j.reasoning || '', action };
      return { error: 'Неизвестный тип действия: ' + JSON.stringify(actionObj).slice(0, 200) };
    }
  }
  { const sv = salvageActions(text).map(normalizeAction).filter(a => a && a.type !== 'invalid');
    if (sv.length) { const om = /"observation"\s*:\s*"([^"]*)"/.exec(text || ''); return { observation: om ? om[1] : '', thought: 'JSON исправлен автоматически', action: sv[0], actions: sv }; } }
  // запасной разбор: click(x=100, y=200) / click(100,200) / <point>…
  const f = /\b(click|double_click|right_click|left_click|move|type|key|hotkey|done|finished|wait|scroll)\s*\(([^)]*)\)/i.exec(text || '');
  if (f) {
    const args = f[2]; const a = { type: f[1] };
    const nums = args.match(/-?\d+(?:\.\d+)?/g) || [];
    if (/x\s*=/.test(args)) { a.x = +(/x\s*=\s*(-?\d+(?:\.\d+)?)/.exec(args) || [])[1]; a.y = +(/y\s*=\s*(-?\d+(?:\.\d+)?)/.exec(args) || [])[1]; }
    else if (nums.length >= 2) { a.x = +nums[0]; a.y = +nums[1]; }
    const str = /['"]([\s\S]*)['"]/.exec(args); if (str) { a.text = str[1]; a.keys = str[1]; a.answer = str[1]; }
    const action = normalizeAction(a);
    if (action && action.type !== 'invalid') return { observation: '', thought: (text || '').slice(0, 300), action };
  }
  // обрезанный (зациклившийся) ответ: спасаем тип и простые поля
  const tm = /"type"\s*:\s*"([a-z_]+)"/i.exec(text || '');
  if (tm) { const a = { type: tm[1] }; for (const k of ['x','y']) { const m = new RegExp('"'+k+'"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)').exec(text); if (m) a[k] = +m[1]; }
    const act = normalizeAction(a); if (act && act.type !== 'invalid' && (a.x != null || /^(wait|screenshot|android_devices|browser_back|browser_read)$/.test(act.type))) return { observation: '', thought: 'ответ обрезан', action: act }; }
  return { error: 'Не нашёл JSON с действием в ответе модели.' };
}

const ACTION_SCHEMA = { type: 'object', properties: {
  observation: { type: 'string', maxLength: 400 }, thought: { type: 'string', maxLength: 500 },
  action: { type: 'object', properties: { type: { enum: [...TYPES] }, x: { type: 'number' }, y: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' }, zx: { type: 'number' }, zy: { type: 'number' },
    text: { type: 'string', maxLength: 2000 }, keys: { type: 'string', maxLength: 60 }, name: { type: 'string', maxLength: 200 }, command: { type: 'string', maxLength: 2000 },
    url: { type: 'string', maxLength: 500 }, selector: { type: 'string', maxLength: 300 }, element: { type: 'integer' }, direction: { enum: ['up', 'down', 'left', 'right'] }, amount: { type: 'integer' },
    seconds: { type: 'number' }, answer: { type: 'string', maxLength: 2000 }, question: { type: 'string', maxLength: 600 }, args: { type: 'array', items: { type: 'string' } }, background: { type: 'boolean' }, timeout: { type: 'integer' } },
    required: ['type'] } }, required: ['observation', 'thought', 'action'] };
const REFINE_SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' }, x: { type: 'number' }, y: { type: 'number' }, norm: { type: 'boolean' } } };
module.exports = { cleanReply, validateAction, ACTION_SCHEMA, REFINE_SCHEMA, parseReply, extractJson, normalizeAction };
