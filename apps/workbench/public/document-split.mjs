export function sidebarWidth(value,total){
 const max=Math.max(96,Math.min(420,total-280)),min=Math.min(140,max);
 return Math.max(min,Math.min(max,Number.isFinite(value)?value:210));
}
export function bindDocumentSplit(container){
 const handle=container.querySelector('.doc-divider');
 if(!handle)return ()=>{};
 const key='ahao.document-sidebar-width';let width=210,drag=null;
 try{width=Number(localStorage.getItem(key))||210;}catch{}
 const apply=value=>{width=sidebarWidth(value,container.clientWidth);container.style.setProperty('--doc-list-width',width+'px');handle.setAttribute('aria-valuenow',Math.round(width));handle.setAttribute('aria-valuemin',Math.min(140,Math.max(96,container.clientWidth-280)));handle.setAttribute('aria-valuemax',Math.max(96,Math.min(420,container.clientWidth-280)));};
 const save=()=>{try{localStorage.setItem(key,String(width));}catch{}};
 const finish=event=>{if(!drag||(event&&event.pointerId!==undefined&&event.pointerId!==drag.id))return;const id=drag.id;drag=null;try{handle.releasePointerCapture(id);}catch{}container.classList.remove('resizing');save();};
 const down=event=>{if(event.button!==0)return;event.preventDefault();handle.focus({preventScroll:true});drag={id:event.pointerId,x:event.clientX,width};handle.setPointerCapture(event.pointerId);container.classList.add('resizing');};
 const move=event=>{if(drag&&event.pointerId===drag.id)apply(drag.width+event.clientX-drag.x);};
 const keyboard=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();apply(event.key==='Home'?140:event.key==='End'?420:width+(event.key==='ArrowRight'?16:-16));save();};
 const reset=()=>{apply(210);save();};
 handle.addEventListener('pointerdown',down);handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);handle.addEventListener('lostpointercapture',finish);handle.addEventListener('keydown',keyboard);handle.addEventListener('dblclick',reset);
 const blur=()=>finish();window.addEventListener('blur',blur);
 const observer=new ResizeObserver(()=>apply(width));observer.observe(container);apply(width);
 return ()=>{finish();observer.disconnect();window.removeEventListener('blur',blur);for(const [event,fn]of [['pointerdown',down],['pointermove',move],['pointerup',finish],['pointercancel',finish],['lostpointercapture',finish],['keydown',keyboard],['dblclick',reset]])handle.removeEventListener(event,fn);};
}
