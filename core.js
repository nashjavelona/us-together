import {calendarDay,calendarAt,isCalendarDate,addCalendarDays,calendarWeekday,calendarDayDifference,nextCalendarMidnight} from './calendar.js';
export {setCalendarZone,getCalendarZone,addCalendarDays,calendarWeekday,nextCalendarMidnight} from './calendar.js';
export const day=calendarDay;
export const uid=()=>globalThis.crypto.randomUUID();
export const at=calendarAt;
export const defaults=()=>({version:1,settings:{start:'08:00',end:'21:00',focus:25,break:5,buffer:3,theme:'light',sound:false,one:true},tasks:[],routines:[],appointments:[],sessions:[],plans:{},timer:null,setup:false});
export function parse(text,focus=25,now=new Date()) {
 let title=text,minutes=focus,due='',repeat='',preferred='',notBefore=day(now);
 const m=text.match(/\b(?:for\s+)?(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?)\b/i);
 if(m){minutes=Math.max(1,Math.min(1440,Number(m[1])*(/^h/i.test(m[2])?60:1)));title=title.replace(m[0],'');}
 if(/every (day|morning)|daily/i.test(text)){repeat='daily';title=title.replace(/every (day|morning)|daily/ig,'');if(/morning/i.test(text))preferred='09:00';}
 const date=text.match(/\b\d{4}-\d{2}-\d{2}\b/),relative=text.match(/\b(?:(by|before|on)\s+)?(tomorrow|today)\b/i);
 if(date&&validDate(date[0])){
  const modifier=text.slice(0,date.index).match(/\b(by|before|on)\s*$/i)?.[1]?.toLowerCase();
  due=date[0];if(modifier==='on')notBefore=due;
  title=title.replace(new RegExp('\\b(?:(?:by|before|on)\\s+)?'+date[0]+'\\b','i'),'');
 }else if(relative){
  due=addCalendarDays(day(now),relative[2].toLowerCase()==='tomorrow'?1:0);if(!relative[1]||relative[1].toLowerCase()==='on')notBefore=due;
  title=title.replace(relative[0],'');
 }else{
  const w=text.match(/\b(before|by|on)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  if(w){
   const date=day(now),n=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].indexOf(w[2].toLowerCase());
   due=addCalendarDays(date,(n-calendarWeekday(date)+7)%7);if(w[1].toLowerCase()==='on')notBefore=due;
   title=title.replace(w[0],'');
  }
 }
 return {id:uid(),title:title.trim()||text,minutes,spent:0,priority:'Medium',due,repeat,preferred,notBefore,status:'open',created:now.toISOString(),steps:[]};
}
export function generate(s,date=day()){
 for(const r of s.routines){
  if(r.from>date||r.paused)continue;
  const w=calendarWeekday(date);
  if(r.repeat!=='daily'&&!r.days.includes(w))continue;
  const id=`${r.id}:${date}`;
  r.generatedDays??=[];
  if(r.generatedDays.includes(date))continue;
  r.generatedDays.push(date);
  if(s.tasks.some(t=>t.id===id))continue;
  let due='';if(r.due){const offset=Math.max(0,calendarDayDifference(r.from,r.due));due=addCalendarDays(date,offset);}
  s.tasks.push({...r,id,routine:r.id,occurrenceDate:date,repeat:'',due,notBefore:date,spent:0,status:'open',created:new Date().toISOString(),steps:(r.steps||[]).map(x=>({...x,done:false}))});
 }
}
export function plan(s,now=Date.now(),externalBusy=[],generateRoutines=true){
 const date=day(new Date(now)),cfg=s.settings;if(generateRoutines)generate(s,date);
 const start=Math.max(at(date,cfg.start),Math.ceil(now/60000)*60000),end=at(date,cfg.end),blocks=[],overflow=[];
 const dayStart=at(date,'00:00'),dayEnd=nextCalendarMidnight(now);
 const reservations=(Array.isArray(externalBusy)?externalBusy:[]).filter(b=>b&&b.type==='together'&&typeof b.title==='string'&&Number.isFinite(b.start)&&Number.isFinite(b.end)&&b.end>b.start&&b.end>dayStart&&b.start<dayEnd).map(b=>({type:'together',title:b.title,start:Math.max(dayStart,b.start),end:Math.min(dayEnd,b.end)}));
 const busy=s.appointments.filter(a=>a.date===date).map(a=>({start:at(date,a.start),end:at(date,a.end),title:a.title,type:'appointment'})).concat(reservations);
 let activeMinutes=0;
 const reserveBreak=(from,until,title)=>{
  let pos=from;
  for(const b of [...busy].sort((a,b)=>a.start-b.start)){
   if(b.end<=pos)continue;if(b.start>=until)break;
   if(b.start>pos)busy.push({start:pos,end:b.start,type:'break',title});
   pos=Math.max(pos,b.end);
  }
  if(pos<until)busy.push({start:pos,end:until,type:'break',title});
 };
 if(s.timer?.running&&remaining(s.timer,now)>0){
  const next=busy.filter(b=>b.start>now).sort((a,b)=>a.start-b.start)[0],activeEnd=Math.min(now+remaining(s.timer,now),next?.start||Infinity);
  if(!busy.some(b=>b.start<=now&&b.end>now)){
   activeMinutes=(activeEnd-now)/60000;
   busy.push({start:now,end:activeEnd,type:'active',task:s.timer.task,title:s.tasks.find(x=>x.id===s.timer.task)?.title||'Focus'});
   reserveBreak(activeEnd,Math.min(end,activeEnd+(cfg.break+cfg.buffer)*60000),`Reset · ${cfg.break}m break + ${cfg.buffer}m buffer`);
  }
 }
 if(s.restUntil>now)reserveBreak(now,s.restUntil,'A little break · breathe and reset');
 busy.sort((a,b)=>a.start-b.start);
 const tasks=s.tasks.filter(t=>t.status==='open'&&!t.request&&t.notBefore<=date).sort((a,b)=>{const urgent=t=>t.due&&t.due<=date?0:1;return urgent(a)-urgent(b)||({High:0,Medium:1,Low:2}[a.priority]-{High:0,Medium:1,Low:2}[b.priority])||(a.due||'9999').localeCompare(b.due||'9999')||a.created.localeCompare(b.created);});
 for(const t of tasks){
  let left=t.minutes-t.spent/60;
  if(t.id===s.timer?.task){
   const elapsed=s.timer.running?Math.max(0,Math.min(s.timer.remaining,now-s.timer.started))/60000:0;
   left=Math.max(0,left-elapsed,remaining(s.timer,now)/60000)-activeMinutes;
  }else if(left<=0)left=5;
  let pos=Math.max(start,t.preferred?at(date,t.preferred):start);
  while(left>0.01&&pos<end){
   const occupied=[...busy,...blocks].sort((a,b)=>a.start-b.start);const conflict=occupied.find(b=>b.start<=pos&&b.end>pos);if(conflict){pos=conflict.end;continue;}
   const next=occupied.find(b=>b.start>pos),limit=Math.min(end,next?.start||end),available=(limit-pos)/60000;
   if(available<1){if(next){pos=next.end;continue;}break;}
   const size=Math.min(left,cfg.focus,available),stop=pos+size*60000;
   blocks.push({task:t.id,title:t.title,start:pos,end:stop,type:'focus'});left-=size;pos=stop;
   const gap=(Number(cfg.break)+Number(cfg.buffer))*60000,gapEnd=Math.min(pos+gap,limit);
   if(gapEnd>pos)blocks.push({type:'break',title:`Reset · ${cfg.break}m break + ${cfg.buffer}m buffer`,start:pos,end:gapEnd});pos=gapEnd;
  }
  if(left>0.01)overflow.push({task:t.id,minutes:Math.ceil(left)});
 }
 const previous=s.plans[date]||{planned:[]};const planned=[...new Set([...previous.planned,...blocks.concat(busy).filter(b=>b.task).map(b=>b.task)])];
 s.plans[date]={blocks:[...blocks,...busy].sort((a,b)=>a.start-b.start),overflow,planned};return s.plans[date];
}
export const remaining=(t,now=Date.now())=>Math.max(0,t.remaining-(t.running?Math.max(0,now-t.started):0));
export function settle(s,now=Date.now()){const t=s.timer;if(!t)return 0;const elapsed=t.running?Math.max(0,Math.min(t.remaining,now-t.started)):0;if(elapsed>0){let from=t.started;const until=t.started+elapsed;while(from<until){const to=Math.min(until,nextCalendarMidnight(from));s.sessions.push({id:uid(),task:t.task,start:from,end:to,seconds:(to-from)/1000,date:day(new Date(from))});from=to;}const task=s.tasks.find(x=>x.id===t.task);if(task)task.spent+=elapsed/1000;}t.remaining-=elapsed;t.started=now;t.running=false;return elapsed;}
export const validDate=isCalendarDate;
export const validTime=t=>typeof t==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const stamp=t=>typeof t==='string'&&Number.isFinite(Date.parse(t));
export function validTask(t){return !!t&&typeof t.id==='string'&&t.id.length>0&&typeof t.title==='string'&&t.title.trim().length>0&&Number.isFinite(t.minutes)&&t.minutes>0&&t.minutes<=1440&&Number.isFinite(t.spent)&&t.spent>=0&&['High','Medium','Low'].includes(t.priority)&&validDate(t.notBefore)&&(!t.due||validDate(t.due))&&(!t.preferred||validTime(t.preferred))&&stamp(t.created)&&['open','done','archived'].includes(t.status)&&Array.isArray(t.steps)&&t.steps.every(x=>x&&typeof x.title==='string'&&typeof x.done==='boolean')&&(t.status!=='done'||(stamp(t.completed)&&validDate(t.completedDay)))&&((t.completed===undefined&&t.completedDay===undefined)||(stamp(t.completed)&&validDate(t.completedDay)));}
export function valid(s){try{return s?.version===1&&s.settings&&validTime(s.settings.start)&&validTime(s.settings.end)&&s.settings.end>s.settings.start&&['focus','break','buffer'].every(k=>Number.isFinite(s.settings[k])&&s.settings[k]>=0&&s.settings[k]<=240)&&s.settings.focus>=1&&['tasks','routines','appointments','sessions'].every(k=>Array.isArray(s[k]))&&s.tasks.every(validTask)&&new Set(s.tasks.map(t=>t.id)).size===s.tasks.length&&s.routines.every(r=>validTask(r)&&validDate(r.from)&&['daily','weekly'].includes(r.repeat)&&Array.isArray(r.days)&&r.days.every(d=>Number.isInteger(d)&&d>=0&&d<=6)&&(!r.generatedDays||Array.isArray(r.generatedDays)&&r.generatedDays.every(validDate)))&&s.appointments.every(a=>a&&typeof a.id==='string'&&typeof a.title==='string'&&validDate(a.date)&&validTime(a.start)&&validTime(a.end)&&a.end>a.start)&&s.sessions.every(x=>x&&validDate(x.date)&&Number.isFinite(x.seconds)&&x.seconds>=0&&Number.isFinite(x.start)&&Number.isFinite(x.end)&&x.end>=x.start)&&(!s.timer||(s.tasks.some(t=>t.id===s.timer.task&&t.status==='open'&&!t.request)&&Number.isFinite(s.timer.remaining)&&s.timer.remaining>=0&&s.timer.remaining<=1440*60000&&Number.isFinite(s.timer.started)&&typeof s.timer.running==='boolean'))&&(s.restUntil===undefined||s.restUntil===null||Number.isFinite(s.restUntil))&&s.plans&&typeof s.plans==='object'&&Object.values(s.plans).every(p=>p&&Array.isArray(p.planned)&&Array.isArray(p.blocks)&&Array.isArray(p.overflow));}catch{return false;}}
