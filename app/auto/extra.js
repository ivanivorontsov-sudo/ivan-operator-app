'use strict';
// 1.2.6: остальные пункты «ПОТОМ» — исследователь, рой, параллельное решение, общая память, конструктор агентов,
// обнаружение инструментов/возможностей, визуальный анализатор, самообслуживание, переносимый интеллект.
// Заимствовано: @mozilla/readability (Apache-2.0) + linkedom (ISC) — извлечение текста статей;
// DuckDuckGo HTML (html.duckduckgo.com) — поиск без ключа; идеи роя/судьи — AutoGen/CrewAI (MIT), «self-consistency» (Wang et al. 2022);
// BM25-подобный поиск по памяти — по мотивам Okapi BM25 (общеизвестный алгоритм).
const fs = require('fs');
const os = require('os');
const path = require('path');

const words = (s) => (String(s || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 1)); fs.renameSync(t, f); };
const SECRET_RE = /(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:password|пароль|token|api[_-]?key)\s*[:=]\s*\S+)/gi;
const scrub = (s) => String(s || '').replace(SECRET_RE, '[скрыто]');

// ---------- Общая память агентов (проверенные решения) ----------
class SharedMemory {
  constructor(dataDir) { this.file = path.join(dataDir, 'shared-memory.json'); }
  all() { return readJson(this.file, []); }
  add({ topic, solution, tags = [], source = 'agent', verified = false }) {
    if (!topic || !solution) throw new Error('нужны topic и solution');
    const list = this.all(); const t = scrub(topic).slice(0, 300), sol = scrub(solution).slice(0, 4000);
    const ex = list.find((x) => x.topic === t); if (ex) { ex.solution = sol; ex.updated = Date.now(); ex.verified = ex.verified || verified; ex.uses = ex.uses || 0; }
    else list.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), topic: t, solution: sol, tags, source, verified, created: Date.now(), uses: 0 });
    while (list.length > 2000) list.shift(); writeJson(this.file, list); return ex || list[list.length - 1];
  }
  search(q, k = 5) {
    const list = this.all(); if (!list.length) return [];
    const docs = list.map((x) => words(x.topic + ' ' + x.solution + ' ' + (x.tags || []).join(' ')));
    const avg = docs.reduce((n, d) => n + d.length, 0) / docs.length || 1; const N = docs.length;
    const df = {}; for (const d of docs) for (const w of new Set(d)) df[w] = (df[w] || 0) + 1;
    const qs = [...new Set(words(q))];
    return list.map((x, i) => { const d = docs[i]; const tf = {}; for (const w of d) tf[w] = (tf[w] || 0) + 1; let s = 0;
      for (const w of qs) if (tf[w]) { const idf = Math.log(1 + (N - df[w] + 0.5) / (df[w] + 0.5)); s += idf * tf[w] * 2.2 / (tf[w] + 1.2 * (0.25 + 0.75 * d.length / avg)); }
      return { ...x, score: s + (x.verified ? 0.3 : 0) }; }).filter((x) => x.score > 0.2).sort((a, b) => b.score - a.score).slice(0, k);
  }
  remove(id) { writeJson(this.file, this.all().filter((x) => x.id !== id)); }
  hint(task) { const r = this.search(task, 3); return r.length ? '\n\n## ОБЩАЯ ПАМЯТЬ (проверенные решения похожих задач)\n' + r.map((x) => `- ${x.topic}: ${x.solution.slice(0, 400)}`).join('\n') : ''; }
}

// ---------- Автономный исследователь ----------
function httpGet(url, { timeout = 15000, max = 2 << 20, signal } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout); if (signal) signal.addEventListener('abort', () => ctl.abort(), { once: true });
  return fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) IvanOperator/1.2.6', 'accept-language': 'ru,en;q=0.8' } })
    .then(async (r) => { const b = Buffer.from(await r.arrayBuffer()); return { status: r.status, type: r.headers.get('content-type') || '', text: b.subarray(0, max).toString('utf8') }; }).finally(() => clearTimeout(t));
}
function parseDdg(html) {
  const out = []; const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>((?:(?!class="result__a")[\s\S]){0,3000}?class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g; let m;
  const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ').trim();
  while ((m = re.exec(html)) && out.length < 10) { let u = m[1].replace(/&amp;/g, '&'); const g = /[?&]uddg=([^&]+)/.exec(u); if (g) u = decodeURIComponent(g[1]); if (u.startsWith('//')) u = 'https:' + u; if (!/^https?:/.test(u) || /duckduckgo\.com\/y\.js/.test(u)) continue; out.push({ url: u, title: strip(m[2]), snippet: strip(m[4]) }); }
  return out;
}
function extractArticle(html, url) {
  try { const { parseHTML } = require('linkedom'); const { Readability } = require('@mozilla/readability'); const { document } = parseHTML(html); const a = new Readability(document).parse(); if (a && a.textContent && a.textContent.trim().length > 200) return { title: a.title || '', text: a.textContent.replace(/\s+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim() }; } catch {}
  return { title: (/<title>([^<]*)/i.exec(html) || [])[1] || url, text: html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() };
}
async function research(topic, { chat, dataDir, pages = 3, get = httpGet, signal } = {}) {
  const s = await get('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(topic), { signal });
  const results = parseDdg(s.text); const src = [];
  for (const r of results.slice(0, Math.max(pages * 2, 4))) { if (src.length >= pages) break; try { const p = await get(r.url, { signal }); if (p.status >= 400 || !/html|text/.test(p.type)) continue; const a = extractArticle(p.text, r.url); if (a.text.length < 200) continue; src.push({ ...r, title: a.title || r.title, text: a.text.slice(0, 6000) }); } catch {} }
  let report;
  if (chat && src.length) {
    const prompt = `Тема исследования: ${topic}\nНиже выдержки из ${src.length} источников. Составь отчёт на русском: 1) краткий вывод, 2) ключевые факты со ссылками [n], 3) что проверить/попробовать экспериментом, 4) открытые вопросы. Не выдумывай того, чего нет в источниках.\n\n` + src.map((x, i) => `[${i + 1}] ${x.title} — ${x.url}\n${x.text.slice(0, 3500)}`).join('\n\n');
    try { report = (await chat([{ role: 'user', content: [{ type: 'text', text: prompt }] }])).text; } catch (e) { report = 'Модель не ответила: ' + e.message; }
  } else report = src.length ? src.map((x, i) => `[${i + 1}] ${x.title}\n${x.text.slice(0, 600)}…`).join('\n\n') : 'Источники не найдены. Результаты поиска:\n' + results.map((r) => `- ${r.title} ${r.url}`).join('\n');
  const md = `# Исследование: ${topic}\n\n${report}\n\n## Источники\n` + (src.length ? src : results).map((x, i) => `${i + 1}. [${x.title}](${x.url})`).join('\n') + '\n';
  let file = null; if (dataDir) { file = path.join(dataDir, 'reports', `research-${new Date().toISOString().replace(/[:.]/g, '-')}.md`); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, md); }
  return { report: md, file, sources: src.map(({ text, ...r }) => r), results };
}

// ---------- Рой агентов и параллельное решение с выбором лучшего ----------
// chats: [{id, chat(msgs)}] — разные нейросети из цепочки. Если автовыбор модели выключен — вызывающий передаёт одну.
const T = (text) => [{ role: 'user', content: [{ type: 'text', text }] }];
function jsonOf(t) { try { return require('../parse').extractJson(t); } catch { try { return JSON.parse(String(t).match(/\{[\s\S]*\}/)[0]); } catch { return null; } } }
async function swarm(task, chats, { maxParts = 4, signal } = {}) {
  if (!chats.length) throw new Error('нет доступных нейросетей');
  const lead = chats[0];
  const plan = jsonOf((await lead.chat(T(`Раздели задачу на 2–${maxParts} независимые подзадачи для разных исполнителей. Верни ТОЛЬКО JSON {"parts":[{"title":"…","prompt":"…"}]}.\nЗадача: ${task}`))).text);
  const parts = (plan && Array.isArray(plan.parts) ? plan.parts : [{ title: 'вся задача', prompt: task }]).slice(0, maxParts);
  const res = await Promise.allSettled(parts.map((p, i) => { if (signal && signal.aborted) throw new Error('Остановлено'); const w = chats[i % chats.length]; return w.chat(T(`${p.prompt}\n(Это часть общей задачи: ${task}. Ответь только по своей части.)`)).then((r) => ({ who: w.id, title: p.title, text: r.text })); }));
  const done = res.map((r, i) => r.status === 'fulfilled' ? r.value : { who: chats[i % chats.length].id, title: parts[i].title, text: 'ОШИБКА: ' + (r.reason && r.reason.message) });
  const merged = (await lead.chat(T(`Собери итог задачи «${task}» из частей. Убери противоречия, укажи, если часть не выполнена.\n\n` + done.map((d) => `## ${d.title} (${d.who})\n${String(d.text).slice(0, 5000)}`).join('\n\n')))).text;
  return { parts: done, result: merged };
}
// verify(candidateText) → {score 0..1, why}. Без verify — судья-модель + голосование по совпадению (self-consistency).
async function parallel(task, chats, { n = 3, verify, judge } = {}) {
  const pool = chats.length ? chats : []; if (!pool.length) throw new Error('нет доступных нейросетей');
  const runs = await Promise.allSettled(Array.from({ length: Math.min(n, Math.max(pool.length, n)) }, (_, i) => pool[i % pool.length].chat(T(task)).then((r) => ({ who: pool[i % pool.length].id, text: r.text }))));
  const cands = runs.filter((r) => r.status === 'fulfilled' && r.value.text).map((r) => r.value);
  if (!cands.length) throw new Error('ни один вариант не получен');
  for (const c of cands) {
    if (verify) { try { Object.assign(c, await verify(c.text)); } catch (e) { c.score = 0; c.why = e.message; } continue; }
    const mine = new Set(words(c.text)); let agree = 0; for (const o of cands) if (o !== c) { const ow = new Set(words(o.text)); let k = 0; for (const w of mine) if (ow.has(w)) k++; agree += k / Math.max(1, Math.min(mine.size, ow.size)); }
    c.score = cands.length > 1 ? agree / (cands.length - 1) : 0.5; c.why = 'согласие с другими вариантами';
  }
  if (!verify && judge && cands.length > 1) { try { const j = jsonOf((await judge(T(`Задача: ${task}\nВыбери лучший вариант решения. Верни ТОЛЬКО JSON {"best":номер,"why":"…"}.\n` + cands.map((c, i) => `### Вариант ${i + 1}\n${String(c.text).slice(0, 3000)}`).join('\n')))).text); if (j && cands[j.best - 1]) { cands[j.best - 1].score += 1; cands[j.best - 1].why = 'судья: ' + (j.why || ''); } } catch {} }
  cands.sort((a, b) => b.score - a.score);
  return { best: cands[0], candidates: cands };
}

// ---------- Конструктор агентов ----------
const ROLES = [
  [/сайт|верстк|html|css|react|vue|лендинг/i, { name: 'Веб-разработчик', actions: ['template_search', 'template_fetch', 'run', 'run_tests', 'os', 'browser_open', 'browser_read', 'checkpoint'], rules: 'Начинай с готовой заготовки (template_search). Меняй только то, что просят. Проверяй сайт в браузере.' }],
  [/тест|qa|ошибк|баг/i, { name: 'Тестировщик', actions: ['run_tests', 'run', 'os', 'checkpoint', 'audit'], rules: 'Цикл: run_tests → исправить → run_tests. Не удаляй тесты, чтобы они «прошли».' }],
  [/исслед|отчёт|отчет|анализ рынка|сравни/i, { name: 'Исследователь', actions: ['research', 'browser_open', 'browser_read', 'memory_add'], rules: 'Опирайся только на источники, ставь ссылки. Важные выводы сохраняй в общую память.' }],
  [/безопасн|аудит|уязвим/i, { name: 'Аудитор', actions: ['audit', 'os', 'run'], rules: 'Только чтение и проверки; ничего не удаляй без подтверждения.' }],
  [/андроид|android|apk|adb/i, { name: 'Android-инженер', actions: ['android_devices', 'adb', 'run', 'os'], rules: 'Прошивка/стирание — только после подтверждения Ивана.' }],
  [/(^|[^а-яё])ос([^а-яё]|$)|операционн|ядро|kernel|движ|engine|игр/i, { name: 'Системный разработчик', actions: ['template_search', 'template_fetch', 'run', 'run_tests', 'checkpoint'], rules: 'Бери готовую основу (Limine/xv6/raylib/Godot…), меняй минимально, собирай и проверяй в эмуляторе (qemu).' }],
];
class AgentBuilder {
  constructor(dataDir) { this.dir = path.join(dataDir, 'agents'); }
  build(description, { name } = {}) {
    const d = String(description || '').trim(); if (!d) throw new Error('опишите помощника');
    const hits = ROLES.filter(([re]) => re.test(d)).map(([, r]) => r);
    const base = hits[0] || { name: 'Помощник', actions: [], rules: '' };
    const actions = [...new Set(hits.flatMap((h) => h.actions))];
    const prof = { name: (name || base.name + (hits.length > 1 ? ' + ' + hits.slice(1).map((h) => h.name).join(' + ') : '')).slice(0, 80), description: d.slice(0, 1000), preferredActions: actions,
      prompt: `Ты — специализированный помощник «${name || base.name}». Цель: ${d}\n${hits.map((h) => h.rules).filter(Boolean).join('\n')}\nОпасные действия (удаление, оплата, отправка сообщений, прошивка) — только после подтверждения Ивана.`, created: Date.now() };
    return prof;
  }
  save(p) { const f = path.join(this.dir, p.name.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 60) + '.json'); writeJson(f, p); return f; }
  list() { try { return fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(this.dir, f), null)).filter(Boolean); } catch { return []; } }
  get(n) { return this.list().find((p) => p.name === n) || null; }
  remove(n) { for (const f of fs.readdirSync(this.dir)) { const p = readJson(path.join(this.dir, f), {}); if (p.name === n) fs.unlinkSync(path.join(this.dir, f)); } }
}

// ---------- Обнаружение инструментов и возможностей ----------
const TOOLS = [
  ['git', 'контроль версий', { win: 'Git.Git', apt: 'git', brew: 'git' }], ['node', 'JavaScript', { win: 'OpenJS.NodeJS.LTS', apt: 'nodejs', brew: 'node' }],
  ['python3', 'Python', { win: 'Python.Python.3.12', apt: 'python3', brew: 'python' }], ['python', 'Python', null], ['pip3', 'пакеты Python', { apt: 'python3-pip' }],
  ['docker', 'контейнеры', { win: 'Docker.DockerDesktop', apt: 'docker.io', brew: 'docker' }], ['ffmpeg', 'видео/аудио', { win: 'Gyan.FFmpeg', apt: 'ffmpeg', brew: 'ffmpeg' }],
  ['magick', 'картинки (ImageMagick)', { win: 'ImageMagick.ImageMagick', apt: 'imagemagick', brew: 'imagemagick' }], ['convert', 'картинки (ImageMagick 6)', null],
  ['qemu-system-x86_64', 'эмулятор для своих ОС', { win: 'SoftwareFreedomConservancy.QEMU', apt: 'qemu-system-x86', brew: 'qemu' }],
  ['gcc', 'компилятор C', { apt: 'build-essential', brew: 'gcc' }], ['make', 'сборка', { apt: 'make' }], ['cmake', 'сборка C/C++', { win: 'Kitware.CMake', apt: 'cmake', brew: 'cmake' }],
  ['cargo', 'Rust', { win: 'Rustlang.Rustup', apt: 'cargo', brew: 'rust' }], ['go', 'Go', { win: 'GoLang.Go', apt: 'golang', brew: 'go' }], ['java', 'Java', { win: 'EclipseAdoptium.Temurin.21.JDK', apt: 'openjdk-21-jdk', brew: 'openjdk' }],
  ['adb', 'Android', { win: 'Google.PlatformTools', apt: 'adb', brew: 'android-platform-tools' }], ['7z', 'архивы', { win: '7zip.7zip', apt: 'p7zip-full', brew: 'p7zip' }],
  ['curl', 'загрузки', { apt: 'curl' }], ['tesseract', 'распознавание текста (OCR)', { win: 'UB-Mannheim.TesseractOCR', apt: 'tesseract-ocr tesseract-ocr-rus', brew: 'tesseract' }],
  ['osv-scanner', 'уязвимости зависимостей', { win: 'Google.OSVScanner', brew: 'osv-scanner' }], ['xdotool', 'мышь/клавиатура X11', { apt: 'xdotool' }], ['ydotool', 'мышь/клавиатура Wayland', { apt: 'ydotool' }],
  ['grim', 'быстрые снимки Wayland (wlroots)', { apt: 'grim' }], ['code', 'VS Code', { win: 'Microsoft.VisualStudioCode', brew: 'visual-studio-code' }],
];
const NEEDS = [[/видео|аудио|звук|mp4|mp3|конверт/i, ['ffmpeg']], [/картин|изображ|фото|png|jpg/i, ['magick', 'convert']], [/(^|[^а-яё])ос([^а-яё]|$)|операционн|ядро|загрузчик/i, ['qemu-system-x86_64', 'gcc', 'make']],
  [/rust/i, ['cargo']], [/\bgo\b|golang/i, ['go']], [/java|kotlin|gradle/i, ['java']], [/android|apk|adb/i, ['adb']], [/контейнер|docker/i, ['docker']], [/распозна|ocr|текст с картин/i, ['tesseract']],
  [/архив|zip|7z|rar/i, ['7z']], [/уязвим|аудит/i, ['osv-scanner']], [/сайт|react|vue|node|npm/i, ['node']], [/python|питон|pip/i, ['python3', 'pip3']], [/c\+\+|cmake/i, ['cmake', 'gcc']]];
function pm(platform = process.platform, has) { if (platform === 'win32') return 'win'; if (platform === 'darwin') return has('brew') ? 'brew' : null; return has('apt-get') ? 'apt' : null; }
function installCmd(tool, mgr) { const t = TOOLS.find((x) => x[0] === tool); const p = t && t[2] && t[2][mgr]; if (!p) return null; return mgr === 'win' ? `winget install --id ${p} -e --accept-source-agreements --accept-package-agreements` : mgr === 'brew' ? `brew install ${p}` : `sudo apt-get install -y ${p}`; }
async function discover({ has, run } = {}) {
  const out = [];
  for (const [cmd, what] of TOOLS) { const ok = await has(cmd); let ver = ''; if (ok && run) { try { const r = await run(cmd, ['--version'], undefined, 5000); ver = (r.output || '').split('\n').find((l) => l.trim()) || ''; } catch {} } out.push({ cmd, what, ok, version: ver.slice(0, 80) }); }
  const caps = [];
  const H = (c) => out.some((x) => x.cmd === c && x.ok);
  if (H('ffmpeg') && H('tesseract')) caps.push('Распознать текст из кадров видео: ffmpeg (кадры) → tesseract (OCR).');
  if (H('qemu-system-x86_64') && H('gcc') && H('make')) caps.push('Собрать и запустить свою ОС из заготовки (limine-c-template) в QEMU.');
  if (H('git') && H('node')) caps.push('Сайт из заготовки (create-vite/astro) с локальным предпросмотром.');
  if (H('adb')) caps.push('Установка APK и логи с телефона по USB.');
  if (H('docker')) caps.push('Запуск чужих проектов изолированно в контейнере.');
  if (H('python3')) caps.push('Скрипты Python для обработки файлов.');
  return { tools: out, capabilities: caps };
}
function suggestTools(task, found, platform = process.platform, has = () => false) {
  const want = [...new Set(NEEDS.filter(([re]) => re.test(task)).flatMap(([, t]) => t))];
  const mgr = pm(platform, has); const missing = want.filter((t) => !(found || []).some((x) => x.cmd === t && x.ok));
  return { want, missing, install: missing.map((t) => ({ tool: t, command: mgr ? installCmd(t, mgr) : null })).filter((x) => x.command) };
}

// ---------- Визуальный анализатор (по сигнатурам кадров и тексту окна) ----------
const ERR_RE = /(error|ошибк|exception|не отвечает|not responding|failed|сбой|traceback|fatal|denied|отказано|crash)/i;
const W96 = 96, H60 = 60;
function analyzeFrames(sigs, { diffRatio, texts = [], windowTitle = '' } = {}) {
  const r = { frozen: false, blank: false, changed: 0, errors: [], verdict: 'ok' };
  const last = sigs[sigs.length - 1];
  if (last) { let sum = 0, mn = 255, mx = 0; for (const v of last) { sum += v; if (v < mn) mn = v; if (v > mx) mx = v; } const avg = sum / last.length; r.blank = mx - mn < 8; r.brightness = Math.round(avg); }
  if (sigs.length >= 2) { const d = []; for (let i = 1; i < sigs.length; i++) d.push(diffRatio(sigs[i - 1], sigs[i])); r.changed = +(d[d.length - 1]).toFixed(4); r.frozen = sigs.length >= 3 && d.every((x) => x < 0.001); }
  for (const t of [windowTitle, ...texts]) if (t && ERR_RE.test(t)) r.errors.push(String(t).slice(0, 160));
  // 1.2.7: «занят» — меняется только маленький участок (индикатор загрузки); «модальное окно» — затемнённые края и светлый центр
  if (sigs.length >= 3) { const d = []; for (let i = 1; i < sigs.length; i++) d.push(diffRatio(sigs[i - 1], sigs[i])); r.busy = d.every((x) => x > 0.0005 && x < 0.02); }
  if (last && last.length === W96 * H60) { let e = 0, ne = 0, c = 0, nc = 0; for (let y = 0; y < H60; y++) for (let x = 0; x < W96; x++) { const v = last[y * W96 + x]; const edge = x < 8 || x >= W96 - 8 || y < 5 || y >= H60 - 5; const cen = x > 30 && x < 66 && y > 18 && y < 42; if (edge) { e += v; ne++; } else if (cen) { c += v; nc++; } } r.edge = Math.round(e / ne); r.center = Math.round(c / nc); r.modal = r.edge < 90 && r.center - r.edge > 60; }
  r.verdict = r.errors.length ? 'error' : r.blank ? 'blank' : r.modal ? 'modal' : r.frozen ? 'frozen' : r.busy ? 'busy' : r.changed > 0.4 ? 'ui_changed' : 'ok';
  r.ru = { ok: 'экран в порядке', error: 'на экране ошибка: ' + r.errors.slice(0, 2).join(' | '), blank: 'экран пустой/одноцветный (окно не прорисовалось?)', frozen: 'экран не меняется — возможно зависание', ui_changed: 'интерфейс сильно изменился — пересмотри элементы', modal: 'поверх открыто модальное окно/диалог — сначала закрой или ответь на него', busy: 'идёт загрузка (меняется только небольшой участок) — подожди' }[r.verdict];
  return r;
}

// ---------- Самообслуживание ----------
function dirSize(d) { let n = 0; try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); try { n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size; } catch {} } } catch {} return n; }
function maintain(dataDir, { keepDays = 30, maxLogMB = 50, apply = false } = {}) {
  const rep = { mem: { freeMB: Math.round(os.freemem() / 1048576), totalMB: Math.round(os.totalmem() / 1048576) }, load: os.loadavg ? os.loadavg()[0] : 0, dirs: {}, cleaned: [], warnings: [] };
  try { const st = fs.statfsSync(dataDir); rep.diskFreeMB = Math.round(st.bavail * st.bsize / 1048576); if (rep.diskFreeMB < 2048) rep.warnings.push(`мало места на диске: ${rep.diskFreeMB} МБ`); } catch {}
  if (rep.mem.freeMB < 1024) rep.warnings.push(`мало свободной памяти: ${rep.mem.freeMB} МБ`);
  const cut = Date.now() - keepDays * 86400000;
  for (const sub of ['reports', 'recordings', 'logs', 'history', 'tmp']) {
    const d = path.join(dataDir, sub); rep.dirs[sub] = Math.round(dirSize(d) / 1048576 * 10) / 10;
    try { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const s = fs.statSync(p); if (s.mtimeMs < cut && sub !== 'history') { rep.cleaned.push(p); if (apply) fs.rmSync(p, { recursive: true, force: true }); } } } catch {}
  }
  try { for (const f of fs.readdirSync(dataDir)) if (/\.log$/.test(f)) { const p = path.join(dataDir, f); const s = fs.statSync(p); if (s.size > maxLogMB * 1048576) { rep.cleaned.push(p + ' (обрезка)'); if (apply) { const b = fs.readFileSync(p); fs.writeFileSync(p, b.subarray(b.length - 5 * 1048576)); } } } } catch {}
  try { for (const f of fs.readdirSync(os.tmpdir())) if (/^iop-/.test(f)) { const p = path.join(os.tmpdir(), f); const s = fs.statSync(p); if (s.mtimeMs < Date.now() - 86400000) { rep.cleaned.push(p); if (apply) fs.rmSync(p, { recursive: true, force: true }); } } } catch {}
  rep.applied = apply; return rep;
}

// ---------- Переносимый интеллект: экспорт/импорт навыков, памяти, агентов, рецептов, статистики, настроек (без ключей) ----------
const BUNDLE_FILES = ['shared-memory.json', 'modelstats.json', 'attach-learned.json', 'system_prompt.md'];
const BUNDLE_DIRS = ['skills', 'agents', 'recipes'];
function exportBundle(dataDir, settings) {
  const files = {};
  const addFile = (rel) => { const p = path.join(dataDir, rel); try { if (fs.statSync(p).size < 5 << 20) files[rel] = fs.readFileSync(p, 'utf8'); } catch {} };
  for (const f of BUNDLE_FILES) addFile(f);
  for (const d of BUNDLE_DIRS) { try { for (const f of fs.readdirSync(path.join(dataDir, d))) addFile(path.join(d, f).split(path.sep).join('/')); } catch {} }
  const { cleanSettings } = require('./index');
  const s = cleanSettings(settings || {}); for (const k of Object.keys(s)) if (/key|token|pass|secret|cookie/i.test(k)) delete s[k];
  for (const [k, v] of Object.entries(files)) files[k] = scrub(v);
  return { format: 'ivan-operator-bundle', version: 1, created: new Date().toISOString(), from: { os: process.platform, arch: process.arch, host: undefined }, settings: s, files };
}
function importBundle(dataDir, b, { overwrite = false } = {}) {
  if (!b || b.format !== 'ivan-operator-bundle') throw new Error('это не файл переноса ИванОператора');
  const done = []; const skipped = [];
  for (const [rel, text] of Object.entries(b.files || {})) {
    const norm = path.normalize(rel); if (norm.startsWith('..') || path.isAbsolute(norm) || !(BUNDLE_FILES.includes(norm) || BUNDLE_DIRS.includes(norm.split(path.sep)[0]))) { skipped.push(rel + ' (запрещённый путь)'); continue; }
    const p = path.join(dataDir, norm);
    if (rel === 'shared-memory.json' && fs.existsSync(p) && !overwrite) { const cur = readJson(p, []); const inc = JSON.parse(text); const have = new Set(cur.map((x) => x.topic)); writeJson(p, [...cur, ...inc.filter((x) => !have.has(x.topic))]); done.push(rel + ' (объединено)'); continue; }
    if (fs.existsSync(p) && !overwrite) { skipped.push(rel + ' (уже есть)'); continue; }
    fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); done.push(rel);
  }
  // настройки: только переносимые поля; пути/монитор/ОС-зависимое — не трогаем
  const s = { ...(b.settings || {}) }; for (const k of ['projectDirs', 'monitor', 'base', 'key', 'keyEnc', 'fallbacks', 'proxy', 'enginePath', 'modelPath']) delete s[k];
  return { imported: done, skipped, settings: s };
}

// 1.2.7: необязательный анализ ИИ по снимку (поверх эвристик)
async function analyzeWithAI(chat, jpegB64, heur, goal = '') {
  const prompt = `Ты визуальный анализатор экрана. Эвристики по пикселям: ${heur.ru}. ${goal ? 'Цель пользователя: ' + goal + '. ' : ''}Посмотри на снимок и ответь ТОЛЬКО JSON: {"verdict":"ok|error|modal|loading|frozen|login|captcha|other","problems":["…"],"next":"что сделать дальше одной фразой"}`;
  const r = await chat([{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image', data: jpegB64, tokens: 800 }] }]);
  const j = jsonOf(r && r.text) || {}; return { verdict: String(j.verdict || 'other'), problems: Array.isArray(j.problems) ? j.problems.map(String).slice(0, 5) : [], next: String(j.next || '').slice(0, 300), raw: (r && r.text || '').slice(0, 500) };
}

// 1.2.7: голосование за следующее действие на экране (несколько ответов → кластеры → лучший)
const GUI_TYPES = new Set(['click', 'double_click', 'triple_click', 'right_click', 'middle_click', 'move', 'drag', 'scroll', 'type', 'key', 'wait', 'browser_click', 'browser_type', 'browser_key', 'browser_scroll', 'browser_back', 'browser_select', 'browser_check', 'browser_fill', 'browser_dismiss']);
function voteActions(cands, { width = 1000, height = 1000, tol = 0.03 } = {}) {
  const ok = cands.filter((a) => a && GUI_TYPES.has(a.type));
  const tx = (a) => String(a.text ?? a.keys ?? a.direction ?? a.selector ?? '').trim().toLowerCase();
  const near = (a, b) => (a.x == null && b.x == null) || (a.x != null && b.x != null && Math.abs(a.x - b.x) <= tol * width && Math.abs(a.y - b.y) <= tol * height);
  const same = (a, b) => a.type === b.type && tx(a) === tx(b) && (a.element ?? null) === (b.element ?? null) && near(a, b);
  const cl = []; for (const a of ok) { const c = cl.find((c) => same(c.items[0], a)); if (c) c.items.push(a); else cl.push({ items: [a] }); }
  for (const c of cl) { const a = { ...c.items[0] }; const xs = c.items.filter((i) => i.x != null); if (xs.length) { a.x = Math.round(xs.reduce((s, i) => s + i.x, 0) / xs.length); a.y = Math.round(xs.reduce((s, i) => s + i.y, 0) / xs.length); } c.action = a; c.votes = c.items.length; delete c.items; }
  cl.sort((a, b) => b.votes - a.votes); return { ranked: cl, valid: ok.length, total: cands.length };
}

module.exports = { analyzeWithAI, voteActions, GUI_TYPES, SharedMemory, research, parseDdg, extractArticle, httpGet, swarm, parallel, AgentBuilder, discover, suggestTools, installCmd, TOOLS, analyzeFrames, maintain, exportBundle, importBundle, scrub };
