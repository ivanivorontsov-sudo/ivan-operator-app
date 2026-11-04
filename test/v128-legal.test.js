'use strict';
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path');
const legal = require('../app/legal'); const root = path.join(__dirname, '..');
test('текст предупреждения содержит ключевые пункты', () => {
  for (const k of ['мышью и клавиатурой', 'снимки экрана', '152-ФЗ', 'может ошибаться', 'добровольно', 'Стоп', 'Ваша ответственность', '272', 'AS IS', 'В пределах, допускаемых', 'не юридическая консультация']) assert.ok(legal.LEGAL_TEXT.includes(k), k);
});
test('принятие хранится с версией', () => {
  assert.equal(legal.isAccepted({}), false); assert.equal(legal.isAccepted({ legalAccepted: { version: legal.LEGAL_VERSION - 1 } }), false);
  const r = legal.acceptRecord('1.2.8'); assert.equal(r.version, legal.LEGAL_VERSION); assert.ok(!isNaN(Date.parse(r.date))); assert.ok(legal.isAccepted({ legalAccepted: r }));
});
test('LEGAL.md совпадает с текстом в программе', () => { const md = fs.readFileSync(path.join(root, 'LEGAL.md'), 'utf8').replace(/  $/gm, ''); assert.ok(md.includes(legal.LEGAL_TEXT)); });
test('окно согласия и пункт в настройках на месте, прежние элементы не тронуты', () => {
  const h = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
  for (const id of ['legalModal', 'legalChk', 'legalAccept', 'legalQuit', 'legalShow', 'qAutoSwitch', 'qPauseEvery', 'qChatList', 'input']) assert.ok(h.includes(`id="${id}"`), id);
  assert.ok(h.includes('Я прочитал(а) и принимаю'));
  const m = fs.readFileSync(path.join(root, 'app/main.js'), 'utf8'); assert.ok(m.includes("'legal-accept'") && m.includes('legal.isAccepted(settings)'));
});
