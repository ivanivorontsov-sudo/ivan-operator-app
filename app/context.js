'use strict';
// Файл инструкции + автоматически собранный раздел «Окружение», отправляются модели в каждом запросе.
const fs = require('fs');
const os = require('os');
const path = require('path');
const platform = require('./platform');

const ACTIONS_DOC = `## Доступные действия (поле "action")
- {"type":"click","x":X,"y":Y}  — левый клик. Также "double_click", "triple_click", "right_click", "middle_click", "move".
- {"type":"click","element":N}  — клик по центру элемента с красной меткой N (точнее всего).
- {"type":"drag","x":X,"y":Y,"x2":X2,"y2":Y2} — перетащить.
- {"type":"scroll","x":X,"y":Y,"direction":"down","amount":5} — прокрутка колесом (direction: up/down).
- {"type":"type","text":"текст"} — напечатать текст в поле с фокусом ("\\n" = Enter).
- {"type":"key","keys":"ctrl+l"} — сочетание клавиш (ctrl, alt, shift, win, enter, esc, tab, backspace, delete, up, down, left, right, home, end, pageup, pagedown, f1..f12, буквы).
- {"type":"open_app","name":"Firefox"} — запустить установленное приложение по названию.
- {"type":"run","command":"...","timeout":120} — выполнить команду в оболочке и получить вывод (без интерактивного ввода; таймаут до 3600 с).
- {"type":"run","command":"...","background":true} — запустить долгий процесс в фоне (сервер, IDE, сборка); вывод пишется в лог-файл.
- {"type":"browser_open","url":"https://..."} — открыть адрес во встроенном управляемом браузере (Chrome/Edge/Chromium через Playwright). Для работы с сайтами это НАДЁЖНЕЕ кликов по снимку.
- {"type":"browser_click","text":"видимый текст кнопки/ссылки"} или {"type":"browser_click","selector":"css"} — нажать элемент страницы.
- {"type":"browser_type","text":"...","field":"подпись/placeholder поля (необязательно)","enter":true} — ввести текст в поле страницы (без field — в поле ввода по умолчанию / с фокусом).
- {"type":"browser_select","field":"подпись","value":"видимый текст опции"} (или "selector") — выбрать в <select>.
- {"type":"browser_check","field":"подпись чекбокса/радиокнопки","checked":true} — отметить checkbox/radio.
- {"type":"browser_fill","selector":"#date","value":"2026-11-05"} — заполнить поле напрямую (даты, маски).
- {"type":"browser_upload","selector":"input[type=file]","path":"/путь/к/файлу"} — прикрепить файл.
- {"type":"browser_read"} — получить текст страницы и список полей/кнопок (чтобы прочитать ответ сайта целиком).
- {"type":"browser_key","keys":"Enter"}, {"type":"browser_back"} — клавиша на странице, назад.
- {"type":"android_devices"} — список подключённых Android-устройств (adb и fastboot).
- {"type":"android_setup"} — скачать официальные adb/fastboot (Google Platform-Tools), если их нет.
- {"type":"adb","args":["install","-r","app.apk"],"serial":"необязательно"} — команда adb (shell, install, push, pull, logcat -d, reboot bootloader …).
- {"type":"fastboot","args":["getvar","all"]} — команда fastboot. Прошивка/стирание/разблокировка ВСЕГДА требуют подтверждения Ивана в окне программы.
- {"type":"wait","seconds":2} — подождать.
- {"type":"zoom","x":X,"y":Y} — показать увеличенный фрагмент вокруг точки для точного прицеливания.
- {"type":"screenshot"} — просто сделать новый снимок.
- {"type":"ask_user","question":"..."} — спросить Ивана и ждать ответа.
- {"type":"run_recipe","name":"..."} — повторить сохранённый рецепт (список в разделе РЕЦЕПТЫ) без модели.
- {"type":"run_skill","name":"...","params":{"url":"..."}} — выполнить сохранённый навык (список в разделе НАВЫКИ) с параметрами.
- {"type":"checkpoint","label":"...","paths":["папка"]} — «машина времени»: сохранить состояние папки перед рискованной правкой (откат — во вкладке «Автономия»).
- {"type":"os","intent":"list_dir","args":{"path":"."}} — универсальная команда ОС (сама подбирается под Windows PowerShell / Linux / macOS). Намерения: list_dir, make_dir, remove_file, remove_dir, copy, move, read_file, find_files, search_text, open, which, env_get, processes, kill_process, disk_free, mem_info, os_info, net_check, download, unzip, zip, current_dir, home_dir, run_program.
- {"type":"run_tests","dir":"папка проекта"} — запустить тесты проекта, получить разобранные ошибки; исправь файлы и повтори (предел попыток задан в настройках).
- {"type":"audit","dir":"папка"} — аудит безопасности: секреты в файлах, исполняемые файлы, уязвимости зависимостей (npm audit / pip-audit / osv-scanner).
- {"type":"template_search","request":"что нужно сделать","kind":"site|program|os|engine"} — найти готовую основу на GitHub («заготовку»).
- {"type":"template_fetch","repo":"owner/name","request":"что изменить","dest":"папка"} — скачать заготовку (без запуска её кода) и получить правила: менять только то, что просил Иван, сохранить лицензию.
- {"type":"research","topic":"тема","pages":3} — автономный исследователь: поиск в интернете, чтение источников, отчёт со ссылками (сохраняется в папку reports).
- {"type":"swarm","task":"большая задача"} — рой: разбить задачу на части и раздать разным нейросетям, затем собрать итог (текстовые задачи: план, код, тексты).
- {"type":"parallel","task":"вопрос/задача","n":3,"dir":"папка","file":"путь/файл","test_command":"npm test"} — несколько вариантов решения параллельно, выбирается лучший (по тесту, если задан, иначе судья + согласие).
- {"type":"memory_search","query":"…"} / {"type":"memory_add","topic":"…","solution":"…","verified":true} — общая память проверенных решений.
- {"type":"discover","task":"что нужно сделать"} — какие программы есть на компьютере, что можно из них собрать и чего не хватает.
- {"type":"install_tool","tool":"ffmpeg"} — поставить недостающую программу менеджером пакетов (только с подтверждением Ивана).
- {"type":"analyze_screen","ai":false,"goal":"…"} — визуальный анализ: зависание, пустой экран, модальное окно, загрузка, ошибка; ai:true — дополнительно спросить ИИ по снимку.
- {"type":"screen_vote","goal":"что нужно сделать на экране","n":3} — при сомнениях: несколько вариантов следующего действия, голосование, выполнение лучшего с проверкой.
- {"type":"maintain","apply":false} — самообслуживание: память, диск, размер журналов; apply=true — удалить старое (с подтверждением).
- {"type":"build_agent","description":"какой нужен помощник","name":"…"} — создать специализированного помощника.
- {"type":"done","answer":"итог для Ивана"} — задача выполнена.`;

function userDir(app) { return app.getPath('userData'); }
function promptPath(app) { return path.join(userDir(app), 'system_prompt.md'); }
function ensurePrompt(app) {
  const p = promptPath(app);
  if (!fs.existsSync(p)) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.copyFileSync(path.join(__dirname, 'default_prompt.md'), p); }
  return p;
}
function readPrompt(app) { try { return fs.readFileSync(ensurePrompt(app), 'utf8'); } catch { return fs.readFileSync(path.join(__dirname, 'default_prompt.md'), 'utf8'); } }

let cachedEnv = null;
async function environment(app, info) {
  // info: { mon, img:{width,height}, coords, monitors }
  if (!cachedEnv) {
    let distro = '';
    if (!platform.IS_WIN) { try { distro = (/PRETTY_NAME="?([^"\n]+)/.exec(fs.readFileSync('/etc/os-release', 'utf8')) || [])[1] || ''; } catch {} }
    const apps = await platform.installedApps();
    const dev = ['git', 'python3', 'python', 'pip', 'pip3', 'node', 'npm', 'java', 'javac', 'gcc', 'g++', 'make', 'cmake', 'cargo', 'go', 'dotnet', 'code', 'codium', 'idea', 'pycharm', 'studio', 'adb', 'fastboot', 'docker',
      ...(platform.IS_WIN ? ['winget', 'choco', 'scoop'] : ['apt', 'apt-get', 'dnf', 'pacman', 'flatpak', 'snap', 'pkexec', 'sudo', 'xdg-open', 'google-chrome', 'chromium', 'firefox'])];
    const found = dev.filter((t) => { try { return platform.has(t); } catch { return false; } });
    let sudo = '';
    if (!platform.IS_WIN) { try { require('child_process').execFileSync('sudo', ['-n', 'true'], { stdio: 'ignore', timeout: 3000 }); sudo = 'sudo без пароля доступен'; } catch { sudo = found.includes('sudo') ? 'sudo требует пароль (неинтерактивно не сработает; используй pkexec для графического запроса или ask_user)' : 'sudo отсутствует'; } }
    let browser = ''; try { browser = require('./browser').findBrowser() || ''; } catch {}
    cachedEnv = { distro, apps, tools: platform.toolsAvailable(), found, sudo, browser };
  }
  const s = platform.sessionInfo();
  const home = os.homedir();
  const lines = [
    '## Окружение (собрано автоматически)',
    `- Дата и время: ${new Date().toLocaleString('ru-RU')}`,
    `- ОС: ${platform.IS_WIN ? 'Windows ' + os.release() : (cachedEnv.distro || 'Linux') + ', ядро ' + os.release()}; архитектура ${os.arch()}`,
    platform.IS_WIN ? `- Оболочка для run: ${platform.hasPowerShell() ? 'PowerShell' : 'cmd.exe (PowerShell недоступен)'}${platform.IS_WINE ? '. ВНИМАНИЕ: программа работает под Wine внутри Linux — UI Automation недоступен, окна рисует Wine; диски: C: (префикс Wine), Z: = корень Linux' : ''}` : `- Оболочка для run: bash; сеанс: ${s.kind}${s.desktop ? ', рабочий стол ' + s.desktop : ''}`,
    `- Пользователь: ${os.userInfo().username}; домашняя папка: ${home}; рабочий стол: ${path.join(home, platform.IS_WIN ? 'Desktop' : 'Рабочий стол')} (или Desktop)`,
    `- Мониторы: ${(info.monitors || []).map((m) => `${m.index + 1}) ${m.width}×${m.height}${m.primary ? ' основной' : ''}`).join('; ')}`,
    `- Работаем на мониторе ${info.mon.index + 1}: реальное разрешение ${info.mon.width}×${info.mon.height} физических пикселей.`,
    `- Снимок, который ты видишь: ${info.img.width}×${info.img.height} пикселей. ` + (info.coords === 'norm1000'
      ? 'КООРДИНАТЫ указывай в нормированной системе 0..1000 по каждой оси (0,0 — левый верхний угол, 1000,1000 — правый нижний).'
      : `КООРДИНАТЫ указывай в пикселях этого снимка: x от 0 до ${info.img.width - 1}, y от 0 до ${info.img.height - 1}. Программа сама пересчитает их в реальные.`),
    `- Инструменты на компьютере: ${cachedEnv.tools.join(', ') || '—'}`,
    `- Найденные программы в PATH: ${cachedEnv.found.join(', ') || '—'}`,
    cachedEnv.sudo ? `- Права администратора: ${cachedEnv.sudo}` : '',
    `- Управляемый браузер для browser_*: ${cachedEnv.browser || 'не найден (установи Chrome/Chromium/Edge)'}`,
    `- Установленные приложения (для open_app): ${cachedEnv.apps.slice(0, 120).join(', ')}${cachedEnv.apps.length > 120 ? ' …' : ''}`,
    '',
    ACTIONS_DOC,
  ];
  return lines.join('\n');
}

module.exports = { ensurePrompt, readPrompt, promptPath, environment, ACTIONS_DOC, resetEnvCache: () => { cachedEnv = null; } };
