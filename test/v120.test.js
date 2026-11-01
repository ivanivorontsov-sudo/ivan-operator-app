// Тесты 1.2.0: Perplexity (длинный чат, команды), guard (токены/бюджет/циклы), стоп.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const parse = require('../app/parse'); const guard = require('../app/guard');

test('Perplexity: ответ со сносками и ссылками разбирается', () => {
  const t = 'Открою браузер.[1][2]\n```json\n{"observation":"рабочий стол","thought":"нужен Chrome","action":{"type":"open_chrome","url":"[ya.ru](https://ya.ru)"}}[3]\n```\n**Источники** reddit+2';
  const r = parse.parseReply(t); assert.ok(!r.error, r.error); const a = r.actions ? r.actions[0] : r.action;
  assert.strictEqual(a.type, 'browser_open'); assert.match(a.url, /ya\.ru/);
});
test('open_app Chrome → browser_open about:blank', () => {
  const r = parse.parseReply('```json\n{"thought":"x","action":{"type":"open_app","name":"Google Chrome"}}\n```');
  const a = r.actions ? r.actions[0] : r.action; assert.strictEqual(a.type, 'browser_open'); assert.strictEqual(a.url, 'about:blank');
});
test('кавычки-ёлочки/умные кавычки и nbsp', () => {
  const r = parse.parseReply('```json\n{“thought”:“ок”,\u00a0“action”:{“type”:“launch_chrome”,“url”:“https://duck.ai”}}\n```');
  assert.ok(!r.error, r.error);
});
test('validateAction ловит пустой клик', () => { assert.ok(parse.validateAction({ type: 'click' })); assert.ok(!parse.validateAction({ type: 'click', x: 1, y: 2 })); });

test('TokenMeter и бюджет', () => {
  const m = new guard.TokenMeter(100); m.add([], { usage: { prompt_tokens: 60, completion_tokens: 10 } }); assert.ok(!m.over()); m.add([{ role: 'user', content: 'x'.repeat(400) }], { text: 'ok' }); assert.ok(m.estimated); assert.ok(m.over());
  assert.ok(guard.estimateText('привет мир') > 0); const e = guard.budgetError(m); assert.ok(e.stopped && e.budget);
});
test('HopGuard: цикл A→B→A→B и лимит повторов', () => {
  const h = new guard.HopGuard({ maxHops: 10, maxRetries: 3 }); assert.ok(!h.visit('A')); h.visit('B'); h.visit('A');
  assert.match(h.visit('B'), /зацикливание/); const h2 = new guard.HopGuard({ maxRetries: 2 }); assert.ok(!h2.retry()); h2.retry(); assert.ok(h2.retry());
  const h3 = new guard.HopGuard({ maxHops: 1 }); h3.visit('A'); h3.visit('B'); assert.ok(h3.visit('C'));
});
test('pickKeyShots берёт последние разные', () => { const s = guard.pickKeyShots(['a', 'a', 'b', 'c', 'd'].map((x) => ({ sig: x, b64: x })), 3); assert.strictEqual(s.length, 3); });
test('abortable прерывается < 100 мс', async () => {
  const ac = new AbortController(); const t0 = Date.now(); setTimeout(() => ac.abort(), 20);
  await assert.rejects(guard.abortable(new Promise(() => {}), ac.signal)); assert.ok(Date.now() - t0 < 100);
});
test('webchat: RULES каждый ход и сжатый контекст', () => {
  let wc; try { wc = require('../app/webchat'); } catch { return; } // вне Electron модуль может не грузиться
  assert.match(wc.RULES, /browser_open/);
  const msgs = [{ role: 'system', content: [{ type: 'text', text: 'sys' }] }, { role: 'user', content: [{ type: 'text', text: 'Задача: открыть сайт' }] }];
  for (let i = 0; i < 30; i++) msgs.push({ role: i % 2 ? 'user' : 'assistant', content: [{ type: 'text', text: 'шаг ' + i + ' '.repeat(5) + 'x'.repeat(1000) }] });
  const c = wc.condense(msgs); assert.match(c, /Задача: открыть сайт/); assert.ok(c.length <= 4000);
});

// Длинная страница «как Perplexity»: 12 старых ответов с JSON, затем новый ответ, который генерируется.
test('capture: читается только новейший ответ в длинном чате', async (t) => {
  let pw; try { pw = require('playwright-core'); } catch { t.skip('нет playwright'); return; }
  const exe = ['/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p)); if (!exe) { t.skip('нет Chrome'); return; }
  const old = Array.from({ length: 12 }, (_, i) => `<div class="q">вопрос ${i}</div><div id="markdown-content-${i}" class="prose"><p>Шаг ${i}</p><pre><code>{"thought":"старый ${i}","action":{"type":"click","x":${i},"y":1}}</code></pre><a>reddit+2</a></div>`).join('');
  const html = `<html><body><main id="m">${old}</main><textarea id="ask-input"></textarea></body></html>`;
  const b = await pw.chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
  try {
    const p = await b.newPage(); await p.setContent(html);
    await p.evaluate('window.__ppForce="www.perplexity.ai"'); await p.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../app/webchat_capture.js'), 'utf8') });
    await p.evaluate('window.__pp.mark()');
    let r = JSON.parse(await p.evaluate('window.__pp.poll()'));
    assert.ok(!/старый/.test(r.text), 'до ответа не должно быть старого JSON: ' + r.text);
    // React перерисовал старые ответы (новые узлы, тот же текст) — не должны считаться новыми
    await p.evaluate(`document.getElementById('m').innerHTML=document.getElementById('m').innerHTML`);
    r = JSON.parse(await p.evaluate('window.__pp.poll()')); assert.ok(!/старый/.test(r.text), 'перерисовка: ' + r.text);
    await p.evaluate(`document.getElementById('m').insertAdjacentHTML('beforeend','<div id="markdown-content-99" class="prose"><p>Открываю</p><pre><code>{"thought":"новый","action":{"type":"open_chrome"}}</code></pre></div>')`);
    r = JSON.parse(await p.evaluate('window.__pp.poll()'));
    assert.match(r.text, /новый/); assert.ok(!/старый/.test(r.text));
    const a = parse.parseReply(r.text); assert.strictEqual((a.actions ? a.actions[0] : a.action).type, 'browser_open');
  } finally { await b.close(); }
});

test('browser.stopAll укладывается в 0.6 с без браузера', async () => {
  let br; try { br = require('../app/browser'); } catch { return; }
  const t0 = Date.now(); await br.stopAll(); assert.ok(Date.now() - t0 < 600);
});
