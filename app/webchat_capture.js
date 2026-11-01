// Захват ответа ИИ из веб-чата (заимствовано из ИванКод/SiteBuilder capture.js v3).
(()=>{if(window.__pp&&window.__pp.v===4)return;
const host=window.__ppForce||location.host;
const SITE=/gemini/.test(host)?'gemini':/mistral/.test(host)?'mistral':/perplexity/.test(host)?'perplexity':/kimi/.test(host)?'kimi':/z\.ai/.test(host)?'glm':/duck/.test(host)?'duck':/chatgpt/.test(host)?'chatgpt':/deepseek/.test(host)?'deepseek':/giga/.test(host)?'gigachat':/qwen/.test(host)?'qwen':/claude/.test(host)?'claude':/grok/.test(host)?'grok':'other';
// Известные селекторы ответов ассистента (могут меняться — есть эвристика-резерв)
const SEL={deepseek:'.ds-markdown',claude:'.font-claude-response,.font-claude-message,[data-is-streaming] .standard-markdown',
 grok:'[class*=items-start] .message-bubble,.message-bubble',qwen:'.response-message-content,.qwen-markdown,#response-content-container,.chat-response-message',
 gigachat:'[class*=Markdown],[class*=markdown],[class*=assistant],[class*=bot-message],[class*=BotMessage],[data-author=assistant],[data-role=assistant]',
 gemini:'message-content .markdown,model-response .markdown,.model-response-text',mistral:'[data-message-author-role=assistant] .prose,.markdown-container-style',perplexity:'[id^=markdown-content],.prose',kimi:'.segment-assistant .markdown,.chat-content-item-assistant .markdown',glm:'.chat-assistant .markdown-prose,#response-content-container',duck:'[class*=message] [class*=markdown],.VrBPSncUavA1d7C9kAc5',chatgpt:'[data-message-author-role=assistant] .markdown',other:'.markdown,[class*=markdown],[data-message-author-role=assistant]'};
const GEN='.ds-markdown,.markdown,[class*=markdown],[class*=message-content],[class*=font-claude-response],.message-bubble,[data-message-author-role=assistant]';
const JUNK=/^(Войдите,? чтобы чат сохранился|Войти|Копировать|Скопировать|Copy|Copied|Скопировано|json|javascript|js|Ответ сгенерирован.*|ГигаЧат может ошибаться.*|.*может ошибаться.*проверяйте.*|Regenerate|Повторить|Поделиться|Share)$/i;
const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
const vis=e=>{if(!e||!e.getClientRects().length)return false;const s=getComputedStyle(e);return s.visibility!=='hidden'&&s.display!=='none'};
function ext(n){let o='';const w=x=>{if(x.nodeType===3){o+=x.nodeValue;return}if(x.nodeType!==1)return;const t=x.tagName;
 if(/^(BUTTON|SVG|svg|STYLE|SCRIPT|TEXTAREA|INPUT|NOSCRIPT|IMG|NAV|FOOTER)$/.test(t)||x.getAttribute('contenteditable')==='true'||x.getAttribute('role')==='button'&&!x.querySelector('pre,code'))return;
 if(t==='PRE'){o+='\n```\n'+x.textContent.replace(/\n$/,'')+'\n```\n';return}
 if(t==='BR'){o+='\n';return}
 const b=/^(DIV|P|LI|H[1-6]|TR|UL|OL|TABLE|BLOCKQUOTE|SECTION|ARTICLE|HEADER|DL|DT|DD|HR)$/.test(t);if(b)o+='\n';if(t==='LI')o+='• ';
 for(const c of x.childNodes)w(c);if(t==='TD'||t==='TH')o+='\t';if(b)o+='\n'};w(n);
 return o.split('\n').map(l=>l.replace(/[ \t\u00a0]+$/,'')).filter(l=>!JUNK.test(l.trim())).join('\n').replace(/\n{3,}/g,'\n\n').trim()}
function editor(){const c=[...document.querySelectorAll('textarea,[contenteditable=true],div[role=textbox]')].filter(vis);return c[c.length-1]||null}
function composer(ed){let e=ed;for(let i=0;i<7&&e&&e.parentElement;i++){e=e.parentElement;if(e.tagName==='FORM'||e.querySelectorAll('button').length>=2)return e}return ed&&ed.parentElement}
function busy(){if(SITE==='claude'&&document.querySelector('[data-is-streaming=true]'))return true;
 return [...document.querySelectorAll('button,[role=button]')].some(b=>vis(b)&&/(^|\W)(stop|остановить|прервать|стоп)/i.test((b.getAttribute('aria-label')||'')+' '+(b.title||'')+' '+(b.getAttribute('data-testid')||'')+' '+(b.innerText||'').slice(0,30)))}
const st={head:'',before:0,snap:'',t0:0,oldCodes:new Set(),oldAns:new Set()};
const key=t=>norm(t).slice(0,400);
function siteList(){try{return [...document.querySelectorAll(SEL[SITE])].filter(e=>!e.parentElement.closest(SEL[SITE]))}catch(e){return[]}}
function bySelector(){const a=siteList();if(!a.length)return '';const t=ext(a[a.length-1]);if(a.length<=st.before&&st.oldAns.has(key(t)))return '';return isPrompt(t)||st.oldAns.has(key(t))?'':t}
function isPrompt(t){const n=norm(t);return !n||st.head&&(n.startsWith(st.head)||st.head.startsWith(n.slice(0,60)))}
function heuristic(){const ed=editor(),cp=ed&&composer(ed);let best=null,bl=0;
 for(const e of document.body.querySelectorAll('*')){if(e.hasAttribute('data-pp-old')||!vis(e)||/^(SCRIPT|STYLE|BUTTON|svg|SVG|PRE|CODE|SPAN)$/.test(e.tagName))continue;
  if(cp&&(e.contains(cp)||cp.contains(e)))continue;const it=norm(e.innerText);if(it.length<15)continue;
  if(st.head&&it.includes(st.head.slice(0,50)))continue;if(st.snap.includes(it.slice(0,80))||st.oldAns.has(key(it)))continue;if(it.length>20000)continue;
  if(it.length>bl){bl=it.length;best=e}}
 return best?ext(best):''}
function lastAny(){const a=siteList();if(a.length)return {text:ext(a[a.length-1]),method:'selector:'+SITE};const g=[...document.querySelectorAll(GEN)].filter(vis);if(g.length)return {text:ext(g[g.length-1]),method:'generic'};return {text:'',method:'none'}}
window.__pp={v:3,focus(){const e=editor();if(!e)return false;e.focus();document.execCommand('selectAll',false);return true},site:SITE,ext,
 mark(p){st.head=norm(p).slice(0,80);st.before=siteList().length;st.snap=norm(document.body.innerText);st.t0=Date.now();st.oldCodes=new Set([...document.querySelectorAll('pre,code')].map(e=>key(e.textContent)));st.oldAns=new Set(siteList().map(e=>key(ext(e))));
  document.body.querySelectorAll('*').forEach(e=>e.setAttribute('data-pp-old',''));return JSON.stringify({site:SITE,before:st.before,editor:!!editor()})},
 async send(p,native){const ed=editor();if(!ed)return 'noinput';ed.focus();
  if(native){}else if(ed.tagName==='TEXTAREA'){const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(ed,p);ed.dispatchEvent(new Event('input',{bubbles:true}));ed.dispatchEvent(new Event('change',{bubbles:true}))}
  else{document.execCommand('selectAll',false);document.execCommand('insertText',false,p);if(norm(ed.innerText).length<5){ed.textContent=p;ed.dispatchEvent(new InputEvent('input',{bubbles:true,data:p,inputType:'insertText'}))}}
  await new Promise(r=>setTimeout(r,700));
  const cp=composer(ed)||document;const bs=[...cp.querySelectorAll('button,[role=button]')].filter(b=>vis(b)&&!b.disabled&&b.getAttribute('aria-disabled')!=='true');
  let btn=bs.find(b=>/send|отправ|submit/i.test((b.getAttribute('aria-label')||'')+' '+(b.title||'')+' '+(b.getAttribute('data-testid')||'')+' '+String(b.className||'')+' '+(b.id||'')+' '+(b.getAttribute('type')==='submit'?'submit':'')));
  if(!btn)btn=[...document.querySelectorAll('button[aria-label],button[type=submit]')].reverse().find(b=>vis(b)&&!b.disabled&&/send|отправ|submit/i.test((b.getAttribute('aria-label')||'')+(b.getAttribute('type')||'')));
  if(btn){btn.click();return 'ok:button'}
  for(const ty of ['keydown','keypress','keyup'])ed.dispatchEvent(new KeyboardEvent(ty,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));return 'ok:enter'},
 pending(){const ed=editor();if(!ed)return false;const v=ed.tagName==='TEXTAREA'?ed.value:ed.innerText;return norm(v).length>3&&st.head.startsWith(norm(v).slice(0,40))},
 clickLast(){const ed=editor();const cp=composer(ed)||document;const bs=[...cp.querySelectorAll('button,[role=button]')].filter(b=>vis(b)&&!b.disabled);const b=bs[bs.length-1];if(b){b.click();return 'clicked:'+(b.getAttribute('aria-label')||b.className||'?').toString().slice(0,40)}return 'nobutton'},
 poll(){let t='',m='selector:'+SITE;const al=siteList();const lastA=al.length>st.before||al.length&&!st.oldAns.has(key(ext(al[al.length-1])))?al[al.length-1]:null;{const root=lastA||document;const pr=[...root.querySelectorAll('pre,code')].filter(e=>!e.hasAttribute('data-pp-old')&&!st.oldCodes.has(key(e.textContent))&&vis(e)&&!e.closest('textarea,[contenteditable=true]')&&/[{}]/.test(e.textContent));if(pr.length){t='```\n'+pr[pr.length-1].textContent.trim()+'\n```';m='selector:newcode'}}if(!t)t=bySelector();if(!t){t=heuristic();m='heuristic'}return JSON.stringify({text:t,busy:busy(),method:m,n:al.length,newer:al.length>st.before,len:document.body.innerText.length})},
 grab(){const s=String(getSelection()||'').trim();if(s.length>10)return JSON.stringify({text:s,method:'selection'});
  const a=lastAny();if(a.text&&!isPrompt(a.text))return JSON.stringify(a);const h=heuristic();return JSON.stringify({text:h||a.text,method:h?'heuristic':a.method})}};
})();
