// Мок-страницы для прикрепления: «+»-меню, скрепка с динамическим input, скрытый input, без загрузки (провал)
const prev = `function show(f){const u=URL.createObjectURL(f);const i=document.createElement('img');i.src=u;i.className='attach-preview';i.width=40;document.getElementById('pv').append(i)}`;
const base = (body, js) => `<!doctype html><meta charset=utf-8><body><div id=pv></div><textarea id=ta></textarea>${body}<button aria-label="Отправить">→</button><script>${prev};${js}</script>`;
module.exports = {
  plus: base(`<button id=plus>+</button><div id=menu style="display:none"><div role=menuitem id=mi>Загрузить фото</div></div>`,
    `plus.onclick=()=>menu.style.display='block';mi.onclick=()=>{const i=document.createElement('input');i.type='file';i.accept='image/*';i.style.display='none';i.onchange=()=>show(i.files[0]);document.body.append(i);i.click()}`),
  clip: base(`<button class="btn-paperclip" title="Прикрепить файл"><svg class="icon-clip"></svg></button>`,
    `document.querySelector('.btn-paperclip').onclick=()=>{const i=document.createElement('input');i.type='file';i.onchange=()=>show(i.files[0]);i.click()}`),
  hidden: base(`<input type=file accept="image/png,image/jpeg" style="display:none" id=f>`, `f.onchange=()=>show(f.files[0])`),
  paste: base(``, `ta.addEventListener('paste',e=>{const f=[...e.clipboardData.files][0];if(f){e.preventDefault();show(f)}})`),
  none: base(``, ``),
};
