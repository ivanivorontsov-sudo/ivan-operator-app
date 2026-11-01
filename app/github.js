'use strict';
// GitHub по токену из настроек. В тестах агента токен не берётся из process.env.
const https = require('https');
const fs = require('fs');
const path = require('path');

function tokenFrom(settings, dataDir) {
  if (settings && settings.githubToken) return String(settings.githubToken).trim();
  try {
    const p = path.join(dataDir || '', 'github-token.txt');
    if (p && fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  } catch {}
  // НАМЕРЕННО не читаем process.env.GITHUB_TOKEN — чтобы тестовый агент не трогал аккаунт Ивана
  return '';
}
function saveToken(dataDir, token) {
  const p = path.join(dataDir, 'github-token.txt');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(p, token || '', { mode: 0o600 });
}
function api(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com', path: urlPath, method,
      headers: {
        'User-Agent': 'IvanOperator', Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let d = ''; res.on('data', (c) => d += c); res.on('end', () => {
        let j; try { j = JSON.parse(d); } catch { j = { raw: d }; }
        if (res.statusCode >= 400) reject(Object.assign(new Error(`GitHub ${res.statusCode}: ${(j.message || d).slice(0, 200)}`), { status: res.statusCode }));
        else resolve(j);
      });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
function isDangerous(op, a) {
  return /delete|force|transfer|archive|remove/.test(op) || !!a.force || !!a.delete;
}
async function run(action, { settings, dataDir, confirm }) {
  const token = tokenFrom(settings, dataDir);
  if (!token) return { ok: false, text: 'Токен GitHub не задан в настройках программы.' };
  const op = String(action.op || action.subcommand || action.cmd || '').toLowerCase();
  if (isDangerous(op, action)) {
    const ok = confirm && await confirm(`github ${op} ${action.repo || action.name || ''}`, ['Разрушительная операция GitHub'], {});
    if (!ok) return { ok: false, text: 'Отменено пользователем.' };
  }
  try {
    if (op === 'create_repo' || op === 'create') {
      const r = await api('POST', '/user/repos', token, {
        name: action.name || action.repo, private: action.private !== false,
        description: action.description || 'Создано ИванОператором', auto_init: !!action.auto_init,
      });
      return { ok: true, text: `Репозиторий ${r.full_name}: ${r.html_url}` };
    }
    if (op === 'list_repos' || op === 'list') {
      const r = await api('GET', '/user/repos?per_page=30&sort=updated', token);
      return { ok: true, text: r.map((x) => `${x.full_name} (${x.private ? 'priv' : 'pub'})`).join('\n') };
    }
    if (op === 'release') {
      const [owner, repo] = String(action.repo).split('/');
      const r = await api('POST', `/repos/${owner}/${repo}/releases`, token, {
        tag_name: action.tag || 'v0.1.0', name: action.title || action.tag || 'Release',
        body: action.body || '', draft: !!action.draft,
      });
      return { ok: true, text: `Релиз: ${r.html_url}` };
    }
    return { ok: false, text: 'Неизвестная github-операция (create_repo|list_repos|release). Push — через run: git push.' };
  } catch (e) { return { ok: false, text: e.message }; }
}
module.exports = { run, tokenFrom, saveToken, isDangerous };
