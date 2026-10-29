import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import Classroom from '../components/classroom/Classroom';
test('classroom mounts in Arabic, exposes book, navigates pages and honestly reports missing provider',async()=>{
 const dom=new JSDOM('<html dir="rtl" lang="ar"><body><div id="root"></div></body></html>',{url:'https://local'});Object.assign(globalThis,{window:dom.window,document:dom.window.document,sessionStorage:dom.window.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true});
 const oldFetch=globalThis.fetch;globalThis.fetch=async url=>String(url).includes('/status')?Response.json({configured:false,debug:false}):Response.json({error:'المعلّم غير متصل بعد.'},{status:503});
 const root=createRoot(document.getElementById('root')!);
 try{await act(async()=>root.render(React.createElement(Classroom)));assert.equal(document.documentElement.dir,'rtl');assert(document.body.textContent?.includes('خطوة بخطوة'));assert(document.body.textContent?.includes('بانتظار تفعيل'));
 const button=(text:string)=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.includes(text))!;
 await act(async()=>button('كتابي').click());assert(document.querySelector('[role="dialog"]'));assert.equal(document.querySelector('.book-page img')?.getAttribute('src'),'/book/8.jpg');
 await act(async()=>button('التالية').click());assert.equal(document.querySelector('.book-page img')?.getAttribute('src'),'/book/9.jpg');
 await act(async()=>document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape'})));assert(!document.querySelector('[role="dialog"]'));
 await act(async()=>button('نبدأ بمسألة').click());assert(document.querySelector('[role="alert"]')?.textContent?.includes('غير متصل'));assert(!document.querySelector('.board-object'));
 }finally{await act(async()=>root.unmount());globalThis.fetch=oldFetch;dom.window.close();}
});
