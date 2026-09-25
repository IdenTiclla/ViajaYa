
const slides = [...document.querySelectorAll('.slide')];
const picker = document.querySelector('#selector');
const progress = document.querySelector('#progress-fill');
const previous = document.querySelector('#previous');
const next = document.querySelector('#next');
const overview = document.querySelector('#overview');
const reading = document.querySelector('#reading');
const documentView = document.querySelector('#document');
let current = 0;
let mode = 'slides';
slides.forEach((s,i) => { const option=document.createElement('option'); option.value=i; option.textContent=String(i+1).padStart(2,'0')+' · '+s.dataset.title.replace(/<br>/g,' '); picker.append(option); });
function show(index, focus=false){
  current = Math.max(0, Math.min(slides.length-1, index));
  slides.forEach((s,i) => {s.hidden=mode==='slides' && i!==current; if(mode==='overview'){s.setAttribute('tabindex','0');s.setAttribute('role','button');s.setAttribute('aria-label','Abrir diapositiva '+(i+1)+': '+s.dataset.title.replace(/<br>/g,' '));}else{s.removeAttribute('tabindex');s.removeAttribute('role');s.removeAttribute('aria-label');}});
  document.body.classList.toggle('overview',mode==='overview');
  document.body.classList.toggle('reading',mode==='document');
  documentView.hidden=mode!=='document';
  document.querySelector('#stage').hidden=mode==='document';
  previous.disabled=current===0;next.disabled=current===slides.length-1;
  picker.value=String(current);document.querySelector('#counter').textContent=(current+1)+' / '+slides.length;
  progress.style.width=((current+1)/slides.length*100)+'%';
  overview.setAttribute('aria-pressed',String(mode==='overview'));reading.setAttribute('aria-pressed',String(mode==='document'));
  overview.textContent=mode==='overview'?'Volver a diapositivas':'Ver todas';reading.textContent=mode==='document'?'Volver a diapositivas':'Plan completo';
  document.querySelector('#announcer').textContent=mode==='document'?'Plan completo':mode==='overview'?'Vista de todas las diapositivas':'Diapositiva '+(current+1)+' de '+slides.length+': '+slides[current].dataset.title.replace(/<br>/g,' ');
  const hash=mode==='document'?'#plan-completo':mode==='overview'?'#todas':'#diapositiva-'+(current+1);
  try{history.replaceState(null,'',hash);}catch(e){}
  if(focus && mode==='slides')slides[current].querySelector('h2').focus({preventScroll:true});
}
function navigate(index){mode='slides';show(index,true);window.scrollTo({top:0});}
previous.addEventListener('click',()=>navigate(current-1));next.addEventListener('click',()=>navigate(current+1));
picker.addEventListener('change',()=>navigate(Number(picker.value)));
overview.addEventListener('click',()=>{mode=mode==='overview'?'slides':'overview';show(current);window.scrollTo({top:0});});
reading.addEventListener('click',()=>{mode=mode==='document'?'slides':'document';show(current);window.scrollTo({top:0});});
slides.forEach((s,i)=>{s.addEventListener('click',e=>{if(mode==='overview'&&!e.target.closest('a'))navigate(i);});s.addEventListener('keydown',e=>{if(mode==='overview'&&e.target===s&&(e.key==='Enter'||e.key===' ')){e.preventDefault();navigate(i);}});});
document.addEventListener('keydown',e=>{
  if(e.ctrlKey || e.metaKey || e.altKey)return;
  if(e.key==='Escape' && mode!=='slides'){mode='slides';show(current,true);return;}
  if(e.target.closest('button,a,input,select,textarea'))return;
  if(mode!=='slides')return;
  if(['ArrowRight','ArrowDown','PageDown',' '].includes(e.key)){e.preventDefault();navigate(current+1);}
  if(['ArrowLeft','ArrowUp','PageUp'].includes(e.key)){e.preventDefault();navigate(current-1);}
  if(e.key==='Home'){e.preventDefault();navigate(0);}
  if(e.key==='End'){e.preventDefault();navigate(slides.length-1);}
});
document.querySelector('#print').addEventListener('click',()=>window.print());
document.querySelector('#download').addEventListener('click',()=>{
  const text=JSON.parse(document.querySelector('#plan-source').textContent);
  const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='production-launch-plan.md';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
const fsButton=document.querySelector('#fullscreen');
if(!document.documentElement.requestFullscreen){fsButton.hidden=true;}
fsButton.addEventListener('click',async()=>{try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();}catch(e){document.querySelector('#announcer').textContent='Puedes ampliar la ventana del navegador para presentar.';}});
window.addEventListener('hashchange',readHash);
function readHash(){const hash=location.hash; mode=hash==='#plan-completo'?'document':hash==='#todas'?'overview':'slides';const match=hash.match(/^#diapositiva-(\d+)$/);show(match?Number(match[1])-1:current);}
readHash();
