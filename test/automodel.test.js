'use strict';
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path');
const { buildChain, adaptiveOn } = require('../app/chain');
const base = { provider: 'webchat', webchat: 'alice', fallbacks: [{ provider: 'openai', model: 'gpt' }], adaptiveModels: true };
test('автовыбор включён (по умолчанию): запасные + гостевые чаты + адаптивность', () => {
  const c = buildChain(base); assert.ok(c.length >= 4); assert.equal(c[0].webchat, 'alice'); assert.ok(adaptiveOn(base));
});
test('автовыбор выключен: только выбранный ИИ, без адаптивного выбора', () => {
  const s = { ...base, autoModelSwitch: false }; const c = buildChain(s);
  assert.equal(c.length, 1); assert.equal(c[0].webchat, 'alice'); assert.equal(adaptiveOn(s), false);
});
test('настройка сохраняется: есть в defaults, в окне настроек и быстрый переключатель', () => {
  const root = path.join(__dirname, '..', 'app');
  assert.match(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), /autoModelSwitch: true/);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8'); assert.match(html, /id="qAutoSwitch"/); assert.match(html, /id="auAutoSwitch"/);
  const r = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8'); assert.match(r, /saveSettings\(\{ \.\.\.s, autoModelSwitch: v \}\)/);
  const a = fs.readFileSync(path.join(root, 'agent.js'), 'utf8'); assert.match(a, /require\('\.\/chain'\)\.buildChain/);
});
