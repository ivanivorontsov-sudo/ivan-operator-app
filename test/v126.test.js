'use strict';
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const X = require('../app/auto/extra'); const P = require('../app/parse');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'iop126-'));

test('новые и 1.3.0 действия больше не отбрасываются как invalid', () => {
  for (const t of ['os', 'checkpoint', 'run_skill', 'run_tests', 'audit', 'template_search', 'template_fetch', 'research', 'swarm', 'parallel', 'memory_add', 'memory_search', 'discover', 'install_tool', 'maintain', 'analyze_screen', 'build_agent'])
    assert.strictEqual(P.normalizeAction({ type: t }).type, t);
  const r = P.parseReply('```json\n{"observation":"","thought":"","action":{"type":"os","intent":"list_dir","args":{"path":"."}}}\n```'); assert.strictEqual(r.action.type, 'os'); assert.strictEqual(r.action.intent, 'list_dir');
});
test('общая память: BM25-поиск, секреты вырезаются', () => {
  const d = tmp(); const m = new X.SharedMemory(d);
  m.add({ topic: 'ГигаЧат не принимает снимок', solution: 'закрыть окно соглашения и нажать Продолжить' });
  m.add({ topic: 'сборка apk gradle', solution: 'token: ghp_abcdefghijklmnopqrstuvwxyz123456 ./gradlew assembleRelease' });
  assert.match(m.search('снимок гигачат')[0].topic, /ГигаЧат/);
  assert.ok(!JSON.stringify(m.all()).includes('ghp_abc'));
  assert.match(m.hint('гигачат снимок'), /ОБЩАЯ ПАМЯТЬ/);
});
test('исследователь: разбор выдачи DuckDuckGo и Readability', async () => {
  const ddg = '<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fa&amp;rut=x">Статья <b>A</b></a><a class="result__snippet" href="#">кратко</a>';
  assert.deepStrictEqual(X.parseDdg(ddg)[0], { url: 'https://example.org/a', title: 'Статья A', snippet: 'кратко' });
  const page = '<html><head><title>T</title></head><body><nav>меню</nav><article><h1>Заголовок</h1>' + '<p>Полезный текст статьи про ядро ОС и загрузчик Limine. </p>'.repeat(10) + '</article></body></html>';
  const a = X.extractArticle(page, 'u'); assert.match(a.text, /Limine/); assert.ok(!/меню/.test(a.text));
  const d = tmp(); const get = async (u) => u.includes('duckduckgo') ? { status: 200, type: 'text/html', text: ddg } : { status: 200, type: 'text/html', text: page };
  const r = await X.research('ядро', { get, dataDir: d, chat: async () => ({ text: 'Вывод [1]' }) });
  assert.ok(fs.existsSync(r.file)); assert.match(r.report, /Вывод \[1\]/); assert.match(r.report, /example\.org/);
});
test('рой: план → части разным ИИ → сборка', async () => {
  const calls = [];
  const mk = (id) => ({ id, chat: async (m) => { const t = m[0].content[0].text; calls.push(id); if (/Раздели/.test(t)) return { text: '{"parts":[{"title":"A","prompt":"сделай A"},{"title":"B","prompt":"сделай B"}]}' }; if (/Собери/.test(t)) return { text: 'ИТОГ' }; return { text: id + ':' + t.slice(0, 8) }; } });
  const r = await X.swarm('большая задача', [mk('ai1'), mk('ai2')]);
  assert.strictEqual(r.result, 'ИТОГ'); assert.deepStrictEqual(r.parts.map((p) => p.who), ['ai1', 'ai2']);
});
test('параллельное решение: проверка выбирает правильный вариант', async () => {
  const ans = { a: '41', b: '42', c: '40' };
  const chats = Object.keys(ans).map((id) => ({ id, chat: async () => ({ text: ans[id] }) }));
  const r = await X.parallel('6*7?', chats, { n: 3, verify: async (t) => ({ score: t === '42' ? 1 : 0, why: 't' }) });
  assert.strictEqual(r.best.text, '42'); assert.strictEqual(r.candidates.length, 3);
});
test('конструктор агентов: роль по описанию, сохранение', () => {
  const d = tmp(); const b = new X.AgentBuilder(d); const p = b.build('тестировщик сайтов на React');
  assert.match(p.name, /Веб-разработчик|Тестировщик/); assert.ok(p.preferredActions.includes('run_tests')); assert.match(p.prompt, /подтверждения Ивана/);
  b.save(p); assert.strictEqual(b.list().length, 1); assert.ok(b.get(p.name)); b.remove(p.name); assert.strictEqual(b.list().length, 0);
});
test('обнаружение инструментов и команды установки под ОС', async () => {
  const r = await X.discover({ has: async (c) => ['git', 'node', 'ffmpeg'].includes(c) });
  assert.ok(r.tools.find((t) => t.cmd === 'git').ok); assert.ok(r.capabilities.some((c) => /Сайт/.test(c)));
  const s = X.suggestTools('сделай свою ОС и конвертируй видео', r.tools, 'linux', (c) => c === 'apt-get');
  assert.ok(s.missing.includes('qemu-system-x86_64')); assert.ok(!s.missing.includes('ffmpeg'));
  assert.strictEqual(X.installCmd('ffmpeg', 'win'), 'winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements');
  assert.strictEqual(X.installCmd('ffmpeg', 'brew'), 'brew install ffmpeg');
});
test('визуальный анализатор: зависание, пустой экран, ошибка', () => {
  const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 10) n++; return n / a.length; };
  const same = Uint8Array.from({ length: 100 }, (_, i) => i * 2);
  assert.strictEqual(X.analyzeFrames([same, same, same], { diffRatio: diff }).verdict, 'frozen');
  assert.strictEqual(X.analyzeFrames([new Uint8Array(100).fill(3)], { diffRatio: diff }).verdict, 'blank');
  assert.strictEqual(X.analyzeFrames([same], { diffRatio: diff, windowTitle: 'Program (Not Responding)' }).verdict, 'error');
});
test('самообслуживание: без apply ничего не удаляет', () => {
  const d = tmp(); fs.mkdirSync(path.join(d, 'reports')); const f = path.join(d, 'reports', 'old.md'); fs.writeFileSync(f, 'x'); const old = (Date.now() - 40 * 86400000) / 1000; fs.utimesSync(f, old, old);
  const r = X.maintain(d); assert.ok(r.cleaned.includes(f)); assert.ok(fs.existsSync(f));
  X.maintain(d, { apply: true }); assert.ok(!fs.existsSync(f));
});
test('переносимый интеллект: экспорт без ключей, импорт без выхода за папку', () => {
  const a = tmp(), b = tmp(); fs.mkdirSync(path.join(a, 'skills')); fs.writeFileSync(path.join(a, 'skills', 's.json'), '{"name":"s"}');
  new X.SharedMemory(a).add({ topic: 't', solution: 's' });
  const bundle = X.exportBundle(a, { key: 'sk-secretsecretsecretsecret', apiToken: 'x', fallbacks: [{ key: 'k' }], maxSteps: 40 });
  const txt = JSON.stringify(bundle); assert.ok(!txt.includes('sk-secret')); assert.ok(!('apiToken' in bundle.settings)); assert.strictEqual(bundle.settings.maxSteps, 40);
  bundle.files['../evil.txt'] = 'x'; bundle.files['skills/../../evil2'] = 'x';
  const r = X.importBundle(b, bundle); assert.ok(fs.existsSync(path.join(b, 'skills', 's.json'))); assert.strictEqual(r.skipped.length, 2); assert.ok(!fs.existsSync(path.join(b, '..', 'evil.txt')));
  assert.throws(() => X.importBundle(b, { format: 'x' }));
});
test('рой/параллель при выключенном автовыборе модели используют только выбранную нейросеть', () => {
  const { Autonomy } = require('../app/auto'); const A = new Autonomy(tmp());
  const agent = { _chain: [{ provider: 'webchat', webchat: 'deepseek' }, { provider: 'webchat', webchat: 'duckai' }], provId: (c) => c.provider + ':' + c.webchat, chat: async () => ({ text: 'x' }) };
  assert.strictEqual(A.chats(agent, { provider: 'webchat', webchat: 'deepseek', autoModelSwitch: false }).length, 1);
  assert.strictEqual(A.chats(agent, { provider: 'webchat', webchat: 'deepseek' }).length, 2);
});
test('кэш has(): повторный вызов не запускает процесс', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'platform.js'), 'utf8'); assert.match(src, /const HAS = new Map\(\)/);
  const ag = fs.readFileSync(path.join(__dirname, '..', 'app', 'agent.js'), 'utf8'); assert.match(ag, /async settle\(s, maxMs, a\)/); assert.ok(!/await platform\.sleep\(s\.settleMs \|\| 900\);/.test(ag));
});
