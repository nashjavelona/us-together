import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initial} from '../couple.js';
import {parse} from '../core.js';

test('UI module initializes and renders home, tasks, progress, settings and task menu',async()=>{
  const state=initial();state.setup=true;state.names=['Black','Pink'];state.active=1;
  state.people.forEach(person=>{person.settings.start='00:00';person.settings.end='23:59';});
  const task=parse('Smoke test');state.people[0].tasks.push(task);
  const elements=new Map(),listeners={};
  function element(){return {innerHTML:'',textContent:'',dataset:{},classList:{add(){},remove(){},toggle(){}},showModal(){this.open=true;},close(){this.open=false;}};}
  const document={querySelector(q){if(!elements.has(q))elements.set(q,element());return elements.get(q);},querySelectorAll(){return [];},addEventListener(k,fn){listeners[k]=fn;},activeElement:{matches(){return false;}}};
  const originals={document:globalThis.document,window:globalThis.window,localStorage:globalThis.localStorage,setInterval:globalThis.setInterval,setTimeout:globalThis.setTimeout};
  globalThis.document=document;globalThis.window={addEventListener(){}};globalThis.localStorage={getItem(){return JSON.stringify(state);},setItem(){}};globalThis.setInterval=()=>0;globalThis.setTimeout=()=>0;
  try{
    await import('../app.js?smoke');
    const html=elements.get('#app').innerHTML;
    const sections=[...html.matchAll(/<section\b[^>]*\bclass="([^"]*)"[^>]*>/g)].map(match=>match[1].split(/\s+/));
    const black=sections.find(classes=>classes.includes('person')&&classes.includes('black'));
    const pink=sections.find(classes=>classes.includes('person')&&classes.includes('pink'));
    assert.ok(black?.includes('mobile-hidden'));
    assert.ok(pink?.includes('is-active'));
    assert.ok(!pink.includes('mobile-hidden'));
    assert.match(html,/YOUR NEXT SMALL STEP/);
    assert.match(html,/Your day, gently planned/);
    assert.match(html,/Smoke test/);
    const click=dataset=>listeners.click({target:{closest(){return {dataset};}}});
    click({view:'tasks'});assert.match(elements.get('#app').innerHTML,/Upcoming/);
    click({view:'wins'});assert.match(elements.get('#app').innerHTML,/A week of little steps/);
    click({a:'settings'});assert.match(elements.get('#dialog').innerHTML,/Avatar initials/);assert.match(elements.get('#dialog').innerHTML,/Our tagline/);
    click({a:'profile',owner:'0'});
    click({a:'taskmenu',id:task.id});assert.match(elements.get('#dialog').innerHTML,/Ask for a little help/);
  }finally{Object.assign(globalThis,originals);}
});
