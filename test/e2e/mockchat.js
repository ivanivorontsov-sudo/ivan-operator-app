'use strict';
// Мок веб-чата ИИ для E2E: принимает картинку (файлом или вставкой), САМ находит на снимке зелёную мишень и отвечает JSON-кликом.
const http = require('http'); const fs = require('fs');
const LOG = process.env.MOCK_LOG || '/tmp/iop-e2e-mock.json'; const st = { turns: [] };
const PAGE = `<!doctype html><meta charset=utf-8><title>MockAI</title><body style="font-family:sans-serif">
<div id=msgs style="min-height:300px"></div>
<form id=f><input type=file id=file accept="image/*"><textarea id=t rows=4 cols=80 placeholder="Message"></textarea><button type=submit aria-label="Send">Send</button></form>
<script>
let pasted=null;
document.getElementById('t').addEventListener('paste',e=>{for(const it of e.clipboardData.items){if(it.type.startsWith('image/')){pasted=it.getAsFile();e.preventDefault();}}});
function find(file){return new Promise(res=>{if(!file)return res(null);const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);const d=x.getImageData(0,0,c.width,c.height).data;let sx=0,sy=0,n=0;for(let y=0;y<c.height;y+=2)for(let i=0;i<c.width;i+=2){const p=(y*c.width+i)*4;if(d[p]<60&&d[p+1]>170&&d[p+2]<60){sx+=i;sy+=y;n++}}res({w:c.width,h:c.height,n,cx:n?sx/n:null,cy:n?sy/n:null})};img.onerror=()=>res({err:1});img.src=URL.createObjectURL(file)})}
document.getElementById('f').onsubmit=async e=>{e.preventDefault();const t=document.getElementById('t');const text=t.value;t.value='';
 const file=document.getElementById('file').files[0]||pasted;const via=document.getElementById('file').files[0]?'upload':pasted?'paste':'none';pasted=null;document.getElementById('file').value='';
 const g=await find(file);const r=await fetch('/msg',{method:'POST',body:JSON.stringify({text:text.slice(-400),len:text.length,via,size:file?file.size:0,g})});const reply=await r.text();
 const m=document.createElement('div');m.className='markdown';const pre=document.createElement('pre');const code=document.createElement('code');code.textContent=reply;pre.appendChild(code);m.appendChild(pre);document.getElementById('msgs').appendChild(m)};
</script>`;
http.createServer((q, s) => {
  if (q.method === 'POST' && q.url === '/msg') { let b = ''; q.on('data', (c) => b += c); q.on('end', () => {
    const m = JSON.parse(b); const turn = st.turns.length + 1; let act;
    if (st.turns.some((t) => t.clicked)) act = { type: 'done', answer: 'E2E-DONE' };
    else if (m.g && m.g.n > 20) act = { type: 'click', x: Math.round(m.g.cx / m.g.w * 1000), y: Math.round(m.g.cy / m.g.h * 1000) };
    else act = { type: 'wait', seconds: 1 };
    st.turns.push({ turn, via: m.via, size: m.size, g: m.g, len: m.len, act, clicked: act.type === 'click' });
    fs.writeFileSync(LOG, JSON.stringify(st, null, 1));
    s.end('```json\n' + JSON.stringify({ observation: 'mock', thought: 'mock turn ' + turn, action: act }) + '\n```');
  }); return; }
  s.setHeader('content-type', 'text/html; charset=utf-8'); s.end(PAGE);
}).listen(+process.env.MOCK_PORT || 8766, '127.0.0.1', () => console.log('mock up'));
