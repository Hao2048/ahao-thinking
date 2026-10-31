import test from 'node:test';
import assert from 'node:assert/strict';
import {bindDocumentToc} from '../public/document-toc.mjs';
function element(tag,text=''){
 const attrs=new Map(),classes=new Set();
 return {tagName:tag.toUpperCase(),textContent:text,children:[],style:{setProperty(){}},classList:{toggle(k,on){on?classes.add(k):classes.delete(k)}},append(x){this.children.push(x)},setAttribute(k,v){attrs.set(k,v)},removeAttribute(k){attrs.delete(k)},getAttribute(k){return attrs.get(k)},closest(){return null},getBoundingClientRect(){return {top:0}}};
}
test('chapter navigation uses rendered headings, unique targets, owner-only scroll and releases listeners',()=>{
 const oldDoc=globalThis.document,oldObserver=globalThis.ResizeObserver;
 let disconnected=false,listener;
 globalThis.document={createElement:element};globalThis.ResizeObserver=class{observe(){}disconnect(){disconnected=true}};
 try{
  const nav=element('nav'),headings=[element('h1','报告'),element('h2','相同标题'),element('h2','相同标题')];
  const content={scrollTop:0,scrollHeight:2000,clientHeight:500,querySelectorAll:()=>headings,getBoundingClientRect:()=>({top:100}),addEventListener:(_,fn)=>listener=fn,removeEventListener:(_,fn)=>{assert.equal(fn,listener);listener=null},scrollTo({top}){this.scrollTop=top}};
  headings.forEach((h,i)=>h.getBoundingClientRect=()=>({top:120+i*600-content.scrollTop}));
  const dispose=bindDocumentToc({querySelector:s=>s==='.doc-toc'?nav:content});
  const buttons=nav.children.slice(1);
  assert.deepEqual(buttons.map(b=>b.textContent),['报告','相同标题','相同标题']);
  assert.notEqual(headings[1].id,headings[2].id);
  buttons[1].onclick();assert.equal(content.scrollTop,604);assert.equal(buttons[1].getAttribute('aria-current'),'location');
  content.scrollTop=1210;listener();assert.equal(buttons[2].getAttribute('aria-current'),'location');assert.equal(buttons[1].getAttribute('aria-current'),undefined);
  dispose();assert.equal(disconnected,true);assert.equal(listener,null);assert.ok(buttons.every(b=>b.onclick===null));
 }finally{globalThis.document=oldDoc;globalThis.ResizeObserver=oldObserver;}
});
test('non-document tabs explain why there is no chapter index',()=>{
 const oldDoc=globalThis.document;globalThis.document={createElement:element};
 try{const nav=element('nav');const dispose=bindDocumentToc({querySelector:s=>s==='.doc-toc'?nav:{querySelectorAll:()=>[],querySelector:()=>({})}});assert.match(nav.children[1].textContent,/HTML/);dispose();}finally{globalThis.document=oldDoc}
});
