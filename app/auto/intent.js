'use strict';
// 1.3.0: быстрый локальный разбор простых команд («открой хром», «запусти firefox», «открой ya.ru») — без модели
const APPS = [
  [/^(гугл\s*)?хром(иум)?$|^chrom(e|ium)$|^google\s*chrome$/i, ['Google Chrome', 'Chromium', 'chrome', 'chromium']],
  [/^(фа[йи]е?рфокс|фаерфокс|файрфокс|firefox|мозилл?[ау])$/i, ['Firefox', 'firefox', 'firefox-esr']],
  [/^(браузер|интернет)$/i, ['Firefox', 'Google Chrome', 'Chromium']],
  [/^(edge|эдж|майкрософт\s*эдж)$/i, ['Microsoft Edge', 'msedge']],
  [/^(терминал|консоль|terminal)$/i, ['Terminal', 'Терминал', 'gnome-terminal', 'konsole', 'xterm']],
  [/^(проводник|файлы|файловый\s*менеджер|nautilus|files)$/i, ['Files', 'Файлы', 'nautilus', 'explorer']],
  [/^(калькулятор|calculator)$/i, ['Calculator', 'Калькулятор', 'gnome-calculator', 'calc']],
  [/^(блокнот|текстовый\s*редактор|gedit|notepad)$/i, ['Text Editor', 'Текстовый редактор', 'gedit', 'notepad']],
  [/^(настройки|settings)$/i, ['Settings', 'Параметры', 'gnome-control-center']],
  [/^(телеграм+|telegram)$/i, ['Telegram', 'telegram-desktop']],
  [/^(vs\s*code|вскод|vscode|код)$/i, ['Visual Studio Code', 'code']],
];
const VERB = /^\s*(пожалуйста\s+)?(открой|запусти|включи|открыть|запустить|open|launch|start|run)\s+(пожалуйста\s+)?/i;
function parse(text) {
  const t = String(text || '').trim().replace(/[.!]+$/, '');
  if (!VERB.test(t) || t.length > 80) return null;
  let rest = t.replace(VERB, '').replace(/^(мне\s+)?(браузер|программу|приложение)\s+(?=\S)/i, (m) => /браузер/i.test(m) ? '' : '').trim();
  if (!rest || /\s(и|а потом|затем|then|and)\s/i.test(' ' + rest + ' ')) return null; // составные задачи — модели
  const url = /^(https?:\/\/\S+|(?:www\.)?[a-zа-я0-9-]+(?:\.[a-zа-я0-9-]+)*\.(?:ru|com|org|net|рф|io|ai|dev|su|info|me|app)(?:\/\S*)?)$/i.exec(rest);
  if (url) return { type: 'url', url: /^https?:/i.test(url[1]) ? url[1] : 'https://' + url[1] };
  for (const [re, names] of APPS) if (re.test(rest)) return { type: 'app', names, label: rest };
  return null;
}
module.exports = { parse };
