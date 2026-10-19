import {test} from 'node:test';
import assert from 'node:assert/strict';
import {day,parse} from '../core.js';
import {initial} from '../couple.js';
import {beginTogether,pauseTogether,resumeTogether,endTogether,settleTogether} from '../together.js';

const minute=60000;
const now=new Date('2026-10-18T10:00:00').getTime();
function setup(minutes=45){
  const s=initial();
  s.names=['Nash','Love'];
  s.shared.push(parse(`Plan our weekend for ${minutes} minutes`,25,new Date(now)));
  return s;
}
function appointment(s,owner,start,end,date=day(new Date(now))){
  s.people[owner].appointments.push({id:`appointment-${owner}`,title:'Protected time',date,start,end});
}

test('shared pause, resume and end credit only worked time once without completing the task',()=>{
  const s=setup(),task=s.shared[0];
  assert.deepEqual(beginTogether(s,task.id,25,now),{ok:true});
  assert.equal(pauseTogether(s,now+2*minute),2*minute);
  assert.equal(task.spent,120);
  assert.equal(s.togetherTimer.remaining,23*minute);
  assert.equal(settleTogether(s,now+5*minute),0);
  assert.deepEqual(resumeTogether(s,now+10*minute),{ok:true});
  assert.equal(s.togetherTimer.remaining,23*minute);
  assert.equal(endTogether(s,now+11*minute),minute);
  assert.equal(task.spent,180);
  assert.equal(s.togetherSessions.reduce((n,x)=>n+x.seconds,0),180);
  assert.equal(s.togetherTimer,null);
  assert.equal(task.status,'open');
  assert.equal(endTogether(s,now+12*minute),0);
  assert.equal(task.spent,180);
  assert.equal(s.people.flatMap(p=>p.sessions).length,0);
});

test('shared expiry is capped to its allocation even after a long absence',()=>{
  const s=setup(),task=s.shared[0];
  beginTogether(s,task.id,5,now);
  assert.equal(settleTogether(s,now+60*minute),5*minute);
  assert.equal(task.spent,300);
  assert.equal(s.togetherTimer.remaining,0);
  assert.equal(s.togetherSessions[0].end,now+5*minute);
  assert.equal(settleTogether(s,now+70*minute),0);
  assert.deepEqual(resumeTogether(s,now+70*minute),{ok:false,reason:'finished'});
});

test('either partner having a running or paused personal timer prevents shared focus',()=>{
  for(const owner of [0,1])for(const running of [false,true]){
    const s=setup(),task=s.shared[0];
    s.people[owner].timer={task:'personal-task',remaining:25*minute,started:now,running};
    const before=JSON.stringify(s);
    assert.deepEqual(beginTogether(s,task.id,25,now),{ok:false,reason:'personal-active'});
    assert.equal(JSON.stringify(s),before);
  }
});

test('a shared timer cannot be replaced or resumed over a personal timer',()=>{
  const s=setup(),task=s.shared[0];
  beginTogether(s,task.id,25,now);
  assert.deepEqual(beginTogether(s,task.id,5,now),{ok:false,reason:'together-active'});
  assert.deepEqual(resumeTogether(s,now),{ok:false,reason:'already-running'});
  pauseTogether(s,now+minute);
  s.people[1].timer={task:'personal-task',remaining:5*minute,started:now,running:false};
  assert.deepEqual(resumeTogether(s,now+2*minute),{ok:false,reason:'personal-active'});
  assert.equal(s.togetherTimer.remaining,24*minute);
  assert.equal(s.togetherTimer.running,false);
});

test('actual appointments for either person block new and resumed focus even with hours override',()=>{
  for(const owner of [0,1]){
    const s=setup(),task=s.shared[0];
    appointment(s,owner,'10:00','11:00');
    assert.deepEqual(beginTogether(s,task.id,25,now,true),{ok:false,reason:'appointment'});
    s.togetherTimer={task:task.id,remaining:20*minute,started:now-minute,running:false};
    assert.deepEqual(resumeTogether(s,now,true),{ok:false,reason:'appointment'});
  }
});

test('both calendars constrain shared focus to the earliest next appointment',()=>{
  const s=setup(),task=s.shared[0];
  appointment(s,0,'10:20','10:40');
  appointment(s,1,'10:08','10:30');
  assert.deepEqual(beginTogether(s,task.id,25,now),{ok:true});
  assert.equal(s.togetherTimer.remaining,8*minute);
  pauseTogether(s,now+2*minute);
  assert.deepEqual(resumeTogether(s,now+6*minute),{ok:true});
  assert.equal(s.togetherTimer.remaining,2*minute);
  endTogether(s,now+30*minute);
  assert.equal(task.spent,240);
});

test('shared focus honors both day windows and caps to the earlier day end',()=>{
  const s=setup(),task=s.shared[0];
  s.people[0].settings.end='10:20';
  s.people[1].settings.end='10:10';
  assert.deepEqual(beginTogether(s,task.id,25,now),{ok:true});
  assert.equal(s.togetherTimer.remaining,10*minute);
  endTogether(s,now);
  s.people[1].settings.start='10:05';
  assert.deepEqual(beginTogether(s,task.id,25,now),{ok:false,reason:'outside-hours'});
  assert.deepEqual(beginTogether(s,task.id,25,now,true),{ok:true});
  assert.equal(s.togetherTimer.remaining,25*minute);
  pauseTogether(s,now+minute);
  assert.deepEqual(resumeTogether(s,now+30*minute),{ok:false,reason:'outside-hours'});
  assert.deepEqual(resumeTogether(s,now+30*minute,true),{ok:true});
  assert.equal(s.togetherTimer.remaining,24*minute);
});

test('an hours override does not bypass a current break for either partner',()=>{
  for(const owner of [0,1]){
    const s=setup(),task=s.shared[0];
    s.people[owner].restUntil=now+minute;
    assert.deepEqual(beginTogether(s,task.id,5,now,true),{ok:false,reason:'break'});
    s.togetherTimer={task:task.id,remaining:5*minute,started:now-minute,running:false};
    assert.deepEqual(resumeTogether(s,now,true),{ok:false,reason:'break'});
    assert.deepEqual(resumeTogether(s,now+minute,true),{ok:true});
  }
});

test('new sessions reject sub-minute calendar windows and invalid requested minutes',()=>{
  const s=setup(),task=s.shared[0];
  for(const minutes of [0,-1,121,1.5,NaN,'5']){
    assert.deepEqual(beginTogether(s,task.id,minutes,now),{ok:false,reason:'invalid-duration'});
  }
  appointment(s,1,'10:01','11:00');
  assert.deepEqual(beginTogether(s,task.id,5,now+30000),{ok:false,reason:'short-window'});
  assert.equal(s.togetherTimer==null,true);
});

test('shared sessions are limited by remaining task estimate, or five minutes after it is used',()=>{
  const s=setup(8),task=s.shared[0];
  task.spent=3*60;
  beginTogether(s,task.id,25,now);
  assert.equal(s.togetherTimer.remaining,5*minute);
  endTogether(s,now+5*minute);
  assert.equal(task.spent,8*60);
  beginTogether(s,task.id,25,now+10*minute);
  assert.equal(s.togetherTimer.remaining,5*minute);
});

test('the last seconds of a paused shared session can finish without increasing the allocation',()=>{
  const s=setup(),task=s.shared[0];
  beginTogether(s,task.id,5,now);
  pauseTogether(s,now+4*minute+45000);
  assert.equal(s.togetherTimer.remaining,15000);
  assert.deepEqual(resumeTogether(s,now+10*minute),{ok:true});
  assert.equal(s.togetherTimer.remaining,15000);
  endTogether(s,now+11*minute);
  assert.equal(task.spent,300);
});

test('only available open shared tasks can start and future dates are never silently changed',()=>{
  const s=setup(),task=s.shared[0];
  const future=new Date(now);future.setDate(future.getDate()+1);task.notBefore=day(future);
  assert.deepEqual(beginTogether(s,task.id,25,now,true),{ok:false,reason:'future-task'});
  assert.equal(task.notBefore,day(future));
  task.notBefore=day(new Date(now));
  for(const status of ['done','archived']){
    task.status=status;
    assert.deepEqual(beginTogether(s,task.id,25,now),{ok:false,reason:'task-unavailable'});
  }
  task.status='open';task.request={from:0,to:1};
  assert.deepEqual(beginTogether(s,task.id,25,now),{ok:false,reason:'task-unavailable'});
  delete task.request;s.people[0].tasks.push(task);s.shared=[];
  assert.deepEqual(beginTogether(s,task.id,25,now),{ok:false,reason:'task-unavailable'});
});

test('shared focus preserves names, ownership, other tasks, notes and personal histories',()=>{
  const s=setup(),task=s.shared[0];
  const other=parse('Pick a movie',25,new Date(now));
  s.shared.push(other);
  s.people[0].tasks.push(parse('Learn Python',25,new Date(now)));
  s.notes.push({id:'note',text:'Proud of us',from:1,date:new Date(now).toISOString()});
  const names=JSON.stringify(s.names),people=JSON.stringify(s.people),notes=JSON.stringify(s.notes),otherBefore=JSON.stringify(other);
  beginTogether(s,task.id,5,now);endTogether(s,now+minute);
  assert.equal(JSON.stringify(s.names),names);
  assert.equal(JSON.stringify(s.people),people);
  assert.equal(JSON.stringify(s.notes),notes);
  assert.equal(JSON.stringify(other),otherBefore);
  assert.equal(s.shared[0],task);
  assert.equal(task.status,'open');
});

test('an explicitly late shared session splits credit at local midnight exactly once',()=>{
  const s=setup(),task=s.shared[0],late=new Date('2026-10-18T23:58:00').getTime();
  assert.deepEqual(beginTogether(s,task.id,5,late,true),{ok:true});
  assert.equal(endTogether(s,late+10*minute),5*minute);
  assert.equal(s.togetherSessions.length,2);
  assert.deepEqual(s.togetherSessions.map(x=>[x.date,x.seconds]),[['2026-10-18',120],['2026-10-19',180]]);
  assert.equal(s.togetherSessions[0].end,s.togetherSessions[1].start);
  assert.equal(task.spent,300);
  assert.equal(s.people.flatMap(p=>p.sessions).length,0);
});

test('next-day appointments still cap a shared session explicitly started after hours',()=>{
  const s=setup(),task=s.shared[0],late=new Date('2026-10-18T23:58:00').getTime();
  appointment(s,1,'00:01','00:20','2026-10-19');
  assert.deepEqual(beginTogether(s,task.id,10,late,true),{ok:true});
  assert.equal(s.togetherTimer.remaining,3*minute);
});

test('ending with less than one estimated minute left permits a one-minute shared continuation',()=>{
 const s=setup(5),task=s.shared[0];beginTogether(s,task.id,5,now);endTogether(s,now+4.5*minute);
 assert.equal(task.spent,270);assert.deepEqual(beginTogether(s,task.id,5,now+5*minute),{ok:true});
 assert.equal(s.togetherTimer.remaining,minute);endTogether(s,now+6*minute);
 assert.equal(task.status,'open');assert.equal(task.spent,330);
});
