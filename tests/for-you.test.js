import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initial,validCouple} from '../couple.js';
import {wireState,mergeStates,changesBetween} from '../sync-model.js';
import {normalizeState} from '../server/state.js';
import {backendFixture} from './backend-fixture.js';
import {BODY_LIMIT,REACTIONS,decodeForYou,isForYouNote,wallNotes,mailItems,unreadFor,sendForYou,markForYouRead,reactForYou,removeForYou,pruneOrphanForYouMetadata} from '../for-you.js';

const stamp='2026-10-19T08:20:00.000Z';
const snapshot=s=>structuredClone(s);
function make(){const s=initial();s.names=['Black','Pink'];s.notes.push({id:'old-love-note',text:'I appreciate you',from:0,date:stamp});return s;}
function ok(response){assert.equal(response.status,200,JSON.stringify(response.body));return response.body;}
async function put(f,person,state,revision){return f.request('PUT','/state',{state,revision,mutationId:crypto.randomUUID()},person.token);}

test('regular wall notes remain unchanged and two kinds of partner note roundtrip under the existing D1 schema',()=>{
 const s=make();const message=sendForYou(s,0,'message','Hello, my favorite person. <script> & \n♡',stamp);
 const letter=sendForYou(s,1,'letter','Open when you need a hug.',new Date(Date.parse(stamp)+1000).toISOString());
 assert.equal(wallNotes(s).length,1);assert.equal(wallNotes(s)[0].id,'old-love-note');
 assert.equal(isForYouNote(s.notes[0]),false);assert.equal(isForYouNote(message),true);
 assert.deepEqual(mailItems(s).map(x=>[x.kind,x.from,x.to,x.text,x.seen]),[
  ['message',0,1,'Hello, my favorite person. <script> & \n♡',false],
  ['letter',1,0,'Open when you need a hug.',false]
 ]);
 assert.ok(s.notes.every(n=>n.text.length<=500&&Object.keys(n).sort().join(',')==='date,from,id,text'));
 assert.ok(validCouple(s));assert.deepEqual(normalizeState(wireState(s)).notes,s.notes);
 assert.equal(unreadFor(s,0),1);assert.equal(unreadFor(s,1),1);
});

test('receipts and reactions belong to the recipient, with idempotent read and one reversible reaction',()=>{
 const s=make();const msg=sendForYou(s,0,'message','Glad you are here.',stamp);
 assert.equal(markForYouRead(s,0,msg.id),false,'sender cannot read as recipient');
 assert.equal(markForYouRead(s,1,msg.id),true);assert.equal(markForYouRead(s,1,msg.id),false);
 assert.equal(unreadFor(s,1),0);assert.equal(mailItems(s)[0].seen,true);
 assert.equal(reactForYou(s,1,msg.id,'heart').from,1);assert.equal(mailItems(s)[0].reaction,'heart');
 const count=s.notes.length;reactForYou(s,1,msg.id,'sparkle');assert.equal(s.notes.length,count);
 assert.equal(mailItems(s)[0].reaction,'sparkle');assert.equal(reactForYou(s,1,msg.id,'sparkle'),null);
 assert.equal(mailItems(s)[0].reaction,null);assert.throws(()=>reactForYou(s,0,msg.id,'heart'));
 assert.equal(REACTIONS.heart,'♥');assert.equal(validCouple(s),true);
});

test('messages cannot be sent empty, oversized, by invalid roles or beyond server note limit',()=>{
 const s=make();for(const text of ['', '  \n  ', 'a'.repeat(BODY_LIMIT+1)])assert.throws(()=>sendForYou(s,0,'message',text));
 assert.throws(()=>sendForYou(s,2,'message','hello'));
 assert.throws(()=>sendForYou(s,0,'story','hello'));
 assert.throws(()=>sendForYou(s,0,'letter','hello','not-a-date'));
 assert.throws(()=>reactForYou(s,0,'missing','explode'));
 const filled=make();filled.notes=Array.from({length:1000},(_,i)=>({id:'existing-'+i,from:0,text:'Old note',date:stamp}));
 assert.throws(()=>sendForYou(filled,0,'message','No more slots'));
 assert.equal(filled.notes.length,1000);
});

test('deleting my message leaves partner’s receipts intact but invisible, and cannot delete partner content',()=>{
 const s=make(),msg=sendForYou(s,0,'message','A tiny note',stamp);
 markForYouRead(s,1,msg.id);reactForYou(s,1,msg.id,'hug');
 const count=s.notes.length;
 assert.equal(removeForYou(s,1,msg.id),false);assert.equal(s.notes.length,count);
 assert.equal(removeForYou(s,0,msg.id),true);assert.equal(mailItems(s).length,0);
 assert.equal(s.notes.length,count-1);assert.equal(validCouple(s),true);
 assert.equal(wallNotes(s).length,1);
});

test('new independent messages merge across devices without deleting old notes',()=>{
 const base=make(),black=snapshot(base),pink=snapshot(base);
 sendForYou(black,0,'message','Black says hi',stamp);
 sendForYou(pink,1,'letter','Pink wrote a letter',new Date(Date.parse(stamp)+1200).toISOString());
 const merged=mergeStates(base,black,pink,{role:0});
 assert.equal(merged.conflicts.length,0);
 assert.deepEqual(mailItems(merged.state).map(x=>x.text),['Black says hi','Pink wrote a letter']);
 assert.equal(wallNotes(merged.state).length,1);
 assert.equal(changesBetween(base,black,{role:0}).length,1);
 assert.equal(validCouple(merged.state),true);
});

test('connected backend accepts messages, recipient receipts and reactions without any schema migration',async t=>{
 const f=backendFixture();t.after(()=>f.close());const pair=await f.pair({state:make()});
 const draft=snapshot(pair.first.body.state),out=sendForYou(draft,0,'message','See you tonight',stamp);
 const sent=ok(await put(f,pair.first,draft,0));assert.equal(mailItems(sent.state).length,1);
 assert.equal(sent.state.notes.some(n=>n.id===out.id),true);
 let other=snapshot(sent.state);markForYouRead(other,1,out.id,stamp);reactForYou(other,1,out.id,'heart',stamp);
 const seen=ok(await put(f,pair.second,other,sent.revision));
 assert.equal(mailItems(seen.state)[0].seen,true);assert.equal(mailItems(seen.state)[0].reaction,'heart');
 const forged=snapshot(seen.state);forged.notes.find(n=>n.id===out.id).text='I am the sender';
 const forbidden=await put(f,pair.second,forged,seen.revision);assert.equal(forbidden.status,403,'partner cannot alter authored messages');
 const latest=ok(await f.request('GET','/state',undefined,pair.first.token));
 assert.equal(latest.state.notes.length,4,'one wall, one message, one seen, one reaction');
 assert.equal(mailItems(latest.state)[0].seen,true);
});

test('special message marker does not turn legacy love notes into chats',()=>{
 const s=make();s.notes.push({id:'legacy-marker',from:1,date:stamp,text:'Message to you: I missed you ♡'});
 s.notes.push({id:'unknown-metadata',from:0,date:stamp,text:'\u2063UT-FOR-YOU/1/unknown|test'});
 assert.equal(wallNotes(s).length,2);
 assert.equal(mailItems(s).length,0);
 assert.equal(decodeForYou(s.notes.at(-1)),null);
});

test('recipient safely reclaims invisible read and reaction metadata after deleted messages',()=>{
 const s=make();const first=sendForYou(s,0,'message','First hello',stamp);
 markForYouRead(s,1,first.id);reactForYou(s,1,first.id,'heart');removeForYou(s,0,first.id);
 assert.equal(mailItems(s).length,0);
 assert.equal(s.notes.filter(n=>n.from===1).length,2,'an author cannot delete the recipient\'s receipts');
 assert.equal(pruneOrphanForYouMetadata(s,0),0,'only own author records can be cleaned');
 assert.equal(s.notes.filter(n=>n.from===1).length,2);
 assert.equal(pruneOrphanForYouMetadata(s,1),2);
 assert.equal(pruneOrphanForYouMetadata(s,1),0,'safe and idempotent');
 assert.equal(s.notes.length,1,'regular love notes are never removed');
 assert.equal(validCouple(s),true);
});

test('a recipient can send after cleanup prevents obsolete receipts from exhausting the note cap',()=>{
 const s=make();for(let i=0;i<120;i++){
  const note=sendForYou(s,0,'message',`tiny note ${i}`,stamp);
  markForYouRead(s,1,note.id);reactForYou(s,1,note.id,'heart');removeForYou(s,0,note.id);
 }
 assert.ok(s.notes.length>1);
 const next=sendForYou(s,1,'message','I am replying ♡',stamp);
 assert.equal(s.notes.filter(n=>n.from===1).length,1);
 assert.equal(mailItems(s).length,1);
 assert.equal(mailItems(s)[0].id,next.id);
 assert.equal(wallNotes(s).length,1);
});

test('duplicate receipts from concurrent devices retain exactly one read marker and latest reaction',()=>{
 const s=make(),msg=sendForYou(s,0,'letter','First letter',stamp);
 markForYouRead(s,1,msg.id,stamp);
 const seen=s.notes.at(-1);
 reactForYou(s,1,msg.id,'heart',stamp);
 const firstReaction=s.notes.at(-1);
 s.notes.push({...seen,id:'second-seen',date:'2026-10-19T08:21:00Z'});
 s.notes.push({...firstReaction,id:'new-reaction',date:'2026-10-19T08:22:00Z',text:firstReaction.text.replace('|heart','|hug')});
 assert.equal(pruneOrphanForYouMetadata(s,1),2);
 assert.equal(mailItems(s)[0].seen,true);
 assert.equal(mailItems(s)[0].reaction,'hug');
 assert.equal(s.notes.filter(n=>decodeForYou(n)?.kind==='seen').length,1);
 assert.equal(s.notes.filter(n=>decodeForYou(n)?.kind==='reaction').length,1);
});

test('repeatedly sending and removing notes does not exhaust hidden receipt storage',()=>{
 const state=make();
 for(let i=0;i<180;i++){
  const msg=sendForYou(state,0,'message',`A small hello ${i}`,stamp);
  assert.equal(markForYouRead(state,1,msg.id),true);
  assert.equal(reactForYou(state,1,msg.id,'heart').from,1);
  assert.equal(removeForYou(state,0,msg.id),true);
  assert.equal(pruneOrphanForYouMetadata(state,1),2);
  assert.equal(state.notes.length,1,`iteration ${i} should retain only the wall note`);
 }
 assert.equal(mailItems(state).length,0);
 assert.equal(unreadFor(state,1),0);
 assert.equal(validCouple(state),true);
});
