'use strict';
// Предсказатель ошибок и аудитор безопасности: оценка риска действия до выполнения (правила + по желанию мнение модели),
// аудит зависимостей готовыми средствами (npm audit, pip-audit, osv-scanner) и проверка файлов на секреты.
const fs = require('fs');
const path = require('path');
const safety = require('../safety');

const KNOWN = /^(ls|dir|cat|type|echo|pwd|cd|mkdir|md|cp|copy|mv|move|find|grep|rg|head|tail|wc|sort|uniq|git|node|npm|npx|python3?|pip3?|py|cargo|go|java|javac|gradle|make|cmake|gcc|g\+\+|clang|rustc|tsc|pytest|code|xdg-open|open|start|explorer|notepad|get-childitem|get-content|set-location|new-item|copy-item|move-item|test-path|write-output|select-string|where|which|whoami|hostname|uname|date|df|free|ps|tasklist|top|htop|tar|zip|unzip|7z|curl|wget|invoke-webrequest|iwr|ping|ssh|scp|docker|adb|fastboot|code|firefox|chrome|google-chrome|libreoffice|soffice|xdotool|powershell|pwsh|cmd|bash|sh|systemctl|apt|apt-get|dnf|pacman|brew|winget|choco|rm|del|rmdir|rd|remove-item|chmod|chown|sudo|reg|icacls|takeown|runas|kill|taskkill|pkill)$/i;
const RULES = [
  { re: /\b(curl|wget|iwr|invoke-webrequest)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b|\biex\b.*\b(iwr|invoke-webrequest|downloadstring)\b/i, w: 80, why: 'Скачивание и запуск скрипта из интернета без проверки' },
  { re: /\brm\s+-\w*r\w*f|\brm\s+-\w*f\w*r|\bremove-item\b.*-recurse.*-force|\brd\s+\/s|\brmdir\s+\/s|\bdel\s+\/[sq]/i, w: 45, why: 'Рекурсивное удаление без подтверждения' },
  { re: /\b(rm|del|remove-item|unlink|rmdir|rd)\b/i, w: 25, why: 'Удаление файлов' },
  { re: /\breg(\.exe)?\s+(add|delete|import)\b|\bset-itemproperty\b.*\bhk(lm|cu)|\bnew-itemproperty\b|\bremove-itemproperty\b/i, w: 55, why: 'Изменение реестра Windows' },
  { re: /\bsudo\b|\brunas\b|\bstart-process\b.*-verb\s+runas|\bpkexec\b|\bdoas\b/i, w: 40, why: 'Запуск с правами администратора' },
  { re: /\bchmod\b|\bchown\b|\bicacls\b|\btakeown\b|\bset-acl\b|\bsetfacl\b/i, w: 30, why: 'Изменение прав доступа' },
  { re: /\bchmod\s+(-R\s+)?(777|\+s|u\+s|g\+s)/i, w: 30, why: 'Опасные права (777 или setuid)' },
  { re: /\b(curl|wget|iwr|invoke-webrequest|scp|ssh|ftp|nc|ncat|netcat|rsync)\b/i, w: 20, why: 'Сетевое действие' },
  { re: /\b(curl|wget)\b.*(-d|--data|-F|--upload-file|-T)\b|invoke-webrequest.*-method\s+post/i, w: 30, why: 'Отправка данных в сеть' },
  { re: /\b(npm|pip3?|cargo|gem|go)\s+(i|install|add|get)\b|\b(apt|apt-get|dnf|pacman|brew|winget|choco)\s+(install|-S)\b/i, w: 20, why: 'Установка пакетов (сторонний код)' },
  { re: /\b(systemctl|service|sc(\.exe)?)\s+(stop|disable|delete|mask)\b|\bset-service\b|\bstop-service\b/i, w: 40, why: 'Остановка/отключение служб' },
  { re: /\b(kill|pkill|killall|taskkill|stop-process)\b/i, w: 30, why: 'Завершение процессов (могут быть чужие)' },
  { re: /\bgit\s+(push\s+.*(-f|--force)|reset\s+--hard|clean\s+-\w*f)/i, w: 45, why: 'Необратимая операция git' },
  { re: /\b(crontab|schtasks|at)\b|\bregister-scheduledtask\b|\/etc\/(systemd|init\.d|rc\.local)|\\startup\\/i, w: 40, why: 'Автозапуск/планировщик (закрепление в системе)' },
  { re: /\b(set-mppreference|netsh\s+advfirewall|ufw\s+disable|iptables\s+-F|setenforce\s+0)\b/i, w: 70, why: 'Отключение защиты (антивирус/файрвол)' },
  { re: /(id_rsa|id_ed25519|\.ssh\/|\.aws\/credentials|\.env\b|cookies\.sqlite|login data|wallet\.dat|\.gnupg)/i, w: 50, why: 'Обращение к ключам, паролям или cookies' },
  { re: />\s*\/etc\/|\bC:\\Windows\\System32\b/i, w: 50, why: 'Запись в системные папки' },
  { re: /\.(exe|msi|bat|ps1|scr|vbs|sh|AppImage)\b.*\b(downloads|temp|tmp)\b|\b(downloads|temp|tmp)\b.*\.(exe|msi|bat|ps1|scr|vbs|AppImage)\b/i, w: 35, why: 'Запуск исполняемого файла из загрузок/временной папки' },
];
const BROWSER = [
  { re: /оплат|купить|pay|checkout|заказ|order|перевод|transfer/i, w: 70, why: 'Оплата или заказ' },
  { re: /удал|delete|remove/i, w: 40, why: 'Удаление на сайте' },
  { re: /отправ|send|submit|опублик|post|publish/i, w: 30, why: 'Отправка/публикация на сайте' },
  { re: /парол|password|card|карт|cvv|cvc/i, w: 50, why: 'Пароль или данные карты' },
];
function level(score) { return score >= 80 ? 'critical' : score >= 55 ? 'high' : score >= 25 ? 'medium' : 'low'; }
const RU_LEVEL = { low: 'низкий', medium: 'средний', high: 'высокий', critical: 'критический' };
// сочетание правил: max + 15% остальных (несколько признаков риска усиливают оценку), предел 100
function combine(ws) { if (!ws.length) return 0; const s = ws.slice().sort((a, b) => b - a); return Math.min(100, Math.round(s[0] + s.slice(1).reduce((a, b) => a + b, 0) * 0.15)); }
function firstWord(cmd) { const m = String(cmd).trim().replace(/^(sudo|nice|nohup|env\s+\S+=\S+)\s+/, '').match(/^["']?([^\s"']+)/); return m ? path.basename(m[1]).replace(/\.exe$/i, '') : ''; }

function assessCommand(cmd) {
  cmd = String(cmd || ''); const reasons = []; const ws = [];
  const crit = safety.check(cmd); if (crit) for (const w of crit) { reasons.push(w); ws.push(95); }
  for (const r of RULES) if (r.re.test(cmd)) { reasons.push(r.why); ws.push(r.w); }
  for (const part of cmd.split(/&&|\|\||;|\|/)) { const fw = firstWord(part); if (fw && !KNOWN.test(fw) && /^(\.{0,2}\/|[A-Za-z]:\\)|\.(exe|sh|bat|ps1|AppImage|bin|run)$/i.test(part.trim().split(/\s+/)[0] || '')) { reasons.push('Неизвестная программа: ' + fw); ws.push(35); } }
  const score = combine(ws); return { score, level: level(score), reasons: [...new Set(reasons)] };
}
function assess(a = {}) {
  const T = a.type || '';
  if (T === 'run') return assessCommand(a.command);
  if (T === 'os') { try { const { build } = require('./osexec'); const r = assessCommand(build(a.intent, a.args || {}).command);
      const tgt = String((a.args || {}).path || (a.args || {}).from || '').trim();
      if (/^(remove_|move$)/.test(a.intent || '') && (/^(\/|~\/?|\$HOME\/?|[A-Za-z]:\\?|\/(bin|boot|etc|lib|lib64|opt|root|sbin|srv|usr|var|home|sys|proc|dev)\/?|[A-Za-z]:\\(windows|users|program files)\\?)$/i.test(tgt) || tgt === require('os').homedir())) { r.score = 100; r.level = 'critical'; r.reasons.unshift('Удаление/перенос системной или домашней папки'); }
      if (/^(remove_dir|remove_file|kill_process|move)$/.test(a.intent || '') && r.score < 60) { r.score = 60; r.level = level(60); r.reasons.unshift('Необратимое изменение (удаление/перенос/завершение процесса)'); }
      return r; } catch (e) { return { score: 30, level: 'medium', reasons: ['Не удалось разобрать намерение: ' + e.message] }; } }
  if (T === 'adb' || T === 'fastboot') return assessCommand(T + ' ' + [].concat(a.args || []).join(' '));
  if (/^browser_(click|type|fill|key|submit)/.test(T)) { const t = [a.text, a.selector, a.name, a.value, a.label].filter(Boolean).join(' '); const reasons = [], ws = []; for (const r of BROWSER) if (r.re.test(t)) { reasons.push(r.why); ws.push(r.w); } const score = combine(ws); return { score, level: level(score), reasons }; }
  if (T === 'template_fetch') return { score: 20, level: 'low', reasons: ['Скачивание стороннего кода (только исходники, без запуска)'] };
  return { score: 0, level: 'low', reasons: [] };
}
// Мнение модели (по желанию): модель возвращает {"risk":0..100,"why":"..."}; итог — максимум из правил и модели
async function assessWithModel(a, chat) {
  const base = assess(a); if (!chat) return base;
  try {
    const t = await chat(`Оцени риск действия на компьютере пользователя от 0 до 100 (потеря данных, безопасность, необратимость, деньги). Ответь только JSON {"risk":N,"why":"кратко"}.\nДействие: ${JSON.stringify(a).slice(0, 1500)}`);
    const m = String(t).match(/\{[^{}]*"risk"\s*:\s*(\d+)[^{}]*\}/); if (!m) return base;
    const j = JSON.parse(m[0]); const s = Math.max(0, Math.min(100, Number(j.risk) || 0));
    if (s > base.score) return { score: s, level: level(s), reasons: [...base.reasons, 'Модель: ' + String(j.why || '').slice(0, 200)], model: s };
    return { ...base, model: s };
  } catch { return base; }
}
const needsConfirm = (r, threshold = 55) => r.score >= threshold;

// ── Аудит ───────────────────────────────────────────────────────────────
const SECRET_RES = [
  [/-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, 'Закрытый ключ'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'Ключ AWS'], [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'Токен GitHub'], [/\bgithub_pat_[A-Za-z0-9_]{50,}/, 'Токен GitHub'],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/, 'Ключ API (sk-…)'], [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'Токен Slack'], [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Ключ Google API'],
  [/(password|passwd|pwd|secret|token|api_?key)\s*[:=]\s*["'][^"'\s]{8,}["']/i, 'Пароль/секрет в коде'],
];
function auditFiles(dir, { maxFiles = 5000 } = {}) {
  const { TimeMachine } = require('./timemachine'); const findings = [];
  let files = []; try { files = new TimeMachine(path.join(require('os').tmpdir(), 'ivan-tm-audit')).walk(dir).slice(0, maxFiles); } catch (e) { return [{ file: dir, kind: 'error', text: e.message }]; }
  for (const f of files) {
    const p = path.join(dir, f.rel);
    if (/\.(exe|dll|scr|bat|vbs|ps1|msi|so|dylib|bin|jar|apk)$/i.test(f.rel)) findings.push({ file: p, kind: 'binary', text: 'Исполняемый/двоичный файл — проверьте происхождение' });
    if (f.mode & 0o002) findings.push({ file: p, kind: 'perm', text: 'Файл доступен на запись всем (o+w)' });
    if (f.size > 2 ** 20 || /\.(png|jpe?g|gif|webp|zip|gz|7z|pdf|ico|woff2?|ttf|mp[34]|apk|jar)$/i.test(f.rel)) continue;
    let t; try { t = fs.readFileSync(p, 'utf8'); } catch { continue; }
    for (const [re, what] of SECRET_RES) if (re.test(t)) { findings.push({ file: p, kind: 'secret', text: what }); break; }
  }
  return findings;
}
// Готовые сканеры зависимостей. runner(cmd, args, cwd) → {code, output}
async function auditDeps(dir, runner, has) {
  const out = [];
  const tryRun = async (name, cmd, args, parse) => { if (has && !(await has(cmd))) { out.push({ tool: name, skipped: 'не установлен' }); return; } try { const r = await runner(cmd, args, dir); out.push({ tool: name, ...parse(r.output || '') }); } catch (e) { out.push({ tool: name, error: String(e.message || e).slice(0, 300) }); } };
  if (fs.existsSync(path.join(dir, 'package-lock.json')) || fs.existsSync(path.join(dir, 'package.json')))
    await tryRun('npm audit', 'npm', ['audit', '--json', '--omit=dev'], (o) => { try { const j = JSON.parse(o); const v = (j.metadata && j.metadata.vulnerabilities) || {}; return { vulns: v, total: v.total != null ? v.total : Object.keys(j.vulnerabilities || {}).length }; } catch { return { raw: o.slice(0, 500) }; } });
  if (['requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py'].some((f) => fs.existsSync(path.join(dir, f))))
    await tryRun('pip-audit', 'pip-audit', ['-f', 'json', ...(fs.existsSync(path.join(dir, 'requirements.txt')) ? ['-r', path.join(dir, 'requirements.txt')] : [])], (o) => { try { const j = JSON.parse(o); const d = j.dependencies || j; return { total: d.reduce((n, x) => n + ((x.vulns || []).length), 0) }; } catch { return { raw: o.slice(0, 500) }; } });
  await tryRun('osv-scanner', 'osv-scanner', ['--format', 'json', '-r', dir], (o) => { try { const j = JSON.parse(o); return { total: (j.results || []).reduce((n, r) => n + (r.packages || []).reduce((m, p) => m + (p.vulnerabilities || []).length, 0), 0) }; } catch { return { raw: o.slice(0, 500) }; } });
  return out;
}
function auditSummary(files, deps) {
  const l = [];
  const sec = files.filter((f) => f.kind === 'secret'); if (sec.length) l.push(`Секреты в файлах: ${sec.length} (${sec.slice(0, 5).map((f) => path.basename(f.file) + ' — ' + f.text).join('; ')})`);
  const bin = files.filter((f) => f.kind === 'binary'); if (bin.length) l.push(`Исполняемые/двоичные файлы: ${bin.length}`);
  const perm = files.filter((f) => f.kind === 'perm'); if (perm.length) l.push(`Файлы с записью для всех: ${perm.length}`);
  for (const d of deps) l.push(`${d.tool}: ` + (d.skipped ? 'пропущен (' + d.skipped + ')' : d.error ? 'ошибка ' + d.error : (d.total != null ? 'уязвимостей ' + d.total : 'см. отчёт')));
  return l.length ? l.join('\n') : 'Проблем не найдено.';
}
module.exports = { assess, assessCommand, assessWithModel, needsConfirm, level, RU_LEVEL, auditFiles, auditDeps, auditSummary };
