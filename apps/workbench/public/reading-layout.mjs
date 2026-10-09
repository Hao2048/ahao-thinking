let remembered=null;
export function captureReading(){const pane=document.querySelector('.document-display');if(pane)remembered={key:pane.dataset.readingKey,top:pane.scrollTop,list:document.querySelector('.document-list')?.scrollTop||0};}
export function bindReading(){const stage=document.querySelector('.reading-stage'),pane=document.querySelector('.document-display'),list=document.querySelector('.document-list');if(!stage||!pane)return;
 if(remembered?.key===pane.dataset.readingKey){pane.scrollTop=remembered.top;if(list)list.scrollTop=remembered.list;}
 pane.addEventListener('wheel',event=>{const offset=document.body.classList.contains('desktop')?38:0,distance=stage.getBoundingClientRect().top-offset;if(innerWidth>=900&&distance>1&&event.deltaY>0&&!event.ctrlKey){event.preventDefault();window.scrollBy(0,Math.min(distance,event.deltaY));}},{passive:false});
}
