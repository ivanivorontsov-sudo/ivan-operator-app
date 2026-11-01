'use strict';
// Встроенный локальный движок: llama.cpp (llama-server) + модель Qwen2.5-VL в формате GGUF.
// Одна кнопка: скачать движок и модель с прогрессом → запустить → следить (сторож перезапускает при падении).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const IS_WIN = process.platform === 'win32';
const PINNED = 'b11946';
const MODELS = {
  'qwen2.5vl-3b': { label: 'Qwen2.5-VL 3B (≈2,6 ГБ, ПК от 8 ГБ ОЗУ)', repo: 'ggml-org/Qwen2.5-VL-3B-Instruct-GGUF', file: 'Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf', mmproj: 'mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf', ctx: 8192 },
  'qwen2.5vl-7b': { label: 'Qwen2.5-VL 7B (≈5,5 ГБ, ПК от 16 ГБ ОЗУ или видеокарта 8 ГБ) — точнее', repo: 'ggml-org/Qwen2.5-VL-7B-Instruct-GGUF', file: 'Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf', mmproj: 'mmproj-Qwen2.5-VL-7B-Instruct-Q8_0.gguf', ctx: 16384 },
};
const PORT = 8091;

function hasGpu() {
  try { execFileSync(IS_WIN ? 'nvidia-smi.exe' : 'nvidia-smi', ['-L'], { stdio: 'pipe', timeout: 5000 }); return 'nvidia'; } catch {}
  if (!IS_WIN) { try { if (fs.readdirSync('/dev/dri').some((f) => f.startsWith('renderD')) && fs.existsSync('/usr/share/vulkan/icd.d') && fs.readdirSync('/usr/share/vulkan/icd.d').length) return 'vulkan'; } catch {} }
  return null;
}
function freeMemGB() {
  try {
    const t = fs.readFileSync('/proc/meminfo', 'utf8');
    const m = /MemAvailable:\s+(\d+)/.exec(t);
    if (m) return Number(m[1]) / 1024 / 1024;
  } catch {}
  return os.freemem() / 2 ** 30;
}
// На общем компьютере с другими ботами — только ≤3B. 7B только если свободно ≥10 ГБ и есть GPU.
function recommendModel() {
  const free = freeMemGB();
  if (free < 6) throw new Error('Мало свободной памяти (' + free.toFixed(1) + ' ГБ). Используйте бесплатный API, не локальную модель.');
  if (hasGpu() && free >= 10 && os.totalmem() / 2 ** 30 >= 15) return 'qwen2.5vl-7b';
  return 'qwen2.5vl-3b';
}

async function download(url, dest, onProgress, signal, label) {
  if (fs.existsSync(dest)) return dest;
  const tmp = dest + '.part';
  let start = 0; try { start = fs.statSync(tmp).size; } catch {}
  const r = await fetch(url, { headers: start ? { Range: `bytes=${start}-` } : {}, signal, redirect: 'follow' });
  if (!r.ok && r.status !== 206) throw new Error(`Загрузка ${label}: HTTP ${r.status}`);
  if (r.status !== 206) start = 0; // сервер не поддерживает докачку
  const total = start + Number(r.headers.get('content-length') || 0);
  const out = fs.createWriteStream(tmp, { flags: start ? 'a' : 'w' });
  let done = start, last = 0;
  for await (const chunk of r.body) {
    if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
    done += chunk.length;
    if (Date.now() - last > 400) { last = Date.now(); onProgress && onProgress({ status: `Скачиваю ${label}`, pct: total ? Math.round(done * 100 / total) : null, mb: Math.round(done / 1e6), totalMb: Math.round(total / 1e6) }); }
  }
  await new Promise((res, rej) => out.end((e) => e ? rej(e) : res()));
  fs.renameSync(tmp, dest);
  return dest;
}

async function engineAsset() {
  const gpu = hasGpu();
  const flavour = IS_WIN ? (gpu ? 'win-vulkan-x64' : 'win-cpu-x64') : (gpu ? 'ubuntu-vulkan-x64' : 'ubuntu-x64');
  const ext = IS_WIN ? '.zip' : '.tar.gz';
  try {
    const r = await fetch('https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=5', { headers: { 'user-agent': 'IvanOperator' } });
    for (const rel of await r.json()) {
      const a = (rel.assets || []).find((x) => x.name === `llama-${rel.tag_name}-bin-${flavour}${ext}`);
      if (a) return { tag: rel.tag_name, url: a.browser_download_url, name: a.name, gpu };
    }
  } catch {}
  return { tag: PINNED, url: `https://github.com/ggml-org/llama.cpp/releases/download/${PINNED}/llama-${PINNED}-bin-${flavour}${ext}`, name: `llama-${PINNED}-bin-${flavour}${ext}`, gpu };
}

function findServer(dir) {
  const want = IS_WIN ? 'llama-server.exe' : 'llama-server';
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop(); let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) { const p = path.join(d, e.name); if (e.isDirectory()) stack.push(p); else if (e.name === want) return p; }
  }
  return null;
}

class Engine {
  constructor(baseDir, log = () => {}) {
    this.dir = path.join(baseDir, 'engine'); this.proc = null; this.want = false; this.restarts = 0; this.log = log; this.cfg = null;
    fs.mkdirSync(this.dir, { recursive: true });
  }
  status() { return { installed: !!findServer(path.join(this.dir, 'bin')), running: !!this.proc, models: Object.keys(MODELS).filter((k) => fs.existsSync(path.join(this.dir, MODELS[k].file))), port: PORT, gpu: hasGpu(), recommended: recommendModel(), restarts: this.restarts }; }

  async install(modelId, onProgress, signal) {
    const m = MODELS[modelId] || MODELS[recommendModel()];
    const binDir = path.join(this.dir, 'bin');
    if (!findServer(binDir)) {
      const a = await engineAsset();
      const arc = await download(a.url, path.join(this.dir, a.name), onProgress, signal, 'движок llama.cpp ' + a.tag + (a.gpu ? ' (видеокарта)' : ' (процессор)'));
      onProgress && onProgress({ status: 'Распаковываю движок' });
      fs.mkdirSync(binDir, { recursive: true });
      execFileSync('tar', ['-xf', arc, '-C', binDir], { stdio: 'pipe' });
      fs.unlinkSync(arc);
      const srv = findServer(binDir); if (!srv) throw new Error('В архиве нет llama-server');
      if (!IS_WIN) fs.chmodSync(srv, 0o755);
    }
    const hf = (f) => `https://huggingface.co/${m.repo}/resolve/main/${f}?download=true`;
    await download(hf(m.file), path.join(this.dir, m.file), onProgress, signal, 'модель ' + m.label.split(' (')[0]);
    await download(hf(m.mmproj), path.join(this.dir, m.mmproj), onProgress, signal, 'модуль зрения');
    return m;
  }

  async start(modelId, onProgress) {
    const m = MODELS[modelId]; if (!m) throw new Error('Неизвестная модель ' + modelId);
    this.cfg = { modelId }; this.want = true;
    if (await this.healthy()) return true;
    this._spawn(m);
    for (let i = 0; i < 240; i++) { // загрузка модели до 2 минут
      await new Promise((r) => setTimeout(r, 500));
      if (await this.healthy()) { onProgress && onProgress({ status: 'Движок запущен' }); return true; }
      if (!this.proc) throw new Error('Движок завершился при запуске. Журнал: ' + this.tail());
    }
    throw new Error('Движок не ответил за 2 минуты. Журнал: ' + this.tail());
  }
  _spawn(m) {
    const srv = findServer(path.join(this.dir, 'bin'));
    const threads = Math.max(2, Math.min(16, os.cpus().length - 1));
    // Безопасные лимиты на общем ПК: контекст ≤4096, 1 слот, без cache-ram, GPU только если есть и памяти хватает
    const ctx = Math.min(4096, m.ctx || 4096);
    const ngl = hasGpu() && freeMemGB() >= 8 ? 99 : 0;
    const args = ['-m', path.join(this.dir, m.file), '--mmproj', path.join(this.dir, m.mmproj), '-c', String(ctx), '-np', '1', '--cache-ram', '0', '-t', String(threads), '--host', '127.0.0.1', '--port', String(PORT), '-ngl', String(ngl), '--temp', '0.1', '--no-webui', '--image-min-tokens', '128', '--image-max-tokens', '512'];
    const logf = fs.openSync(path.join(this.dir, 'server.log'), 'a');
    const env = { ...process.env }; if (!IS_WIN) env.LD_LIBRARY_PATH = path.dirname(srv) + (env.LD_LIBRARY_PATH ? ':' + env.LD_LIBRARY_PATH : '');
    this.proc = spawn(srv, args, { cwd: path.dirname(srv), stdio: ['ignore', logf, logf], env, windowsHide: true });
    this.log(`Движок запущен (pid ${this.proc.pid})`);
    this.proc.on('exit', (code) => {
      this.proc = null;
      if (this.want) {
        // сторож: перезапуск после падения (с паузой, не чаще 5 раз за 10 минут)
        this.restarts++; const now = Date.now(); this._rs = (this._rs || []).filter((t) => now - t < 600000); this._rs.push(now);
        this.log(`Движок упал (код ${code}). Перезапуск №${this.restarts}`);
        if (this._rs.length <= 5) setTimeout(() => this.want && !this.proc && this._spawn(m), 3000);
      }
    });
  }
  async healthy() { try { const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(2000) }); return r.ok; } catch { return false; } }
  // вызывается сторожем агента, когда локальная модель не отвечает
  async ensure() {
    if (!this.cfg) return false;
    if (await this.healthy()) return true;
    if (this.proc) { try { this.proc.kill('SIGKILL'); } catch {} await new Promise((r) => setTimeout(r, 1500)); }
    try { await this.start(this.cfg.modelId); return true; } catch (e) { this.log(String(e.message)); return false; }
  }
  stop() { this.want = false; if (this.proc) try { this.proc.kill(); } catch {} }
  tail() { try { return fs.readFileSync(path.join(this.dir, 'server.log'), 'utf8').slice(-600); } catch { return ''; } }
}

module.exports = { Engine, MODELS, PORT, recommendModel, hasGpu, download };
