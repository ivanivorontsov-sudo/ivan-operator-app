// 1.2.2: цепочка ИИ для задачи. autoModelSwitch=false — «Автовыбор модели и переключение при зависании» выключен:
// работаем только с выбранным ИИ: без запасных, без гостевых авто-запасных, без адаптивного выбора.
function autoOn(s) { return !s || s.autoModelSwitch !== false; }
function buildChain(base, opts = {}) {
  if (!autoOn(base)) return [base];
  const chain = [base, ...((base.fallbacks || []).filter((f) => f && f.provider).map((f) => ({ ...base, ...f })))];
  const id = opts.provId || ((x) => x.provider + ':' + (x.webchat || x.model || ''));
  if (base.autoFailover !== false) for (const g of ['duckai', 'glm', 'chatgpt']) { const c = { ...base, provider: 'webchat', webchat: g, webchatUrl: '', webchatKeepChat: false }; if (!chain.some((x) => id(x) === id(c))) chain.push(c); }
  return chain;
}
function adaptiveOn(base) { return autoOn(base) && base.adaptiveModels !== false; }
module.exports = { buildChain, adaptiveOn, autoOn };
