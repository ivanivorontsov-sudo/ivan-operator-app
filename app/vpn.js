'use strict';
// VPN/прокси для встроенных окон чатов.
// 1) Надёжно: встроенный прокси (session.setProxy) — socks5://, http://, https://.
// 2) Экспериментально: расширение Chrome Web Store по ID (скачивается самим пользователем при первом запуске,
//    файлы расширения в программу НЕ встраиваются). Electron не поддерживает chrome.proxy, поэтому
//    большинство VPN-расширений в Electron не работают — см. RESULTS.md.
const fs = require('fs'); const path = require('path'); const zlib = require('zlib');

function parseProxy(s) {
  s = String(s || '').trim(); if (!s) return null;
  if (!/^(socks5|socks4|socks|http|https):\/\/[^\s/:]+:\d{1,5}\/?$/i.test(s)) throw new Error('Прокси: формат socks5://хост:порт или http://хост:порт');
  return { proxyRules: s.replace(/\/$/, ''), proxyBypassRules: '<local>' };
}
async function applyProxy(ses, s) { const p = parseProxy(s); await ses.setProxy(p || { mode: 'system' }); return !!p; }

function crxToZip(buf) {
  if (buf.slice(0, 4).toString() !== 'Cr24') { if (buf.readUInt32LE(0) === 0x04034b50) return buf; throw new Error('Не CRX-файл'); }
  const ver = buf.readUInt32LE(4);
  const off = ver === 3 ? 12 + buf.readUInt32LE(8) : 16 + buf.readUInt32LE(8) + buf.readUInt32LE(12);
  return buf.slice(off);
}
function unzip(buf, dir) {
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Повреждённый архив');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
  const root = path.resolve(dir);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString(); p += 46 + nl + xl + cl;
    const out = path.resolve(root, name); if (!out.startsWith(root + path.sep)) continue; // защита от ../
    if (name.endsWith('/')) { fs.mkdirSync(out, { recursive: true }); continue; }
    const ds = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28); const data = buf.slice(ds, ds + csize);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, method === 8 ? zlib.inflateRawSync(data) : data);
  }
}
const crxUrl = (id, chromeVer = '130.0.0.0') => `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${chromeVer}&acceptformat=crx2,crx3&x=id%3D${id}%26uc`;
async function installExtension(dataDir, id) {
  if (!/^[a-p]{32}$/.test(id || '')) throw new Error('ID расширения — 32 буквы a–p (из адреса страницы в Chrome Web Store)');
  const r = await fetch(crxUrl(id, process.versions.chrome)); if (!r.ok) throw new Error('Скачать расширение не удалось: HTTP ' + r.status);
  const dir = path.join(dataDir, 'extensions', id); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  unzip(crxToZip(Buffer.from(await r.arrayBuffer())), dir);
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  return { dir, name: man.name, version: man.version, mv: man.manifest_version, usesProxyApi: (man.permissions || []).includes('proxy') };
}
async function loadExtension(ses, dataDir, id) {
  const dir = path.join(dataDir, 'extensions', id);
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) return null;
  return ses.loadExtension(dir, { allowFileAccess: false });
}
module.exports = { parseProxy, applyProxy, crxToZip, unzip, crxUrl, installExtension, loadExtension };
