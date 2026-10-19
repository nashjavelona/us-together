import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parse,plan,settle} from '../core.js';
import {initial,validCouple} from '../couple.js';
import {settleTogether} from '../together.js';
import {nextAction,focusWindow,validateTaskDraft,applyTaskDraft,backupSnapshot,reconcileSteps} from '../ui-model.js';

const minute=60000;
const now=new Date('2026-10-18T10:00:00').getTime();

function personalFixture(at=now){
  const s=initial(),task=parse('Study Python for 45 minutes',25,new Date(at));
  s.people[0].tasks.push(task);
  return {s,person:s.people[0],task};
}

function draft(task){
  return {
    title:task.title,minutes:task.minutes,priority:task.priority,due:task.due,
    notBefore:task.notBefore,preferred:task.preferred,
    steps:task.steps.map(step=>({...step}))
  };
}

test('the next action shows the current appointment instead of a future task',()=>{
  const {person,task}=personalFixture();
  task.preferred='15:00';
  person.appointments.push({id:'appointment',title:'Lunch with family',date:'2026-10-18',start:'10:00',end:'11:00'});
  const at=now+30*minute;
  plan(person,at);
  assert.ok(person.plans['2026-10-18'].blocks.some(b=>b.type==='focus'&&b.start>at));
  const action=nextAction(person,at);
  assert.equal(action.kind,'appointment');
  assert.equal(action.appointment.id,'appointment');
  assert.equal(action.task,undefined);
  assert.deepEqual(focusWindow(person,task,null,at).reason,'appointment');
});

test('a ready card at 20:55 displays the same five minutes the timer can actually start',()=>{
  const at=new Date('2026-10-18T20:55:00').getTime(),{person,task}=personalFixture(at);
  person.settings.end='21:00';
  plan(person,at);
  const action=nextAction(person,at),window=focusWindow(person,task,null,at);
  assert.equal(action.kind,'ready');
  assert.equal(window.ok,true);
  assert.equal(action.duration,5*minute);
  assert.equal(action.duration,window.duration);
  assert.equal(action.block.end-action.block.start,action.duration);
});

test('editing only the title and checklist keeps a running timer and its allocation intact',()=>{
  const {s,person,task}=personalFixture();
  person.timer={task:task.id,remaining:25*minute,started:now,running:true};
  const timer=person.timer,before={...timer};
  const result=applyTaskDraft(s,task.id,{...draft(task),title:'  Practice Python loops  ',steps:[{title:'Open the exercise',done:true},{title:'Write one loop',done:false}]},now+5*minute);
  assert.deepEqual(result,{ok:true,stopped:false});
  assert.equal(task.title,'Practice Python loops');
  assert.deepEqual(task.steps,[{title:'Open the exercise',done:true},{title:'Write one loop',done:false}]);
  assert.equal(person.timer,timer);
  assert.deepEqual(person.timer,before);
  assert.equal(task.spent,0);
  assert.equal(person.sessions.length,0);
  settle(person,now+6*minute);
  assert.equal(task.spent,360);
  assert.equal(person.timer.remaining,19*minute);
});

test('moving a running task to a future day stops focus and keeps the earned time',()=>{
  const {s,person,task}=personalFixture();
  person.timer={task:task.id,remaining:25*minute,started:now,running:true};
  const result=applyTaskDraft(s,task.id,{...draft(task),notBefore:'2026-10-19'},now+5*minute);
  assert.deepEqual(result,{ok:true,stopped:true});
  assert.equal(person.timer,null);
  assert.equal(task.notBefore,'2026-10-19');
  assert.equal(task.spent,300);
  assert.equal(person.sessions.reduce((total,session)=>total+session.seconds,0),300);
  assert.equal(task.status,'open');
  assert.ok(validCouple(s));
});

test('invalid task form values are rejected before changing the task or its running timer',()=>{
  const {s,person,task}=personalFixture();
  person.timer={task:task.id,remaining:25*minute,started:now,running:true};
  const before=JSON.stringify(s);
  for(const invalid of [
    {title:'   '},{title:'x'.repeat(301)},{minutes:0},{minutes:NaN},{minutes:1441},
    {priority:'Urgent'},{notBefore:'2026-02-30'},{due:'2026-02-30'},
    {preferred:'24:90'},{notBefore:'2026-10-19',due:'2026-10-18'}
  ]){
    const values={...draft(task),...invalid};
    assert.ok(validateTaskDraft(values));
    const result=applyTaskDraft(s,task.id,values,now+5*minute);
    assert.equal(result.ok,false);
    assert.ok(result.error);
    assert.equal(JSON.stringify(s),before);
  }
});

test('a personal backup pauses the exported copy at export time without changing the live timer',()=>{
  const {s,person,task}=personalFixture();
  person.timer={task:task.id,remaining:25*minute,started:now,running:true};
  const before=JSON.stringify(s),copy=backupSnapshot(s,now+5*minute),saved=copy.people[0];
  assert.equal(JSON.stringify(s),before);
  assert.equal(person.timer.running,true);
  assert.equal(saved.timer.running,false);
  assert.equal(saved.timer.remaining,20*minute);
  assert.equal(saved.tasks[0].spent,300);
  assert.equal(saved.sessions.reduce((total,session)=>total+session.seconds,0),300);
  assert.ok(validCouple(copy));
  const restored=JSON.parse(JSON.stringify(copy));
  assert.equal(settle(restored.people[0],now+7*86400000),0);
  assert.equal(restored.people[0].tasks[0].spent,300);
  assert.equal(restored.people[0].timer.remaining,20*minute);
  assert.equal(restored.people[0].sessions.reduce((total,session)=>total+session.seconds,0),300);
});

test('a shared backup pauses only the copy and cannot accrue extra time before a later restore',()=>{
  const s=initial(),task=parse('Plan our weekend for 45 minutes',25,new Date(now));
  s.shared.push(task);
  s.togetherTimer={task:task.id,remaining:25*minute,started:now,running:true};
  const before=JSON.stringify(s),copy=backupSnapshot(s,now+2*minute);
  assert.equal(JSON.stringify(s),before);
  assert.equal(s.togetherTimer.running,true);
  assert.equal(copy.togetherTimer.running,false);
  assert.equal(copy.togetherTimer.remaining,23*minute);
  assert.equal(copy.shared[0].spent,120);
  assert.equal(copy.togetherSessions.reduce((total,session)=>total+session.seconds,0),120);
  assert.equal(copy.people.flatMap(person=>person.sessions).length,0);
  assert.ok(validCouple(copy));
  const restored=JSON.parse(JSON.stringify(copy));
  assert.equal(settleTogether(restored,now+7*86400000),0);
  assert.equal(restored.shared[0].spent,120);
  assert.equal(restored.togetherTimer.remaining,23*minute);
  assert.equal(restored.togetherSessions.reduce((total,session)=>total+session.seconds,0),120);
});

test('rescheduling the shared task also stops its timer without losing or duplicating earned time',()=>{
  const s=initial(),task=parse('Plan our weekend for 45 minutes',25,new Date(now));
  s.shared.push(task);
  s.togetherTimer={task:task.id,remaining:25*minute,started:now,running:true};
  assert.deepEqual(applyTaskDraft(s,task.id,{...draft(task),notBefore:'2026-10-19'},now+3*minute),{ok:true,stopped:true});
  assert.equal(s.togetherTimer,null);
  assert.equal(task.spent,180);
  assert.equal(s.togetherSessions.reduce((total,session)=>total+session.seconds,0),180);
  assert.equal(s.people.flatMap(person=>person.sessions).length,0);
  assert.ok(validCouple(s));
});

test('a paused personal timer may finish its final seconds without crossing a calendar boundary',()=>{
 const {person,task}=personalFixture();
 assert.deepEqual(focusWindow(person,task,.5,now,false,true),{ok:true,duration:30000});
 person.appointments.push({id:'boundary',title:'Protected',date:'2026-10-18',start:'10:01',end:'10:30'});
 assert.deepEqual(focusWindow(person,task,.5,now+45000,false,true),{ok:false,reason:'short'});
});
test('an unfinished personal task with a fractional-minute estimate has a usable continuation',()=>{
 const {person,task}=personalFixture();task.minutes=5;task.spent=270;
 assert.deepEqual(focusWindow(person,task,null,now),{ok:true,duration:60000});
});
test('inserting, removing and reordering unchanged steps preserves checkmarks including duplicates',()=>{
 const previous=[{title:'Read',done:true},{title:'Write',done:true},{title:'Read',done:false}];
 assert.deepEqual(reconcileSteps('New\nWrite\nRead\nRead',previous),[{title:'New',done:false},{title:'Write',done:true},{title:'Read',done:true},{title:'Read',done:false}]);
 assert.deepEqual(reconcileSteps('Write\nRenamed',previous),[{title:'Write',done:true},{title:'Renamed',done:false}]);
});
