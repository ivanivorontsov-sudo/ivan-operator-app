// 1.2.7: сборка Windows без wine. electron-builder → win-unpacked (без rcedit), resedit (MIT) ставит иконку и сведения о версии в exe,
// нативный makensis (из кэша electron-builder) собирает Setup.exe. Запуск: node scripts/build-win.js
'use strict';
const fs = require('fs'); const path = require('path'); const os = require('os'); const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..'); const pkg = require(path.join(root, 'package.json')); const V = pkg.version;
const dist = path.join(root, 'dist'); const un = path.join(dist, 'win-unpacked'); const exe = path.join(un, 'IvanOperator.exe');
if (!process.argv.includes('--skip-builder')) execFileSync(process.execPath, [require.resolve('electron-builder/cli.js'), '--win', 'dir', '--x64', '--publish', 'never', '-c.win.signAndEditExecutable=false'], { cwd: root, stdio: 'inherit' });
const ResEdit = require('resedit'); const PE = require('pe-library');
const data = fs.readFileSync(exe); const ex = PE.NtExecutable.from(data, { ignoreCert: true }); const res = PE.NtExecutableResource.from(ex);
const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(root, 'build', 'icon.ico')));
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, ico.icons.map((i) => i.data));
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty();
const [a, b, c] = V.split('.').map(Number); vi.setFileVersion(a, b, c, 0, 1033); vi.setProductVersion(a, b, c, 0, 1033);
vi.setStringValues({ lang: 1033, codepage: 1200 }, { ProductName: 'ИванОператор', FileDescription: 'ИванОператор', CompanyName: 'Иван Воронцов', LegalCopyright: 'Иван Воронцов', OriginalFilename: 'IvanOperator.exe', InternalName: 'IvanOperator', FileVersion: V, ProductVersion: V });
vi.outputToResourceEntries(res.entries); res.outputResource(ex); fs.writeFileSync(exe, Buffer.from(ex.generate()));
console.log('resedit: иконка и версия записаны в', exe);
const mk = path.join(os.homedir(), '.cache', 'electron-builder', 'nsis', 'nsis-3.0.4.1'); const out = path.join(dist, `IvanOperator-Setup-${V}.exe`);
execFileSync(path.join(mk, 'linux', 'makensis'), ['-V2', `-DVERSION=${V}`, `-DOUTFILE=${out}`, `-DSRC=${un}`, `-DICON=${path.join(root, 'build', 'icon.ico')}`, path.join(__dirname, 'win-setup.nsi')], { stdio: 'inherit', env: { ...process.env, NSISDIR: mk } });
console.log('Setup:', out, fs.statSync(out).size);
