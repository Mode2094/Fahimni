import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestMicrophone} from '../lib/whiteboard/microphone';

test('microphone timeout gives Arabic feedback and releases a late browser stream',async()=>{
 let release!:(stream:MediaStream)=>void;let stopped=0;
 const stream={getTracks:()=>[{stop:()=>stopped++}]} as unknown as MediaStream;
 const pending=requestMicrophone(new AbortController().signal,10,()=>new Promise(resolve=>{release=resolve;}));
 await assert.rejects(pending,/الميكروفون/);
 release(stream);await Promise.resolve();assert.equal(stopped,1);
});
test('microphone permission can be cancelled and never leaves a late recording active',async()=>{
 const controller=new AbortController();let release!:(stream:MediaStream)=>void;let stopped=0;
 const pending=requestMicrophone(controller.signal,1000,()=>new Promise(resolve=>{release=resolve;}));
 controller.abort();await assert.rejects(pending,{name:'AbortError'});
 release({getTracks:()=>[{stop:()=>stopped++}]} as unknown as MediaStream);await Promise.resolve();assert.equal(stopped,1);
});
