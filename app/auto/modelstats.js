'use strict';
// Адаптивный выбор моделей: статистика успеха по типам задач, выбор лучшего ИИ-чата (сглаживание Лапласа + штраф за медленность).
// Встраивается в цепочку запасных 1.2.0: порядок цепочки сортируется по рейтингу для типа задачи.
const fs = require('fs');
const path = require('path');
const TYPES = [
  ['code', /код|программ|скрипт|функци|баг|ошибк.*(сборк|компил)|тест|python|javascript|node|java\b|kotlin|c\+\+|rust|git|репозитор|сайт|html|css|ядр|(?<!\p{L})ос(?!\p{L})|движ/iu],
  ['web', /https?:\/\/|сайт|браузер|страниц|chrome|firefox|ya\.ru|найди в интернете|загугли|форм[уаы]|тест на|onlinetestpad/i],
  ['files', /файл|папк|скопируй|перемести|переименуй|удали|архив|zip|документ/i],
  ['android', /android|телефон|adb|fastboot|смартфон|apk/i],
  ['office', /word|writer|excel|calc|таблиц|презентац|libreoffice|\.docx|\.xlsx|\.odt|\.ods/i],
  ['system', /установи|настрой|драйвер|службу|реестр|обновлени|диск|памят|процесс/i],
  ['research', /исследуй|изучи|отчёт|сравни|найди информацию|анализ/i],
];
function classify(text) { for (const [t, re] of TYPES) if (re.test(String(text || ''))) return t; return 'general'; }
class ModelStats {
  constructor(dir) { this.file = path.join(dir, 'model-stats.json'); try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.data = {}; } }
  save() { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.data)); } catch {} }
  record(type, prov, { ok, secs = 0, tokens = 0, hang = false } = {}) {
    const t = (this.data[type] = this.data[type] || {}); const r = (t[prov] = t[prov] || { n: 0, ok: 0, secs: 0, tokens: 0, hangs: 0, last: 0 });
    r.n++; if (ok) r.ok++; if (hang) r.hangs++; r.secs += secs; r.tokens += tokens; r.last = Date.now(); this.save(); return r;
  }
  score(type, prov) {
    const r = ((this.data[type] || {})[prov]) || ((this.data.general || {})[prov]);
    if (!r) return { score: 0.5, n: 0 };
    const p = (r.ok + 1) / (r.n + 2); const avg = r.n ? r.secs / r.n : 0; const slow = Math.min(0.15, avg / 3000); const hang = Math.min(0.2, (r.hangs / Math.max(1, r.n)) * 0.3);
    return { score: +(p - slow - hang).toFixed(4), n: r.n, rate: +(r.ok / Math.max(1, r.n)).toFixed(2), avgSec: Math.round(avg) };
  }
  // сортировка цепочки: первый (выбранный Иваном) остаётся первым, пока у него мало данных (<3) или он не хуже лучшего на 0.15
  rank(type, chain, idOf) {
    if (chain.length < 2) return chain;
    const sc = chain.map((c, i) => ({ c, i, ...this.score(type, idOf(c)) }));
    const first = sc[0]; const rest = sc.slice(1).sort((a, b) => b.score - a.score || a.i - b.i);
    if (first.n < 3 || first.score >= rest[0].score - 0.15) return [first.c, ...rest.map((x) => x.c)];
    return [...[first, ...rest].sort((a, b) => b.score - a.score || a.i - b.i).map((x) => x.c)];
  }
  table() { return Object.entries(this.data).flatMap(([type, m]) => Object.keys(m).map((prov) => ({ type, prov, ...this.score(type, prov), ...m[prov] }))).sort((a, b) => a.type.localeCompare(b.type) || b.score - a.score); }
}
module.exports = { ModelStats, classify, TYPES };
