import {test} from 'node:test';import assert from 'node:assert/strict';import {initial,validCouple} from '../couple.js';import {day} from '../core.js';
test('event flows: capture, request, accept, focus, pause/resume, completion, undo, restore and expiry',async()=>{
 const initialState=initial();initialState.setup=true;initialState.people.forEach(p=>{p.settings.start='00:00';p.settings.end='23:59';});let saved=JSON.stringify(initialState),now=Date.now(),tick;
 const elements=new Map(),listeners={};function node(){return {innerHTML:'',textContent:'',dataset:{},classList:{add(){},remove(){},toggle(){}},showModal(){this.open=true;},close(){this.open=false;}};}
 const doc={querySelector(q){if(!elements.has(q))elements.set(q,node());return elements.get(q);},querySelectorAll(){return [];},addEventListener(k,fn){listeners[k]=fn;},activeElement:{matches(){return false;}}};
 const original={document:globalThis.document,window:globalThis.window,localStorage:globalThis.localStorage,setInterval:globalThis.setInterval,setTimeout:globalThis.setTimeout,confirm:globalThis.confirm},realNow=Date.now;
 globalThis.document=doc;globalThis.window={addEventListener(){}};globalThis.localStorage={getItem(k){return k==='us-together.v2'?saved:null;},setItem(k,v){saved=v;}};globalThis.setInterval=f=>{tick=f;return 0;};globalThis.setTimeout=()=>0;globalThis.confirm=()=>true;Date.now=()=>now;
 const state=()=>JSON.parse(saved),click=dataset=>listeners.click({target:{closest(){return {dataset};}}});const capture=(owner,value)=>listeners.submit({preventDefault(){},target:{id:'',dataset:{owner:String(owner)},matches(){return true;},elements:{task:{value}}}});
 try{
  await import('../app.js?flows');capture(0,'Study for 25 minutes');let id=state().people[0].tasks[0].id;assert.equal(state().people[0].tasks[0].title,'Study');
  click({a:'starttask',id});assert.ok(state().people[0].timer.running);now+=60000;click({a:'focus',owner:'0'});assert.equal(state().people[0].timer.running,false);assert.equal(state().people[0].tasks[0].spent,60);
  now+=120000;click({a:'focus',owner:'0'});now+=30000;click({a:'complete',id});assert.equal(state().people[0].tasks[0].spent,90);assert.equal(state().people[0].tasks[0].status,'done');click({a:'undo'});assert.equal(state().people[0].tasks[0].status,'open');assert.equal(state().people[0].tasks[0].spent,90);
  click({a:'assign',id,owner:'1'});assert.ok(state().people[1].tasks[0].request);click({a:'profile',owner:'1'});click({a:'accept',id});assert.equal(state().people[1].tasks[0].request,undefined);
  click({a:'archive',id});assert.equal(state().people[1].tasks[0].status,'archived');click({a:'undo'});assert.equal(state().people[1].tasks[0].status,'open');
  click({a:'just',id});now+=5*60000;tick();assert.equal(state().people[1].timer,null);assert.ok(state().people[1].restUntil>now);assert.match(elements.get('#app').innerHTML,/A LITTLE RESET/);click({a:'skipbreak',owner:'1'});assert.equal(state().people[1].restUntil,null);
  const before=saved;await elements.get('#restore').onchange({target:{files:[{size:1,text:async()=>'{"bad":true}'}],value:'x'}});assert.equal(saved,before);
  await elements.get('#restore').onchange({target:{files:[{size:1,text:async()=>before}],value:'x'}});assert.ok(validCouple(state()));assert.equal(state().people[1].tasks[0].id,id);
  capture(0,'Buy groceries tomorrow');const future=state().people[0].tasks.find(t=>t.title==='Buy groceries');assert.ok(future.notBefore>day());assert.ok(future.request);click({a:'profile',owner:'0'});click({a:'accept',id:future.id});click({a:'starttask',id:future.id});assert.match(elements.get('#dialog').innerHTML,/Start this task early/);assert.equal(state().people[0].timer,null);
  capture(0,'Buy gifts on 2026-02-30');assert.ok(validCouple(state()));assert.match(elements.get('#toast').innerHTML,/Check the date/);
  await import('../app.js?flows-date-reload');assert.ok(validCouple(state()));assert.equal(state().people[1].tasks[0].id,id);assert.doesNotMatch(elements.get('#app').innerHTML,/Saved data could not be read/);
 }finally{Object.assign(globalThis,original);Date.now=realNow;}
});
