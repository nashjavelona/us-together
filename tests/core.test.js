import {test} from 'node:test';import assert from 'node:assert/strict';import {defaults,parse,plan,generate,remaining,settle,day,valid} from '../core.js';
const now=new Date('2026-10-18T08:00:00').getTime();const make=(text)=>parse(text,25,new Date(now));
test('capture extracts duration, deadline and recurring morning',()=>{assert.equal(make('Study Python for 45 minutes').minutes,45);assert.equal(make('Finish portfolio before Friday').due,'2026-10-23');assert.equal(make('Review trading plan every morning').repeat,'daily');assert.equal(make('Review trading plan every morning').preferred,'09:00');});
test('planner avoids fixed appointments, includes gaps, splits tasks',()=>{const s=defaults();s.settings.end='12:00';s.tasks=[make('Study for 90 minutes')];s.appointments=[{date:'2026-10-18',start:'08:30',end:'09:00',title:'Meeting'}];const p=plan(s,now);const blocks=p.blocks.filter(b=>b.type==='focus');assert.ok(blocks.length>=4);assert.equal(blocks.reduce((n,b)=>n+(b.end-b.start)/60000,0),90);for(let i=1;i<p.blocks.length;i++)assert.ok(p.blocks[i].start>=p.blocks[i-1].end);assert.ok(blocks.every(b=>b.end<=new Date('2026-10-18T12:00').getTime()));});
test('urgent work outranks other priority and capacity keeps work visible',()=>{const s=defaults();s.settings.end='09:00';const a=make('Low for 100 minutes'),b=make('Urgent for 20 minutes');a.priority='High';b.priority='Low';b.due='2026-10-18';s.tasks=[a,b];const p=plan(s,now);assert.equal(p.blocks.find(x=>x.type==='focus').task,b.id);assert.ok(p.overflow.length);assert.equal(s.tasks.length,2);});
test('recurrences are idempotent and weekday-specific',()=>{const s=defaults();s.routines=[{...make('Routine'),repeat:'weekly',days:[0],from:'2026-10-18'}];generate(s,'2026-10-18');generate(s,'2026-10-18');assert.equal(s.tasks.length,1);generate(s,'2026-10-19');assert.equal(s.tasks.length,1);generate(s,'2026-10-25');assert.equal(s.tasks.length,2);});
test('timestamp timer survives serialization and pause never double counts',()=>{const s=defaults(),t=make('Task');s.tasks=[t];s.timer={task:t.id,remaining:1500000,started:now,running:true};const clone=JSON.parse(JSON.stringify(s));assert.equal(remaining(clone.timer,now+60000),1440000);settle(clone,now+60000);settle(clone,now+120000);assert.equal(clone.tasks[0].spent,60);assert.equal(clone.sessions.length,1);assert.equal(remaining(clone.timer,now+360000),1440000);});
test('late timer stops accounting at intended duration',()=>{const s=defaults(),t=make('Task');s.tasks=[t];s.timer={task:t.id,remaining:120000,started:now,running:true};settle(s,now+3600000);assert.equal(s.tasks[0].spent,120);});
test('completed tasks and historical planned IDs survive replanning',()=>{const s=defaults(),t=make('Task');s.tasks=[t];plan(s,now);t.status='done';const p=plan(s,now+60000);assert.ok(p.planned.includes(t.id));assert.equal(p.blocks.filter(b=>b.task===t.id).length,0);});
test('no time remaining means explicit overflow, no disappearance',()=>{const s=defaults();s.tasks=[make('Task')];const p=plan(s,new Date('2026-10-18T23:00').getTime());assert.equal(p.overflow.length,1);assert.equal(p.blocks.length,0);assert.equal(s.tasks.length,1);});
test('backup validates and retains full data',()=>{const s=defaults();s.tasks.push(make('Task'));assert.ok(valid(JSON.parse(JSON.stringify(s))));assert.ok(!valid({version:1}));});
test('sessions crossing midnight attribute time to each local day',()=>{const s=defaults(),t=make('Task');s.tasks=[t];const start=new Date('2026-10-18T23:59:00').getTime();s.timer={task:t.id,remaining:120000,started:start,running:true};settle(s,start+120000);assert.deepEqual(s.sessions.map(x=>[x.date,x.seconds]),[['2026-10-18',60],['2026-10-19',60]]);});
test('rejects corrupt timer backup',()=>{const s=defaults();s.timer={task:'missing',remaining:'bad'};assert.equal(valid(s),false);});
test('on a date schedules work for that day while by and before remain deadlines',()=>{
 for(const [text,scheduled,due] of [
  ['Workout on Friday','2026-10-23','2026-10-23'],
  ['Finish portfolio by Friday','2026-10-18','2026-10-23'],
  ['Finish portfolio before Friday','2026-10-18','2026-10-23'],
  ['Date night on 2026-10-24 for 90 minutes','2026-10-24','2026-10-24'],
  ['Book dinner by 2026-10-24','2026-10-18','2026-10-24'],
  ['Take a walk on tomorrow','2026-10-19','2026-10-19'],
  ['Buy groceries by tomorrow','2026-10-18','2026-10-19']
 ]){
  const t=make(text);assert.equal(t.notBefore,scheduled,text);assert.equal(t.due,due,text);
  const s=defaults();s.tasks.push(t);assert.ok(valid(s));
  if(scheduled>'2026-10-18')assert.ok(!plan(s,now).blocks.some(b=>b.task===t.id));
 }
 assert.equal(make('Date night on 2026-10-24 for 90 minutes').title,'Date night');
});
test('a named weekday deadline today is not silently moved a week away',()=>{
 assert.equal(make('Submit report by Sunday').due,'2026-10-18');
 assert.equal(make('Take a walk on Sunday').notBefore,'2026-10-18');
});
test('running focus retains unfinished workload and overflow without double-counting elapsed time',()=>{
 const s=defaults(),t=make('Study for 90 minutes');s.tasks=[t];s.settings.end='08:45';
 s.timer={task:t.id,remaining:25*60000,started:now,running:true};
 const p=plan(s,now+10*60000),minutes=type=>p.blocks.filter(b=>b.task===t.id&&b.type===type).reduce((n,b)=>n+(b.end-b.start)/60000,0);
 assert.equal(minutes('active'),15);assert.equal(minutes('focus'),12);
 assert.equal(p.overflow.find(b=>b.task===t.id).minutes,53);
 assert.equal(minutes('active')+minutes('focus')+p.overflow[0].minutes,80);
 assert.equal(t.spent,0);assert.equal(s.sessions.length,0);assert.equal(s.timer.running,true);
 for(let i=1;i<p.blocks.length;i++)assert.ok(p.blocks[i].start>=p.blocks[i-1].end);
 const firstFuture=p.blocks.find(b=>b.task===t.id&&b.type==='focus');assert.equal(firstFuture.start,now+33*60000);
});
test('paused focus keeps its remaining workload in the plan without reserving a running session',()=>{
 const s=defaults(),t=make('Study for 90 minutes');s.tasks=[t];s.settings.end='12:00';
 s.timer={task:t.id,remaining:25*60000,started:now,running:true};settle(s,now+10*60000);
 s.appointments=[{id:'meeting',date:'2026-10-18',start:'08:15',end:'09:00',title:'Meeting'}];
 const p=plan(s,now+10*60000);
 assert.ok(!p.blocks.some(b=>b.type==='active'));
 assert.equal(p.blocks.filter(b=>b.task===t.id).reduce((n,b)=>n+(b.end-b.start)/60000,0),80);
 assert.equal(t.spent,600);assert.equal(s.timer.remaining,15*60000);assert.equal(s.timer.running,false);assert.equal(s.sessions.length,1);
 for(let i=1;i<p.blocks.length;i++)assert.ok(p.blocks[i].start>=p.blocks[i-1].end);
});
test('an active five-minute continuation is not duplicated in future planning',()=>{
 const s=defaults(),t=make('One more step for 5 minutes');s.tasks=[t];t.spent=300;
 s.timer={task:t.id,remaining:5*60000,started:now,running:true};const p=plan(s,now);
 assert.equal(p.blocks.filter(b=>b.type==='active').length,1);
 assert.equal(p.blocks.filter(b=>b.task===t.id&&b.type==='focus').length,0);
 assert.equal(p.overflow.length,0);
});
test('shared focus reserves time in each personal plan without consuming personal task estimates',()=>{
 const reservation={type:'together',title:'Plan dinner together',start:now,end:now+25*60000};
 for(const duration of [45,60]){
  const s=defaults(),t=make(`Own task for ${duration} minutes`);s.tasks.push(t);const p=plan(s,now,[reservation]);
  assert.equal(p.blocks.filter(b=>b.type==='together').length,1);
  assert.ok(p.blocks.filter(b=>b.type==='focus').every(b=>b.start>=reservation.end));
  assert.equal(p.blocks.filter(b=>b.task===t.id).reduce((n,b)=>n+(b.end-b.start)/60000,0),duration);
 }
});
test('invalid or unrelated-day shared reservations cannot corrupt a personal plan',()=>{
 const s=defaults(),t=make('Own task');s.tasks.push(t);
 const p=plan(s,now,[{type:'together',title:'Bad time',start:NaN,end:now+60000},{type:'together',title:'Negative span',start:now,end:now-60000},{type:'together',title:'Another day',start:now+86400000,end:now+86500000}]);
 assert.equal(p.blocks.filter(b=>b.type==='together').length,0);assert.equal(p.blocks.find(b=>b.task===t.id).start,now);
});
