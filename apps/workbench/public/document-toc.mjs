// Derive the index from rendered headings, never from fenced code or chart source.
export function bindDocumentToc(container){
 const nav=container.querySelector('.doc-toc'),content=container.querySelector('#doc-content');
 if(!nav||!content)return ()=>{};
 const headings=[...content.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(h=>!h.closest('.document-visual'));
 const label=document.createElement('h3');label.textContent='章节目录';nav.append(label);
 if(!headings.length){const empty=document.createElement('p');empty.className='doc-toc-empty';empty.textContent=content.querySelector('iframe')?'HTML 预览请使用文档标签查看章节目录':'当前内容暂无章节标题';nav.append(empty);return ()=>{};}
 const base=Math.min(...headings.map(h=>Number(h.tagName.slice(1))));
 const buttons=headings.map((heading,i)=>{
  heading.id=`report-section-${i+1}`;
  const button=document.createElement('button');button.type='button';button.textContent=heading.textContent.trim()||'未命名章节';button.title=button.textContent;
  button.style.setProperty('--toc-depth',Number(heading.tagName.slice(1))-base);
  button.setAttribute('aria-controls',heading.id);
  button.onclick=()=>{const top=content.scrollTop+heading.getBoundingClientRect().top-content.getBoundingClientRect().top-16;content.scrollTo({top:Math.max(0,top),behavior:'instant'});update();};
  nav.append(button);return button;
 });
 function update(){
  const top=content.getBoundingClientRect().top+24;
  let active=0;headings.forEach((h,i)=>{if(h.getBoundingClientRect().top<=top)active=i;});
  if(content.scrollTop>0&&content.scrollHeight-content.clientHeight-content.scrollTop<2)active=headings.length-1;
  buttons.forEach((b,i)=>{b.classList.toggle('current',i===active);if(i===active)b.setAttribute('aria-current','location');else b.removeAttribute('aria-current');});
 }
 content.addEventListener('scroll',update,{passive:true});
 const observer=new ResizeObserver(update);observer.observe(content);for(const h of headings)observer.observe(h);
 update();
 return ()=>{content.removeEventListener('scroll',update);observer.disconnect();for(const b of buttons)b.onclick=null;};
}
