'use strict';
// «Заготовки»: для сайтов, программ, ОС и движков берём готовый проект с GitHub и меняем только то, что просит пользователь.
// Поиск — открытый GitHub Search API (без токена, лимит 10 запросов/мин); лицензия — из ответа API; в проект пишется NOTICE.
const fs = require('fs');
const path = require('path');
const https = require('https');
const CATALOG = {
  os: [
    { repo: 'limine-bootloader/limine-c-template', why: 'минимальное ядро x86_64 на C с загрузчиком Limine', license: 'BSD-0/BSD-2 (см. репозиторий)' },
    { repo: 'cfenollosa/os-tutorial', why: 'пошаговая ОС с нуля (загрузчик, ядро, драйверы)', license: 'BSD-3-Clause' },
    { repo: 'szhou42/osdev', why: 'учебная ОС x86: память, процессы, ФС, графика', license: 'см. репозиторий' },
    { repo: 'buildroot/buildroot', why: 'сборка своего Linux-дистрибутива из готовых пакетов', license: 'GPL-2.0' },
    { repo: 'mit-pdos/xv6-riscv', why: 'учебная Unix-подобная ОС (RISC-V)', license: 'MIT' },
  ],
  engine: [
    { repo: 'raysan5/raylib', why: 'простая библиотека/движок для игр на C', license: 'Zlib' },
    { repo: 'godotengine/godot', why: 'полноценный игровой движок', license: 'MIT' },
    { repo: 'bevyengine/bevy', why: 'движок на Rust (ECS)', license: 'MIT/Apache-2.0' },
    { repo: 'phaserjs/phaser', why: '2D-движок для браузера', license: 'MIT' },
  ],
  site: [
    { repo: 'vitejs/vite', why: 'шаблоны create-vite (React/Vue/Svelte/vanilla)', license: 'MIT' },
    { repo: 'withastro/astro', why: 'быстрые сайты и блоги, шаблоны в examples/', license: 'MIT' },
    { repo: 'h5bp/html5-boilerplate', why: 'чистая HTML-заготовка без сборки', license: 'MIT' },
  ],
  program: [
    { repo: 'electron/electron-quick-start', why: 'настольная программа на Electron', license: 'CC0-1.0' },
    { repo: 'tauri-apps/tauri', why: 'лёгкие настольные программы (Rust + веб)', license: 'MIT/Apache-2.0' },
    { repo: 'android/compose-samples', why: 'примеры Android-приложений на Compose', license: 'Apache-2.0' },
  ],
};
function kindOf(req) {
  const t = String(req || '').toLowerCase();
  if (/(?<![\p{L}])(ос|os)(?![\p{L}])|операционн|ядр[оа]|kernel|загрузчик|дистрибутив|linux на|buildroot/u.test(t)) return 'os';
  if (/движ[оке]|engine|игр[уаы]|game/.test(t)) return 'engine';
  if (/сайт|лендинг|страниц|блог|интернет-магазин|website|landing|web/.test(t)) return 'site';
  return 'program';
}
function getJson(url, { timeout = 15000 } = {}) {
  return new Promise((res, rej) => {
    const rq = https.get(url, { headers: { 'User-Agent': 'IvanOperator', Accept: 'application/vnd.github+json' }, timeout }, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => { if (r.statusCode >= 400) return rej(new Error('GitHub ' + r.statusCode + ': ' + d.slice(0, 200))); try { res(JSON.parse(d)); } catch (e) { rej(e); } }); });
    rq.on('timeout', () => rq.destroy(new Error('тайм-аут'))); rq.on('error', rej);
  });
}
const OK_LICENSES = /^(mit|apache-2\.0|bsd-2-clause|bsd-3-clause|0bsd|isc|zlib|unlicense|cc0-1\.0|mpl-2\.0|gpl-2\.0|gpl-3\.0|lgpl-2\.1|lgpl-3\.0|agpl-3\.0)$/i;
function licenseNote(spdx) {
  if (!spdx || spdx === 'NOASSERTION') return 'Лицензия не указана — использовать нельзя без разрешения автора.';
  if (/^(gpl|agpl|lgpl)/i.test(spdx)) return `${spdx}: можно менять, но производный проект тоже должен быть открыт под ${spdx}.`;
  if (OK_LICENSES.test(spdx)) return `${spdx}: можно менять и распространять, сохранив уведомление об авторстве.`;
  return `${spdx}: проверьте условия лицензии.`;
}
async function search(req, { kind = kindOf(req), limit = 6, get = getJson } = {}) {
  const words = String(req).replace(/[^\p{L}\p{N}\s+-]/gu, ' ').split(/\s+/).filter((w) => /^[a-z0-9+-]{2,}$/i.test(w)).slice(0, 4).join(' ');
  const topic = { os: 'osdev', engine: 'game-engine', site: 'template', program: 'template' }[kind];
  const q = encodeURIComponent(`${words} topic:${topic}`.trim());
  let found = [];
  try { const j = await get(`https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=${limit}`); found = (j.items || []).map((r) => ({ repo: r.full_name, why: (r.description || '').slice(0, 160), stars: r.stargazers_count, license: r.license && r.license.spdx_id, updated: r.pushed_at, url: r.html_url })); } catch (e) { found = [{ error: e.message }]; }
  const cat = CATALOG[kind].map((c) => ({ ...c, curated: true, url: 'https://github.com/' + c.repo }));
  const all = [...cat, ...found.filter((f) => f.repo && !cat.some((c) => c.repo === f.repo))];
  return { kind, items: all.map((x) => ({ ...x, note: x.license ? licenseNote(String(x.license).split(/[ /(]/)[0]) : '' })), apiError: (found[0] || {}).error };
}
// безопасное скачивание: git clone --depth 1 без подмодулей и хуков (код не запускается)
function fetchArgs(repo, dest) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Неверное имя репозитория');
  return ['clone', '--depth', '1', '--no-recurse-submodules', '-c', 'core.hooksPath=/dev/null', `https://github.com/${repo}.git`, dest];
}
function writeNotice(dest, { repo, license, request }) {
  const t = `# Заготовка\n\nОснова: https://github.com/${repo}\nЛицензия: ${license || 'см. LICENSE в репозитории'}\n${licenseNote(license)}\n\nЗапрошенные изменения (меняется только это):\n${request}\n\nДата: ${new Date().toISOString()}\n`;
  fs.writeFileSync(path.join(dest, 'NOTICE-IVANOPERATOR.md'), t); return t;
}
function prompt(request, base) {
  return `РЕЖИМ «ЗАГОТОВКИ». Основа: ${base.repo} (${base.license || 'лицензия в LICENSE'}) в папке ${base.dest}. Меняй ТОЛЬКО то, что просит пользователь: «${request}». Не переписывай проект целиком, не удаляй LICENSE и NOTICE. Сначала сделай {"type":"checkpoint"}, после правок — {"type":"run_tests"}.`;
}
module.exports = { CATALOG, kindOf, search, fetchArgs, writeNotice, licenseNote, prompt };
