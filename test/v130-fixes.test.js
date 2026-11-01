'use strict';
const test = require('node:test'); const assert = require('node:assert');
const intent = require('../app/auto/intent');
test('быстрые команды: открой хром/файерфокс/url', () => {
  assert.equal(intent.parse('открой хром').type, 'app');
  assert.ok(intent.parse('Открой файерфокс').names.includes('Firefox'));
  assert.equal(intent.parse('открой браузер хром').label, 'хром');
  assert.equal(intent.parse('открой ya.ru').url, 'https://ya.ru');
  assert.equal(intent.parse('открой хром и найди погоду'), null);
  assert.equal(intent.parse('напиши сайт'), null);
});
test('css: поле ввода — сетка 1fr | auto', () => {
  const css = require('fs').readFileSync(__dirname + '/../app/style.css', 'utf8');
  assert.match(css, /grid-template-columns:minmax\(0,1fr\) auto/); assert.match(css, /min-height:96px/);
});
test('perplexity: картинки через файл, история /library', () => {
  const src = require('fs').readFileSync(__dirname + '/../app/webchat.js', 'utf8');
  assert.match(src, /perplexity:[^\n]*images: true, upload: true[^\n]*library/);
  assert.match(require('fs').readFileSync(__dirname + '/../app/attach.js', 'utf8'), /DOM\.setFileInputFiles/);
});
test('agent: стоп/aborted → не «Ошибка: aborted»; ECONNREFUSED → понятный текст; переспрос JSON', () => {
  const src = require('fs').readFileSync(__dirname + '/../app/agent.js', 'utf8');
  assert.match(src, /wasStop/); assert.match(src, /никто не слушает/); assert.match(src, /Переспрашиваю модель/); assert.match(src, /stepTimeoutSec/);
});
