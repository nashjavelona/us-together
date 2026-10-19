import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {initial} from '../couple.js';
import {sendForYou,markForYouRead,reactForYou,removeForYou,pruneOrphanForYouMetadata} from '../for-you.js';
import {backendFixture} from './backend-fixture.js';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function read(relative){return readFileSync(resolve(ROOT,relative),'utf8');}

// A file download link without a target was genuinely broken in the previous release.
test('every local entrypoint and Settings source download has a real target',()=>{
 const index=read('index.html'),app=read('app.js');
 for(const asset of ['index.html','style.css','app.js','icon.svg','manifest.webmanifest','sw.js',
   'cloud-sync.js','cloud-ui.js','sync-model.js','for-you.js','cloud-config.js'])
   assert.ok(existsSync(resolve(ROOT,asset)),`Missing ${asset}`);
 assert.match(app,/Download your GitHub repository source/);
 assert.match(app,/https:\/\/github\.com\/nashjavelona\/us-together\/archive\/refs\/heads\/main\.zip/);
 assert.doesNotMatch(app,/href="\.\/Us-Together-Source\.zip"/);
 assert.match(index,/4\.1\.2-professional-qa/);
 const manifest=JSON.parse(read('manifest.webmanifest'));
 for(const icon of manifest.icons)assert.ok(existsSync(resolve(ROOT,icon.src)),`Manifest icon missing: ${icon.src}`);
});

test('deleting a message and cleaning its own orphan receipts is permitted by the API',async t=>{
 const f=backendFixture();t.after(()=>f.close());
 const state=initial();state.setup=true;
 state.people.forEach(p=>{p.settings.start='00:00';p.settings.end='23:59';});
 const pair=await f.pair({state});
 assert.equal(pair.first.status,200);assert.equal(pair.second.status,200);
 let received=pair.first.body;
 const message=sendForYou(received.state,0,'message','A little hello');
 let updated=await f.request('PUT','/state',{state:received.state,revision:received.revision,mutationId:crypto.randomUUID()},pair.first.token);
 assert.equal(updated.status,200,JSON.stringify(updated.body));
 received=updated.body;
 markForYouRead(received.state,1,message.id);
 reactForYou(received.state,1,message.id,'heart');
 updated=await f.request('PUT','/state',{state:received.state,revision:received.revision,mutationId:crypto.randomUUID()},pair.second.token);
 assert.equal(updated.status,200,JSON.stringify(updated.body));
 received=updated.body;
 assert.equal(removeForYou(received.state,0,message.id),true);
 updated=await f.request('PUT','/state',{state:received.state,revision:received.revision,mutationId:crypto.randomUUID()},pair.first.token);
 assert.equal(updated.status,200,JSON.stringify(updated.body));
 received=updated.body;
 assert.equal(pruneOrphanForYouMetadata(received.state,0),0);
 assert.equal(pruneOrphanForYouMetadata(received.state,1),2);
 updated=await f.request('PUT','/state',{state:received.state,revision:received.revision,mutationId:crypto.randomUUID()},pair.second.token);
 assert.equal(updated.status,200,JSON.stringify(updated.body));
 assert.equal(updated.body.state.notes.length,0);
});

test('unsent partner-message drafts survive a refresh and remain separate by profile',async()=>{
 const original=new Map(['document','window','localStorage','setInterval','setTimeout'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const saved=new Map();
 const state=initial();state.setup=true;state.names=['Black','Pink'];
 saved.set('us-together.v2',JSON.stringify(state));
 let listeners={};
 function element(){return {innerHTML:'',textContent:'',dataset:{},classList:{add(){},remove(){},toggle(){}},
   showModal(){this.open=true;},close(){this.open=false;},style:{setProperty(){}}};}
 function makeDocument(){
  const elements=new Map();listeners={};
  return {
   querySelector(selector){if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);},
   querySelectorAll(){return [];},addEventListener(kind,cb){listeners[kind]=cb;},
   activeElement:{matches(){return false;}},hidden:false,
  };
 }
 globalThis.window={addEventListener(){},scrollTo(){}};
 globalThis.localStorage={getItem:key=>saved.get(key)??null,setItem:(key,val)=>saved.set(key,String(val)),removeItem:key=>saved.delete(key)};
 globalThis.setTimeout=()=>0;globalThis.setInterval=()=>0;
 const click=dataset=>listeners.click({preventDefault(){},target:{closest(){return {dataset};}}});
 try{
  globalThis.document=makeDocument();
  await import('../app.js?professional-draft-pass1');
  click({view:'inbox'});
  listeners.input({target:{id:'message-text',value:'We should plan a trip!'}});
  assert.deepEqual(JSON.parse(saved.get('us-together.mail-drafts.v1:local')),['We should plan a trip!','']);
  click({a:'profile',owner:'1'});
  listeners.input({target:{id:'message-text',value:'Remember the tickets.'}});
  assert.deepEqual(JSON.parse(saved.get('us-together.mail-drafts.v1:local')),['We should plan a trip!','Remember the tickets.']);
  globalThis.document=makeDocument();
  await import('../app.js?professional-draft-pass2');
  click({view:'inbox'});
  click({a:'profile',owner:'0'});
  assert.match(globalThis.document.querySelector('#app').innerHTML,/We should plan a trip!/);
  assert.doesNotMatch(globalThis.document.querySelector('#app').innerHTML,/<textarea id="message-text"[^>]*>Remember the tickets\./);
  click({a:'profile',owner:'1'});
  assert.match(globalThis.document.querySelector('#app').innerHTML,/<textarea id="message-text"[^>]*>Remember the tickets\./);
  assert.ok(saved.has('us-together.v2'),'the existing local tasks remain saved');
 }finally{
  for(const [key,old]of original)if(old)Object.defineProperty(globalThis,key,old);else delete globalThis[key];
 }
});
