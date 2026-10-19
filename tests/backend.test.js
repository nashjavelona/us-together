import {test} from 'node:test';
import assert from 'node:assert/strict';
import {backendFixture,capability,sampleState,sampleTask} from './backend-fixture.js';
import {handleApi} from '../server/api.js';
import {zonedAt,zoneDay} from '../server/time.js';

const copy=x=>JSON.parse(JSON.stringify(x));
const mutation=()=>crypto.randomUUID();
async function put(f,connection,state,id=mutation(),revision=connection.body.revision){return f.request('PUT','/state',{state,revision,mutationId:id},connection.token);}
async function focus(f,connection,args,id=mutation(),revision=connection.body.revision){return f.request('POST','/focus',{revision,mutationId:id,...args},connection.token);}
function assertOk(response){assert.equal(response.status,200,JSON.stringify(response.body));return response.body;}

test('private pairing is retry-safe, stores only capability hashes and returns identity from the device',async t=>{
  const f=backendFixture();t.after(()=>f.close());const pair=await f.pair();assertOk(pair.first);assertOk(pair.second);
  assert.equal(pair.first.body.role,0);assert.equal(pair.second.body.role,1);assert.equal(pair.second.body.spaceId,pair.first.body.spaceId);assert.equal(pair.second.body.partnerJoined,true);
  const retry=await f.request('POST','/join',{invite:pair.invite,deviceToken:pair.second.token,recoveryKey:pair.second.recoveryKey,deviceName:'Partner phone'});
  assert.equal(assertOk(retry).deviceId,pair.second.body.deviceId);
  const createAgain=await f.create({token:pair.first.token});assert.equal(assertOk(createAgain).spaceId,pair.first.body.spaceId);
  const raw=JSON.stringify({devices:f.DB.raw.prepare('SELECT * FROM couple_devices').all(),members:f.DB.raw.prepare('SELECT * FROM couple_members').all(),invites:f.DB.raw.prepare('SELECT * FROM couple_invites').all()});
  for(const secret of [pair.first.token,pair.first.recoveryKey,pair.second.token,pair.second.recoveryKey,pair.invite])assert.equal(raw.includes(secret),false);
  assert.equal(pair.second.body.state.active,0);assert.deepEqual(pair.second.body.state.people.map(p=>p.plans),[{},{}]);
  assert.equal(pair.second.headers.get('cache-control'),'no-store');assert.equal(pair.second.headers.get('access-control-allow-origin'),'https://nashjavelona.github.io');
});

test('simultaneous invitation claims fill exactly one other-member slot',async t=>{
  const f=backendFixture();t.after(()=>f.close());const first=await f.create();const invitation=await f.request('POST','/invite',{},first.token);
  const responses=await Promise.all([0,1].map(i=>f.request('POST','/join',{invite:invitation.body.invite,deviceToken:capability(),recoveryKey:capability(),deviceName:`Phone ${i}`})));
  assert.equal(responses.filter(x=>x.status===200).length,1);assert.equal(f.DB.raw.prepare('SELECT COUNT(*) AS n FROM couple_members').get().n,2);
  assert.equal(f.DB.raw.prepare('SELECT COUNT(*) AS n FROM couple_devices').get().n,2);
  assert.equal((await f.request('POST','/invite',{},first.token)).body.code,'space_full');
});

test('new invitation invalidates unused older invitation and expiration is enforced',async t=>{
  const f=backendFixture();t.after(()=>f.close());const c=await f.create();const old=await f.request('POST','/invite',{},c.token),fresh=await f.request('POST','/invite',{},c.token);
  const payload={deviceToken:capability(),recoveryKey:capability(),deviceName:'Phone'};
  assert.equal((await f.request('POST','/join',{...payload,invite:old.body.invite})).body.code,'invalid_invite');
  f.advance(86400001);assert.equal((await f.request('POST','/join',{...payload,invite:fresh.body.invite})).body.code,'invalid_invite');
});

test('member-specific recovery adds a device, never reveals or revokes the partner, and supports own revocation',async t=>{
  const f=backendFixture();t.after(()=>f.close());const pair=await f.pair(),token=capability();
  const wrong=await f.request('POST','/recover',{spaceId:pair.first.body.spaceId,role:1,recoveryKey:pair.first.recoveryKey,deviceToken:token,deviceName:'Extra'});assert.equal(wrong.status,401);
  const payload={spaceId:pair.first.body.spaceId,role:0,recoveryKey:pair.first.recoveryKey,deviceToken:token,deviceName:'Extra'};
  const recovered=await f.request('POST','/recover',payload);assertOk(recovered);
  assert.equal(assertOk(await f.request('POST','/recover',payload)).deviceId,recovered.body.deviceId);
  const devices=assertOk(await f.request('GET','/devices',undefined,token)).devices;assert.equal(devices.length,2);assert.equal(devices.some(d=>d.id===pair.second.body.deviceId),false);
  assert.equal((await f.request('DELETE',`/devices/${pair.second.body.deviceId}`,undefined,token)).status,404);
  assertOk(await f.request('DELETE',`/devices/${pair.first.body.deviceId}`,undefined,token));
  assert.equal((await f.request('GET','/state',undefined,pair.first.token)).body.code,'revoked');assertOk(await f.request('GET','/state',undefined,pair.second.token));
});

test('ordinary state mutation uses exact CAS and duplicate operations never add a second revision or snapshot',async t=>{
  const f=backendFixture();t.after(()=>f.close());const c=await f.create(),state=copy(c.body.state);state.people[0].tasks.push(sampleTask());const id=mutation();
  const accepted=await put(f,c,state,id);assert.equal(assertOk(accepted).revision,1);
  const repeated=await put(f,c,state,id);assert.equal(assertOk(repeated).revision,1);
  const stale=await put(f,c,{...state,tagline:'A second edit'});assert.equal(stale.status,409);assert.equal(stale.body.code,'conflict');assert.equal(stale.body.current.revision,1);
  const reused=await put(f,c,{...state,tagline:'Different content'},id);assert.equal(reused.body.code,'mutation_reused');
  assert.equal(f.DB.raw.prepare('SELECT COUNT(*) AS n FROM couple_snapshots').get().n,1);assert.equal(f.DB.raw.prepare('SELECT COUNT(*) AS n FROM couple_operations').get().n,1);
});

test('concurrent accepted-base mutations cannot create phantom snapshots on a zero-row CAS',async t=>{
  const f=backendFixture();t.after(()=>f.close());const c=await f.create();
  const responses=await Promise.all(['One','Two'].map(title=>put(f,c,{...copy(c.body.state),tagline:title})));
  assert.equal(responses.filter(x=>x.status===200).length,1);assert.equal(responses.filter(x=>x.status===409).length,1);
  assert.equal(f.DB.raw.prepare('SELECT COUNT(*) AS n FROM couple_snapshots').get().n,1);assert.equal(f.DB.raw.prepare('SELECT COUNT(*) AS n FROM couple_operations').get().n,1);
});

test('actor identity cannot be forged with state.active, owner changes, partner settings, notes or check-ins',async t=>{
  const f=backendFixture();t.after(()=>f.close());const state=sampleState();state.people[1].tasks.push(sampleTask('partner-task'));state.notes.push({id:'partner-note',from:1,text:'Hello',date:'2026-10-18T01:00:00Z'});state.checkins={date:'2026-10-18',moods:[null,'steady']};
  const pair=await f.pair({state});
  for(const change of [s=>{s.active=1;s.people[1].tasks[0].title='Forged';},s=>{s.people[1].settings.focus=60;},s=>{s.notes[0].text='Changed';},s=>{s.checkins.moods[1]='bright';},s=>{s.people[0].tasks.push(s.people[1].tasks.pop());}]){
    const draft=copy(pair.first.body.state);change(draft);const response=await put(f,pair.first,draft);assert.equal(response.status,403,JSON.stringify(response.body));
  }
  const saved=assertOk(await f.request('GET','/state',undefined,pair.second.token));assert.equal(saved.revision,0);assert.equal(saved.state.people[1].tasks[0].title,state.people[1].tasks[0].title);
});

test('requests can be accepted only by recipient and shared-origin rejection returns to shared ownership',async t=>{
  const f=backendFixture();t.after(()=>f.close());const state=sampleState();state.shared.push(sampleTask('shared-task'));const pair=await f.pair({state}),draft=copy(pair.first.body.state),task=draft.shared.pop();
  task.request={from:0,to:1,origin:2,created:'2026-10-18T00:00:00Z'};draft.people[1].tasks.push(task);
  const request=await put(f,pair.first,draft);assertOk(request);
  const accepting=copy(request.body.state);delete accepting.people[1].tasks[0].request;
  assert.equal((await put(f,{...pair.first,body:request.body},accepting)).status,403);
  const declined=copy(request.body.state),returned=declined.people[1].tasks.pop();delete returned.request;returned.help=false;returned.helper=null;declined.shared.push(returned);
  const result=await put(f,{...pair.second,body:request.body},declined);assert.equal(assertOk(result).state.shared[0].id,'shared-task');assert.equal(result.body.state.people[1].tasks.length,0);
});

test('forged new partner tasks require provenance, while valid requests and recipient acceptance work',async t=>{
  const f=backendFixture();t.after(()=>f.close());const pair=await f.pair();let draft=copy(pair.first.body.state);draft.people[1].tasks.push(sampleTask());
  assert.equal((await put(f,pair.first,draft)).status,403);draft.people[1].tasks[0].request={from:0,to:1,origin:0,created:'2026-10-18T00:00:00Z'};
  const request=await put(f,pair.first,draft);assertOk(request);draft=copy(request.body.state);delete draft.people[1].tasks[0].request;
  const accepted=await put(f,{...pair.second,body:request.body},draft);assertOk(accepted);assert.equal(accepted.body.state.people[1].tasks[0].request,undefined);
});

test('help offer and takeover require the partner’s open help request',async t=>{
  const f=backendFixture();t.after(()=>f.close());const state=sampleState();state.people[1].tasks.push({...sampleTask(),help:true,helper:null});const pair=await f.pair({state});
  const offer=copy(pair.first.body.state);offer.people[1].tasks[0].helper=0;const offered=await put(f,pair.first,offer);assertOk(offered);
  const takeover=copy(offered.body.state),task=takeover.people[1].tasks.pop();task.help=false;task.helper=null;takeover.people[0].tasks.push(task);
  assertOk(await put(f,{...pair.first,body:offered.body},takeover));
});

test('the server controls timer timestamps, elapsed sessions and completion time on ordinary PUT',async t=>{
  const f=backendFixture();t.after(()=>f.close());const state=sampleState();state.people[0].tasks.push(sampleTask());const c=await f.create({state});
  const started=await focus(f,c,{action:'start',owner:0,taskId:'task-one',minutes:5});assertOk(started);f.advance(60000);
  const draft=copy(started.body.state);draft.people[0].timer=null;draft.people[0].sessions=[];const task=draft.people[0].tasks[0];task.spent=999999;task.status='done';task.completed='2025-01-01T00:00:00Z';task.completedDay='2025-01-01';
  const done=await put(f,{...c,body:started.body},draft);assertOk(done);assert.equal(done.body.state.people[0].tasks[0].spent,60);assert.equal(done.body.state.people[0].sessions.length,1);assert.equal(done.body.state.people[0].tasks[0].completed,new Date(f.now()).toISOString());assert.equal(done.body.state.people[0].timer,null);
  const reopen=copy(done.body.state);reopen.people[0].tasks[0].status='open';delete reopen.people[0].tasks[0].completed;delete reopen.people[0].tasks[0].completedDay;
  const reopened=await put(f,{...c,body:done.body},reopen);assert.equal(assertOk(reopened).state.people[0].tasks[0].spent,60);
});

test('clearing a client timer alone cannot stop the authoritative server timer',async t=>{
  const f=backendFixture();t.after(()=>f.close());const state=sampleState();state.people[0].tasks.push(sampleTask());const c=await f.create({state});const started=await focus(f,c,{action:'start',owner:0,taskId:'task-one',minutes:5});
  const draft=copy(started.body.state);draft.people[0].timer=null;draft.people[0].tasks[0].spent=12345;
  const result=await put(f,{...c,body:started.body},draft);assert.equal(assertOk(result).state.people[0].timer.running,true);assert.equal(result.body.state.people[0].tasks[0].spent,0);
});

test('focus mutations are idempotent and shared/personal allocations exclude one another',async t=>{
  const f=backendFixture();t.after(()=>f.close());const state=sampleState();state.people[0].tasks.push(sampleTask());state.shared.push(sampleTask('shared'));const c=await f.create({state}),id=mutation();
  const first=await focus(f,c,{action:'start',owner:0,taskId:'task-one',minutes:5},id);assertOk(first);f.advance(30000);
  const duplicate=await focus(f,c,{action:'start',owner:0,taskId:'task-one',minutes:5},id);assert.equal(assertOk(duplicate).state.people[0].timer.started,first.body.state.people[0].timer.started);
  const shared=await focus(f,{...c,body:first.body},{action:'start',owner:2,taskId:'shared',minutes:5});assert.equal(shared.body.code,'personal-active');
  const pause=await focus(f,{...c,body:first.body},{action:'pause',owner:0});assert.equal(assertOk(pause).state.people[0].tasks[0].spent,30);
  assert.equal((await focus(f,{...c,body:pause.body},{action:'start',owner:2,taskId:'shared',minutes:5})).body.code,'personal-active');
  const ended=await focus(f,{...c,body:pause.body},{action:'end',owner:0});assertOk(ended);
  const together=await focus(f,{...c,body:ended.body},{action:'start',owner:2,taskId:'shared',minutes:5});assertOk(together);
  assert.equal((await focus(f,{...c,body:together.body},{action:'start',owner:0,taskId:'task-one',minutes:5})).body.code,'together-active');
});

test('personal default focus with thirty estimated seconds left allocates the displayed one-minute minimum',async t=>{
  const f=backendFixture();t.after(()=>f.close());const state=sampleState();state.people[0].tasks.push({...sampleTask(),spent:1470});const c=await f.create({state});
  const started=await focus(f,c,{action:'start',owner:0,taskId:'task-one'});assertOk(started);assert.equal(started.body.state.people[0].timer.remaining,60000);assert.equal(started.body.state.people[0].timer.total,60000);
  f.advance(5*60000);const ended=assertOk(await f.request('GET','/state',undefined,c.token));assert.equal(ended.state.people[0].timer,null);assert.equal(ended.state.people[0].tasks[0].spent,1530);assert.equal(ended.state.people[0].sessions[0].seconds,60);
});

test('shared twenty-five-minute request with thirty estimated seconds left allocates one minute',async t=>{
  const f=backendFixture();t.after(()=>f.close());const state=sampleState();state.shared.push({...sampleTask('shared'),spent:1470});const c=await f.create({state});
  const started=await focus(f,c,{action:'start',owner:2,taskId:'shared',minutes:25});assertOk(started);assert.equal(started.body.state.togetherTimer.remaining,60000);assert.equal(started.body.state.togetherTimer.total,60000);
  f.advance(5*60000);const ended=assertOk(await f.request('GET','/state',undefined,c.token));assert.equal(ended.state.togetherTimer,null);assert.equal(ended.state.shared[0].spent,1530);assert.equal(ended.state.togetherSessions[0].seconds,60);
});

test('shared requested minutes must be whole while the estimated allocation may end between minutes',async t=>{
  const f=backendFixture();t.after(()=>f.close());const state=sampleState();state.shared.push({...sampleTask('shared'),spent:1410});const c=await f.create({state});
  const invalid=await focus(f,c,{action:'start',owner:2,taskId:'shared',minutes:1.5});assert.equal(invalid.status,400);assert.equal(invalid.body.code,'invalid-duration');
  const started=await focus(f,c,{action:'start',owner:2,taskId:'shared',minutes:25});assertOk(started);assert.equal(started.body.revision,1);assert.equal(started.body.state.togetherTimer.remaining,90000);
});

test('IANA protected-time windows and shared midnight accounting are independent of Worker local time',async t=>{
  const f=backendFixture();t.after(()=>f.close());f.setNow('2026-10-18T15:58:00Z');const state=sampleState();state.shared.push(sampleTask('shared'));state.people[1].appointments.push({id:'early',title:'Early appointment',date:'2026-10-19',start:'00:01',end:'00:20'});const c=await f.create({state,zone:'Asia/Manila'});
  assert.equal((await focus(f,c,{action:'start',owner:2,taskId:'shared',minutes:5})).body.code,'outside-hours');
  const started=await focus(f,c,{action:'start',owner:2,taskId:'shared',minutes:5,allowOutsideHours:true});assert.equal(assertOk(started).state.togetherTimer.remaining,3*60000);
  f.advance(10*60000);const completed=assertOk(await f.request('GET','/state',undefined,c.token));assert.deepEqual(completed.state.togetherSessions.map(x=>[x.date,x.seconds]),[['2026-10-18',120],['2026-10-19',60]]);assert.equal(completed.state.shared[0].spent,180);assert.equal(completed.state.togetherTimer,null);
  const again=assertOk(await f.request('GET','/state',undefined,c.token));assert.equal(again.revision,completed.revision);assert.equal(again.state.shared[0].spent,180);
});

test('DST gaps and repeated times resolve deterministically per requested zone',()=>{
  assert.equal(zonedAt('2026-03-08','02:30','America/New_York'),Date.parse('2026-03-08T07:30:00Z'));
  assert.equal(zonedAt('2026-11-01','01:30','America/New_York'),Date.parse('2026-11-01T05:30:00Z'));
  assert.equal(zoneDay(Date.parse('2026-10-18T17:00:00Z'),'Asia/Manila'),'2026-10-19');
  assert.equal(zoneDay(Date.parse('2026-10-18T17:00:00Z'),'America/New_York'),'2026-10-18');
});

test('concurrent expiry reads persist one settlement and one revision',async t=>{
  const f=backendFixture();t.after(()=>f.close());const state=sampleState();state.shared.push(sampleTask('shared'));const pair=await f.pair({state});const start=await focus(f,pair.first,{action:'start',owner:2,taskId:'shared',minutes:1});assertOk(start);f.advance(60001);
  const [a,b]=await Promise.all([f.request('GET','/state',undefined,pair.first.token),f.request('GET','/state',undefined,pair.second.token)]);assertOk(a);assertOk(b);assert.equal(a.body.revision,2);assert.equal(b.body.revision,2);assert.equal(a.body.state.togetherSessions.length,1);assert.equal(b.body.state.shared[0].spent,60);
});

test('server generates current due routine occurrences for both roles without fabricating missed days',async t=>{
  const f=backendFixture();t.after(()=>f.close());const state=sampleState();for(const owner of [0,1])state.people[owner].routines.push({...sampleTask(`routine-${owner}`),repeat:'daily',from:'2026-10-18',days:[],due:'2026-10-18'});const c=await f.create({state});
  const generated=assertOk(await f.request('GET','/state',undefined,c.token));assert.deepEqual(generated.state.people.map(p=>p.tasks.length),[1,1]);
  f.advance(5*86400000);const later=assertOk(await f.request('GET','/state',undefined,c.token));assert.deepEqual(later.state.people.map(p=>p.tasks.length),[2,2]);assert.equal(later.state.people[1].tasks[1].notBefore,'2026-10-23');assert.equal(later.state.people[1].tasks[1].due,'2026-10-23');
});

test('delete Undo restores imported earned time only from server-owned matching history',async t=>{
  const f=backendFixture();t.after(()=>f.close());const state=sampleState();state.people[0].tasks.push({...sampleTask(),spent:123});const c=await f.create({state}),removed=copy(c.body.state);removed.people[0].tasks=[];
  const deletion=await put(f,c,removed);assertOk(deletion);const undo=copy(deletion.body.state);undo.people[0].tasks.push({...sampleTask(),spent:0});
  const restored=await put(f,{...c,body:deletion.body},undo);assert.equal(assertOk(restored).state.people[0].tasks[0].spent,123);
});

test('routine occurrence deletion and Undo preserve its identity without generating a duplicate',async t=>{
  const f=backendFixture();t.after(()=>f.close());const state=sampleState();state.people[0].routines.push({...sampleTask('morning-routine'),repeat:'daily',from:'2026-10-18',days:[]});const c=await f.create({state});
  const generated=assertOk(await f.request('GET','/state',undefined,c.token)),original=copy(generated.state.people[0].tasks[0]),draft=copy(generated.state);draft.people[0].tasks=[];
  const deleted=await put(f,{...c,body:generated},draft);assertOk(deleted);
  const afterRead=assertOk(await f.request('GET','/state',undefined,c.token));assert.equal(afterRead.state.people[0].tasks.length,0);
  const undo=copy(afterRead.state);undo.people[0].tasks.push(original);const restored=await put(f,{...c,body:afterRead},undo);assertOk(restored);
  const final=assertOk(await f.request('GET','/state',undefined,c.token));assert.equal(final.state.people[0].tasks.length,1);assert.equal(final.state.people[0].tasks[0].routine,'morning-routine');assert.equal(final.state.people[0].tasks[0].id,original.id);
  const forged=copy(final.state);forged.people[0].tasks.push({...original,id:'morning-routine:2026-10-19',occurrenceDate:'2026-10-19'});assert.equal((await put(f,{...c,body:final},forged)).status,403);
});

test('deletion Undo can preserve an existing verified help offer, but a new task cannot invent one',async t=>{
  const f=backendFixture();t.after(()=>f.close());const state=sampleState(),task={...sampleTask(),help:true,helper:1};state.people[0].tasks.push(task);const c=await f.create({state}),draft=copy(c.body.state);draft.people[0].tasks=[];
  const deleted=await put(f,c,draft);assertOk(deleted);const undo=copy(deleted.body.state);undo.people[0].tasks.push(task);const restored=await put(f,{...c,body:deleted.body},undo);assert.equal(assertOk(restored).state.people[0].tasks[0].helper,1);
  const forged=copy(restored.body.state);forged.people[0].tasks.push({...task,id:'invented-offer'});assert.equal((await put(f,{...c,body:restored.body},forged)).status,403);
});

test('moving, assigning, completing or deleting a shared timer task settles its elapsed time once',async t=>{
  for(const action of ['move','assign','complete','delete']){
    const f=backendFixture();try{
      const state=sampleState();state.shared.push(sampleTask('shared'));const c=await f.create({state});const started=await focus(f,c,{action:'start',owner:2,taskId:'shared',minutes:5});assertOk(started);f.advance(30000);
      const draft=copy(started.body.state),task=draft.shared[0];draft.togetherTimer=null;
      if(action==='move'){draft.shared=[];draft.people[0].tasks.push(task);}
      if(action==='assign'){draft.shared=[];task.request={from:0,to:1,origin:2};draft.people[1].tasks.push(task);}
      if(action==='complete'){task.status='done';task.completed='2025-01-01T00:00:00Z';task.completedDay='2025-01-01';}
      if(action==='delete')draft.shared=[];
      const saved=assertOk(await put(f,{...c,body:started.body},draft));assert.equal(saved.state.togetherTimer,null,action);assert.equal(saved.state.togetherSessions.length,1,action);assert.equal(saved.state.togetherSessions[0].seconds,30,action);
      if(action!=='delete'){const retained=[...saved.state.shared,...saved.state.people.flatMap(p=>p.tasks)][0];assert.equal(retained.spent,30,action);}
      if(action==='complete')assert.ok(saved.state.people.every(p=>p.restUntil>f.now()));
      f.advance(10000);const refreshed=assertOk(await f.request('GET','/state',undefined,c.token));assert.equal(refreshed.state.togetherSessions.length,1,action);
    }finally{f.close();}
  }
});

test('imports and explicit restores pause active allocations and preserve member credentials',async t=>{
  const f=backendFixture();t.after(()=>f.close());const state=sampleState();state.shared.push(sampleTask('shared'));state.togetherTimer={task:'shared',remaining:300000,started:f.now()-60000,running:true};
  const pair=await f.pair({state});assertOk(pair.first);assert.equal(pair.first.body.state.togetherTimer.running,false);assert.equal(pair.first.body.state.togetherTimer.remaining,240000);assert.equal(pair.first.body.state.shared[0].spent,60);
  const importState=copy(pair.second.body.state);importState.togetherTimer={task:'shared',remaining:120000,started:f.now()-30000,running:true};
  const restored=await f.request('POST','/restore',{revision:pair.second.body.revision,mutationId:mutation(),state:importState},pair.second.token);assertOk(restored);assert.equal(restored.body.state.togetherTimer.running,false);assert.equal(restored.body.state.shared[0].spent,90);assert.equal(restored.body.revision,1);
  assert.equal(assertOk(await f.request('GET','/state',undefined,pair.first.token)).spaceId,pair.second.body.spaceId);assert.equal(assertOk(await f.request('GET','/state',undefined,pair.second.token)).role,1);
});

test('missing states and malformed record entries return validation errors without a partial save',async t=>{
  const f=backendFixture();t.after(()=>f.close());const invalidCreate=await f.request('POST','/spaces',{role:0,zone:'Asia/Manila',deviceToken:capability(),recoveryKey:capability(),deviceName:'Phone'});assert.equal(invalidCreate.status,400);assert.equal(invalidCreate.body.code,'invalid_state');
  const c=await f.create();const missing=await f.request('PUT','/state',{revision:0,mutationId:mutation()},c.token);assert.equal(missing.status,400);
  for(const change of [s=>s.notes.push(null),s=>s.people[0].appointments.push(null)]){const draft=copy(c.body.state);change(draft);assert.equal((await put(f,c,draft)).status,400);}
  const saved=assertOk(await f.request('GET','/state',undefined,c.token));assert.equal(saved.revision,0);assert.equal(f.DB.raw.prepare('SELECT COUNT(*) AS n FROM couple_snapshots').get().n,0);
});

test('reusing a deleted partner ID with claimed spent0 cannot take ownership of their recorded time',async t=>{
  const f=backendFixture();t.after(()=>f.close());const state=sampleState();state.people[1].tasks.push(sampleTask('partner-task'));const pair=await f.pair({state});const started=await focus(f,pair.second,{action:'start',owner:1,taskId:'partner-task',minutes:5});f.advance(60000);
  const draft=copy(started.body.state);draft.people[1].tasks=[];draft.people[1].timer=null;const deleted=await put(f,{...pair.second,body:started.body},draft);assertOk(deleted);
  const stolen=copy(deleted.body.state);stolen.people[0].tasks.push(sampleTask('partner-task'));
  assert.equal((await put(f,{...pair.first,body:deleted.body},stolen)).status,403);
  f.DB.raw.exec('DELETE FROM couple_snapshots');assert.equal((await put(f,{...pair.first,body:deleted.body},stolen)).status,403);
});

test('history is space-scoped, limited to50 snapshots, and explicit restore creates a new revision without changing credentials',async t=>{
  const f=backendFixture();t.after(()=>f.close());let c=await f.create();const other=await f.create();
  for(let n=0;n<54;n++){const result=await put(f,c,{...copy(c.body.state),tagline:`Revision ${n}`});assertOk(result);c={...c,body:result.body};f.advance(1);}
  const history=assertOk(await f.request('GET','/history',undefined,c.token)).snapshots;assert.equal(history.length,50);
  const chosen=history[10];assert.equal((await f.request('GET',`/history/${chosen.id}`,undefined,other.token)).status,404);
  const forbiddenRestore=await f.request('POST','/restore',{snapshotId:chosen.id,revision:other.body.revision,mutationId:mutation()},other.token);assert.equal(forbiddenRestore.status,404);
  const restore=await f.request('POST','/restore',{snapshotId:chosen.id,revision:c.body.revision,mutationId:mutation()},c.token);assert.equal(assertOk(restore).revision,55);assert.equal(restore.body.spaceId,c.body.spaceId);assert.equal(restore.body.deviceId,c.body.deviceId);
  assertOk(await f.request('GET','/state',undefined,c.token));
});

test('CORS rejects untrusted origins and public request parsing rejects prototype keys and oversized input',async t=>{
  const f=backendFixture();t.after(()=>f.close());assert.equal((await f.request('GET','/health',undefined,undefined,{Origin:'https://evil.example'})).status,403);
  assert.equal((await f.request('GET','/health',undefined,undefined,{Origin:'http://localhost:3000'})).status,403);
  const preflight=await f.request('OPTIONS','/state');assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'https://nashjavelona.github.io');assert.equal(preflight.headers.get('access-control-allow-credentials'),null);
  const badBody=await handleApi(new Request('https://momentum-my-second-brain.void-mag-inv-5623.chatgpt.site/api/spaces',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"__proto__":{"bad":true}}'}),f.env);assert.equal(badBody.status,400);
  const big=await f.request('POST','/spaces',{content:'x'.repeat(1024*1024)});assert.equal(big.status,413);
});

test('public recovery attempts are bounded by rate limits',async t=>{
  const f=backendFixture();t.after(()=>f.close());const payload={spaceId:'missing',role:0,recoveryKey:capability(),deviceToken:capability(),deviceName:'Phone'};
  for(let i=0;i<20;i++)assert.equal((await f.request('POST','/recover',payload)).status,401);
  const limited=await f.request('POST','/recover',payload);assert.equal(limited.status,429);assert.equal(limited.body.code,'rate_limited');
});


test('a connected provisional token can replay its pairing response even after the hourly IP limit', async t => {
  const f = backendFixture(); t.after(()=>f.close());
  const created = await f.create(); assertOk(created);
  const payload = {state:null, role:0, zone:'Asia/Manila', deviceName:'Test device', deviceToken:capability(), recoveryKey:capability()};
  for(let i=0;i<19;i++) assert.equal((await f.request('POST','/spaces',{...payload,deviceToken:capability()})).status,400);
  assert.equal((await f.request('POST','/spaces',{...payload,deviceToken:capability()})).status,429);
  const replay = await f.request('POST','/spaces',{...payload,deviceToken:created.token});
  assert.equal(replay.status,200);
  assert.equal(replay.body.spaceId,created.body.spaceId);
  assert.equal(replay.body.deviceId,created.body.deviceId);
  assert.equal((await f.request('GET','/state',undefined,created.token)).status,200);
});
