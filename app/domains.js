'use strict';
// Белый/чёрный список доменов (идея Browser Use allowed_domains / prohibited_domains).
function hostMatch(host, pat) {
  pat = String(pat).trim().toLowerCase().replace(/^[a-z*]+:\/\//, '').replace(/\/.*$/, '');
  host = String(host).toLowerCase().replace(/^www\./, '');
  if (!pat) return false; if (pat === '*') return true;
  if (pat.startsWith('*.')) { const base = pat.slice(2).replace(/^www\./, ''); return host === base || host.endsWith('.' + base); }
  return host === pat.replace(/^www\./, '');
}
function checkUrl(url, { allowed = [], blocked = [] } = {}) {
  let u; try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return /^(about|data):$/.test(u.protocol) ? null : `Протокол ${u.protocol} запрещён.`;
  if (allowed.length && !allowed.some((p) => hostMatch(u.hostname, p))) return `Домен ${u.hostname} не входит в белый список (${allowed.join(', ')}).`;
  if (!allowed.length && blocked.some((p) => hostMatch(u.hostname, p))) return `Домен ${u.hostname} в чёрном списке.`;
  return null;
}
function checkAction(a, lists) {
  if (!a || !/^browser_(open|navigate|goto)$/.test(a.type)) return null;
  for (const k of ['url', 'href']) if (a[k]) { const e = checkUrl(/^[a-z]+:/i.test(a[k]) ? a[k] : 'https://' + a[k], lists); if (e) return e; }
  return null;
}
const parseList = (s) => (Array.isArray(s) ? s : String(s || '').split(/[\s,;]+/)).map((x) => x.trim()).filter(Boolean);
module.exports = { hostMatch, checkUrl, checkAction, parseList };
