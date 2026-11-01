'use strict';
// Автотестировщик: определить команду тестов → запустить → разобрать ошибки → модель исправляет → повтор.
// Предел попыток + бюджет токенов 1.2.0 (TokenMeter). Разбор формата ошибок — по образцу problem matchers VS Code.
const fs = require('fs');
const path = require('path');

function detect(dir) {
  const ex = (f) => fs.existsSync(path.join(dir, f));
  if (ex('package.json')) { try { const p = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); if (p.scripts && p.scripts.test && !/no test specified/.test(p.scripts.test)) return { cmd: 'npm test', kind: 'node' }; } catch {} }
  if (ex('pytest.ini') || ex('pyproject.toml') || ex('setup.cfg') || ex('tests') && fs.readdirSync(dir).some((f) => f.endsWith('.py'))) return { cmd: 'python -m pytest -q', kind: 'python' };
  if (ex('Cargo.toml')) return { cmd: 'cargo test', kind: 'rust' };
  if (ex('go.mod')) return { cmd: 'go test ./...', kind: 'go' };
  if (ex('gradlew')) return { cmd: (process.platform === 'win32' ? 'gradlew.bat' : './gradlew') + ' test', kind: 'gradle' };
  if (ex('CMakeLists.txt')) return { cmd: 'cmake -S . -B build && cmake --build build && ctest --test-dir build --output-on-failure', kind: 'cmake' };
  if (ex('Makefile')) return { cmd: 'make test', kind: 'make' };
  return null;
}
const MATCHERS = [
  { tool: 'tsc', re: /^(.+?\.[cm]?tsx?)\((\d+),(\d+)\):\s+error\s+(TS\d+:.*)$/gm, f: (m) => ({ file: m[1], line: +m[2], col: +m[3], msg: m[4] }) },
  { tool: 'gcc', re: /^(.+?\.(?:c|cc|cpp|h|hpp|rs|go|java|kt|S|asm)):(\d+):(?:(\d+):)?\s*(?:fatal\s+)?error:?\s*(.*)$/gm, f: (m) => ({ file: m[1], line: +m[2], col: +(m[3] || 0), msg: m[4] }) },
  { tool: 'rustc', re: /^error(?:\[E\d+\])?: (.*)\n\s+--> (.+?):(\d+):(\d+)/gm, f: (m) => ({ file: m[2], line: +m[3], col: +m[4], msg: m[1] }) },
  { tool: 'python', re: /File "(.+?)", line (\d+)[^\n]*\n(?:.*\n){0,3}?(\w+(?:Error|Exception)\b.*)/g, f: (m) => ({ file: m[1], line: +m[2], msg: m[3] }) },
  { tool: 'pytest', re: /^(?:FAILED|ERROR) (\S+?)(?:::(\S+))? - (.*)$/gm, f: (m) => ({ file: m[1], test: m[2], msg: m[3] }) },
  { tool: 'node:test', re: /^not ok \d+ - (.+)$[\s\S]*?(?:error: '?(.+?)'?\n)?[\s\S]*?(?:location: '(.+?):(\d+):\d+')?/gm, f: (m) => ({ test: m[1], msg: m[2] || 'тест не прошёл', file: m[3], line: m[4] ? +m[4] : undefined }) },
  { tool: 'node:test', re: /^\s*✖ (.+?) \([\d.]+m?s\)\n\s+(\w*Error[^\n]*)?/gm, f: (m) => ({ test: m[1], msg: m[2] || 'тест не прошёл' }) },
  { tool: 'node', re: /^(\w*Error): (.*)\n\s+at .*?\(?((?:\/|[A-Za-z]:\\)[^():]+):(\d+):(\d+)\)?/gm, f: (m) => ({ file: m[3], line: +m[4], col: +m[5], msg: m[1] + ': ' + m[2] }) },
  { tool: 'jest', re: /^\s*● (.+?)\n\n([\s\S]*?)\n\n/gm, f: (m) => ({ test: m[1], msg: m[2].trim().split('\n')[0] }) },
  { tool: 'go', re: /^--- FAIL: (\S+).*\n\s+(\S+?\.go):(\d+): (.*)$/gm, f: (m) => ({ test: m[1], file: m[2], line: +m[3], msg: m[4] }) },
];
function parseErrors(out) {
  const res = []; const seen = new Set(); out = String(out || '').replace(/\x1b\[[0-9;]*m/g, '');
  for (const mt of MATCHERS) { mt.re.lastIndex = 0; let m; while ((m = mt.re.exec(out))) { const e = { tool: mt.tool, ...mt.f(m) }; const k = [e.file, e.line, e.msg, e.test].join('|'); if (!seen.has(k)) { seen.add(k); res.push(e); } if (res.length >= 50) return res; } }
  return res;
}
function summarize(errs, out, max = 2500) {
  if (!errs.length) return String(out || '').slice(-max);
  return errs.slice(0, 15).map((e) => `- ${e.file ? e.file + (e.line ? ':' + e.line : '') + ' ' : ''}${e.test ? '[' + e.test + '] ' : ''}${e.msg}`).join('\n').slice(0, max);
}
// loop: run() → {code, output}; fix({errors, summary, attempt}) → правит файлы (через модель); meter — TokenMeter (необязательно)
async function loop({ run, fix, maxIter = 5, meter = null, signal = null, onEvent = () => {} }) {
  const history = []; const sums = [];
  for (let i = 1; i <= maxIter + 1; i++) {
    if (signal && signal.aborted) return { ok: false, stopped: true, attempts: i - 1, history };
    const r = await run(); const errors = r.code === 0 ? [] : parseErrors(r.output); const sum = summarize(errors, r.output);
    history.push({ attempt: i, code: r.code, errors: errors.length }); onEvent({ attempt: i, code: r.code, errors });
    if (r.code === 0) return { ok: true, attempts: i, history };
    if (i > maxIter) return { ok: false, why: `Тесты не прошли после ${maxIter} исправлений`, attempts: i, last: sum, history };
    if (meter && meter.over()) return { ok: false, budget: true, why: 'Достигнут бюджет токенов задачи', attempts: i, last: sum, history };
    sums.push(sum); if (sums.length >= 3 && sums.slice(-3).every((x) => x === sum)) return { ok: false, why: 'Одни и те же ошибки 3 раза подряд — остановлено', attempts: i, last: sum, history };
    await fix({ errors, summary: sum, attempt: i, output: r.output });
  }
}
module.exports = { detect, parseErrors, summarize, loop };
