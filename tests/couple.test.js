import {test} from 'node:test';import assert from 'node:assert/strict';import {initial,locate,move,finish,validCouple,migrate} from '../couple.js';import {parse,defaults,generate} from '../core.js';
test('fresh couple space has no fake tasks or achievements',()=>{const s=initial();assert.ok(validCouple(s));assert.equal(s.shared.length,0);assert.equal(s.people[0].tasks.length,0);assert.equal(s.people[1].tasks.length,0);});
test('assignment transfers ownership, retaining task identity and steps',()=>{const s=initial(),t=parse('Study for 45 minutes');t.steps=[{title:'Open notes',done:true}];s.people[0].tasks.push(t);assert.ok(move(s,t.id,1,0));assert.equal(locate(s,t.id).owner,1);assert.equal(s.people[0].tasks.length,0);assert.equal(s.people[1].tasks[0].steps[0].done,true);assert.equal(t.assignedBy,0);});
test('moving active task stops old timer and accounts for time',()=>{const s=initial(),t=parse('Task');s.people[0].tasks.push(t);s.people[0].timer={task:t.id,remaining:60000,started:Date.now()-10000,running:true};move(s,t.id,2);assert.equal(s.people[0].timer,null);assert.ok(t.spent>=10);assert.equal(s.shared[0].id,t.id);assert.equal(s.people[0].sessions.length,1);});
test('shared completion is recorded once and attributed to shared space',()=>{const s=initial(),t=parse('Groceries');s.shared.push(t);finish(s,t.id);const timestamp=t.completed;finish(s,t.id);assert.equal(t.completed,timestamp);assert.equal(t.status,'done');assert.equal(locate(s,t.id).owner,2);});
test('existing Momentum work is preserved on black side',()=>{const old=defaults();old.tasks.push(parse('Existing work'));const s=migrate(old);assert.equal(s.people[0].tasks[0].title,'Existing work');assert.equal(s.people[1].tasks.length,0);assert.ok(validCouple(s));});
test('backup roundtrip retains nicknames, help and notes',()=>{const s=initial();s.names=['Nash','Love'];const t=parse('Task');t.help=true;t.helper=1;s.people[0].tasks.push(t);s.notes.push({id:'1',from:1,text:'You can do it',date:new Date().toISOString()});const v=JSON.parse(JSON.stringify(s));assert.ok(validCouple(v));assert.equal(v.people[0].tasks[0].helper,1);assert.equal(v.names[1],'Love');assert.ok(!validCouple({...v,names:[null,'X']}));});
test('routine generated steps are independent and reset for a new day',()=>{const p=defaults(),t=parse('Routine');p.routines.push({...t,repeat:'daily',from:'2026-10-18',days:[],steps:[{title:'First step',done:true}]});generate(p,'2026-10-18');assert.equal(p.tasks[0].steps[0].done,false);p.tasks[0].steps[0].done=true;generate(p,'2026-10-19');assert.equal(p.tasks[1].steps[0].done,false);});
import {todayTasks,requestMove,respond,rejectRequest,undoSnapshot,restoreAction} from '../couple.js';
import {plan,day} from '../core.js';
test('future tasks are excluded from today count and schedule',()=>{const s=initial(),t=parse('Tomorrow');t.notBefore='2099-01-01';s.people[0].tasks.push(t);assert.equal(todayTasks(s,0).length,0);assert.equal(plan(s.people[0]).blocks.filter(b=>b.task===t.id).length,0);});
test('partner request stays out of plan and cannot be completed until accepted',()=>{const s=initial(),t=parse('Review');s.people[0].tasks.push(t);requestMove(s,t.id,1,0);assert.equal(t.request.to,1);assert.equal(todayTasks(s,1).length,0);assert.equal(plan(s.people[1]).blocks.filter(b=>b.task===t.id).length,0);finish(s,t.id);assert.equal(t.status,'open');assert.equal(respond(s,t.id,0),false);assert.ok(respond(s,t.id,1));assert.equal(todayTasks(s,1).length,1);});
test('recipient accepts request for another day',()=>{const s=initial(),t=parse('Review');s.people[0].tasks.push(t);requestMove(s,t.id,1,0);respond(s,t.id,1,'2099-02-01');assert.equal(t.notBefore,'2099-02-01');assert.equal(t.request,undefined);assert.equal(todayTasks(s,1).length,0);});
test('undo completion preserves accumulated focus and restores open state',()=>{const s=initial(),t=parse('Study');s.people[0].tasks.push(t);t.spent=300;const snapshot=undoSnapshot(t);finish(s,t.id);assert.equal(t.status,'done');restoreAction(s,snapshot);assert.equal(t.status,'open');assert.equal(t.completed,undefined);assert.equal(t.spent,300);});
test('undo archive restores completed history if present',()=>{const s=initial(),t=parse('Finished');s.shared.push(t);finish(s,t.id);const snapshot=undoSnapshot(t);t.status='archived';restoreAction(s,snapshot);assert.equal(t.status,'done');assert.equal(t.completed,snapshot.completed);});
test('mistyped calendar dates cannot make the saved couple workspace unreadable',()=>{
 const s=initial(),existing=parse('Keep our existing plans');s.people[1].tasks.push(existing);
 for(const date of ['2026-02-30','2026-02-29','2026-13-01','2026-00-10']){
  const t=parse(`Buy gifts on ${date} for 30 minutes`);s.people[0].tasks.push(t);
  assert.equal(t.due,'');assert.ok(t.title.includes(date));assert.equal(t.minutes,30);
  const saved=JSON.parse(JSON.stringify(s));assert.ok(validCouple(saved));assert.equal(saved.people[1].tasks[0].id,existing.id);
 }
 assert.equal(parse('Plan a trip on 2028-02-29').due,'2028-02-29');
 const relative=parse('Check 2026-02-30 tomorrow');assert.ok(relative.notBefore);assert.ok(relative.due);
});
test('declining or cancelling a shared task request restores the shared list and task details',()=>{
 for(const actor of [0,1]){
  const s=initial(),t=parse('Plan dinner for 30 minutes');t.steps=[{title:'Choose a place',done:true}];s.shared.push(t);
  assert.ok(requestMove(s,t.id,1,0));assert.equal(t.request.origin,2);
  const saved=JSON.parse(JSON.stringify(s));assert.ok(validCouple(saved));
  assert.ok(rejectRequest(saved,t.id,actor));const returned=locate(saved,t.id);
  assert.equal(returned.owner,2);assert.equal(saved.people[1].tasks.length,0);assert.equal(saved.shared.length,1);
  assert.equal(returned.t.minutes,30);assert.equal(returned.t.steps[0].done,true);assert.equal(returned.t.request,undefined);assert.ok(validCouple(saved));
 }
});
test('older requests without origin still return to their sender',()=>{
 const s=initial(),t=parse('Review our plans');s.people[1].tasks.push(t);t.request={from:0,to:1,created:new Date().toISOString()};
 assert.ok(validCouple(s));assert.ok(rejectRequest(s,t.id,1));assert.equal(locate(s,t.id).owner,0);assert.ok(validCouple(s));
});
test('returned recurring tasks are not generated twice and future occurrences remain with their owner',()=>{
 const s=initial(),r={...parse('Daily review'),repeat:'daily',from:'2026-10-18',days:[]};s.people[0].routines.push(r);generate(s.people[0],'2026-10-18');
 const id=s.people[0].tasks[0].id;assert.ok(requestMove(s,id,1,0));assert.ok(rejectRequest(s,id,1));
 generate(s.people[0],'2026-10-18');assert.equal(s.people[0].tasks.length,1);assert.equal(s.people[1].tasks.length,0);
 generate(s.people[0],'2026-10-19');assert.equal(s.people[0].tasks.length,2);assert.equal(new Set(s.people[0].tasks.map(t=>t.id)).size,2);
});
test('invalid transfer targets and invalid request origins cannot remove a task',()=>{
 const s=initial(),t=parse('Keep this task');s.people[0].tasks.push(t);
 assert.equal(move(s,t.id,3),false);assert.equal(locate(s,t.id).owner,0);
 assert.ok(requestMove(s,t.id,1,0));t.request.origin=3;
 assert.equal(validCouple(s),false);assert.equal(rejectRequest(s,t.id,1),false);assert.equal(locate(s,t.id).owner,1);assert.ok(t.request);
});
test('optional couple check-ins preserve older backups and validate saved choices',()=>{
 const s=initial();assert.ok(validCouple(s));s.checkins={date:'2026-10-18',moods:[null,'soft']};s.momentIndex=5;
 assert.ok(validCouple(JSON.parse(JSON.stringify(s))));
 s.checkins.moods=['steady','bright'];assert.ok(validCouple(s));
 s.checkins.moods=['steady','unknown'];assert.equal(validCouple(s),false);
 s.checkins.moods=[null,null];s.checkins.date='2026-02-30';assert.equal(validCouple(s),false);
 delete s.checkins;s.momentIndex=6;assert.equal(validCouple(s),false);
 delete s.momentIndex;assert.ok(validCouple(s));
});
test('accepting after a deadline requires an explicit extension and changes nothing on rejection',()=>{
 const s=initial(),t=parse('Book dinner');t.notBefore='2026-10-18';t.due='2026-10-23';s.people[0].tasks.push(t);requestMove(s,t.id,1,0);
 const before=JSON.stringify(s);assert.equal(respond(s,t.id,1,'2026-10-24'),false);assert.equal(JSON.stringify(s),before);
 assert.ok(respond(s,t.id,1,'2026-10-24',true));assert.equal(t.notBefore,'2026-10-24');assert.equal(t.due,'2026-10-24');assert.equal(t.request,undefined);
});
test('shared timer backups require an unfinished shared task and valid session accounting',()=>{
 const s=initial(),t=parse('Plan dinner');s.shared.push(t);s.togetherTimer={task:t.id,remaining:300000,started:Date.now(),running:true};s.togetherSessions=[];
 assert.ok(validCouple(JSON.parse(JSON.stringify(s))));
 s.togetherTimer.task='missing';assert.equal(validCouple(s),false);s.togetherTimer.task=t.id;
 s.togetherTimer.remaining=-1;assert.equal(validCouple(s),false);s.togetherTimer.remaining=300000;
 t.status='archived';assert.equal(validCouple(s),false);t.status='open';
 s.togetherSessions=[{date:'2026-10-18',start:1000,end:2000,seconds:-1}];assert.equal(validCouple(s),false);
 s.togetherSessions[0].seconds=1;assert.ok(validCouple(s));
 const own=parse('My task');s.people[0].tasks.push(own);s.people[0].timer={task:own.id,remaining:300000,started:Date.now(),running:false};
 assert.equal(validCouple(s),false);s.people[0].timer.running=true;assert.equal(validCouple(s),false);s.people[0].timer=null;assert.ok(validCouple(s));
});
test('assigning a shared task settles its earned shared time once before changing ownership',()=>{
 const s=initial(),t=parse('Plan dinner');s.shared.push(t);s.togetherTimer={task:t.id,remaining:60000,started:Date.now()-120000,running:true};
 assert.ok(requestMove(s,t.id,1,0));assert.equal(s.togetherTimer,null);assert.equal(t.spent,60);assert.equal(t.request.origin,2);
 assert.equal(s.togetherSessions.reduce((n,x)=>n+x.seconds,0),60);assert.equal(s.people.flatMap(p=>p.sessions).length,0);
 assert.ok(rejectRequest(s,t.id,1));assert.equal(t.spent,60);assert.equal(s.togetherSessions.reduce((n,x)=>n+x.seconds,0),60);assert.ok(validCouple(s));
});
test('completing a shared task settles its timer and records one shared win',()=>{
 const s=initial(),t=parse('Plan dinner'),now=Date.now();s.shared.push(t);s.togetherTimer={task:t.id,remaining:300000,started:now,running:true};
 finish(s,t.id,now+60000);finish(s,t.id,now+120000);
 assert.equal(s.togetherTimer,null);assert.equal(t.spent,60);assert.equal(t.status,'done');assert.equal(t.completed,new Date(now+60000).toISOString());
 assert.equal(s.togetherSessions.reduce((n,x)=>n+x.seconds,0),60);assert.equal(s.people.flatMap(p=>p.sessions).length,0);assert.ok(validCouple(s));
});
test('archived completion history rejects malformed backup timestamps before rendering wins',()=>{
 const s=initial(),t=parse('Our little win');s.shared.push(t);finish(s,t.id);t.status='archived';
 assert.ok(validCouple(s));t.completed={bad:true};assert.equal(validCouple(s),false);
 t.completed=new Date().toISOString();t.completedDay='2026-02-30';assert.equal(validCouple(s),false);
 delete t.completed;delete t.completedDay;assert.ok(validCouple(s));
 t.completed=new Date().toISOString();assert.equal(validCouple(s),false);
});
