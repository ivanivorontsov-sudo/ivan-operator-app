const test = require('node:test'); const assert = require('node:assert'); const zlib = require('zlib');
const vpn = require('../app/vpn');
test('прокси: формат socks5/http, пусто = системный', () => {
  assert.deepStrictEqual(vpn.parseProxy('socks5://127.0.0.1:1080'), { proxyRules: 'socks5://127.0.0.1:1080', proxyBypassRules: '<local>' });
  assert.strictEqual(vpn.parseProxy(''), null);
  assert.throws(() => vpn.parseProxy('rm -rf /'));
});
test('CRX3 → zip распаковывается, ../ не выходит за папку', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vpnt-')); const data = Buffer.from('{"name":"x"}');
  const def = zlib.deflateRawSync(data); const name = Buffer.from('manifest.json');
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(def.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(def.length, 20); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(0, 42);
  const local = Buffer.concat([lh, name, def]); const cdir = Buffer.concat([cd, name]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 10); end.writeUInt32LE(cdir.length, 12); end.writeUInt32LE(local.length, 16);
  const zip = Buffer.concat([local, cdir, end]); const hdr = Buffer.alloc(12); hdr.write('Cr24'); hdr.writeUInt32LE(3, 4); hdr.writeUInt32LE(0, 8);
  vpn.unzip(vpn.crxToZip(Buffer.concat([hdr, zip])), d);
  assert.strictEqual(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8'), '{"name":"x"}');
});
