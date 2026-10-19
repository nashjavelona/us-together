import {validCouple} from '../couple.js';
import {ApiError} from './errors.js';
import {addCivilDays,civilDifference,civilWeekday,nextMidnight,zoneDay,zonedAt} from './time.js';

export const LIMITS={bytes:950000,tasks:2000,routines:200,appointments:1000,notes:1000,sessions:12000,devices:10};
export const clone=value=>JSON.parse(JSON.stringify(value));
export function stable(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;}
export const same=(a,b)=>stable(a)===stable(b);
export const allTasks=s=>s.people.flatMap((p,owner)=>p.tasks.map(task=>({task,owner}))).concat(s.shared.map(task=>({task,owner:2})));
export const taskCount=s=>s.people[0].tasks.length+s.people[1].tasks.length+s.shared.length;
export const taskMap=s=>new Map(allTasks(s).map(x=>[x.task.id,x]));
const stateKeys=['version','names','active','people','shared','notes','setup','tagline','initials','sound','checkins','momentIndex','pinnedNote','togetherTimer','togetherSessions'];
const personKeys=['version','settings','tasks','routines','appointments','sessions','plans','timer','setup','restUntil'];
const taskKeys=['id','title','minutes','spent','priority','due','repeat','preferred','notBefore','status','created','steps','routine','occurrenceDate','from','days','generatedDays','paused','assignedBy','help','helper','request','completed','completedDay'];
const timerKeys=['task','remaining','started','running','total'];
const sessionKeys=['id','task','start','end','seconds','date'];
function invalid(message){throw new ApiError(400,'invalid_state',message);}
function keys(value,allowed,label){if(!value||typeof value!=='object'||Array.isArray(value))invalid(`Invalid ${label}.`);for(const key of Object.keys(value))if(!allowed.includes(key))invalid(`Unsupported field in ${label}.`);}
function text(value,min,max,label){if(typeof value!=='string'||value.length<min||value.length>max)invalid(`Invalid ${label}.`);}
function array(value,max,label){if(!Array.isArray(value)||value.length>max)invalid(`Too many or invalid ${label}.`);}
function unique(items,label){if(new Set(items.map(x=>x?.id)).size!==items.length)invalid(`Duplicate ${label} identity.`);}
function taskBounds(t){
  keys(t,taskKeys,'task');text(t.id,1,160,'task ID');text(t.title,1,300,'task title');
  array(t.steps,100,'checklist steps');for(const step of t.steps){keys(step,['id','title','done'],'checklist step');text(step.title,1,300,'checklist step');if(step.id!==undefined)text(step.id,1,160,'step ID');}
  if(t.request){keys(t.request,['from','to','origin','created'],'request');if(t.request.created!==undefined)text(t.request.created,1,40,'request date');}
  if(t.days!==undefined)array(t.days,7,'routine weekdays');if(t.generatedDays!==undefined)array(t.generatedDays,4000,'routine dates');
  if(t.routine!==undefined)text(t.routine,1,160,'routine identity');
  if(t.assignedBy!==undefined&&![0,1].includes(t.assignedBy))invalid('Invalid task author.');
  if(t.helper!==undefined&&![null,0,1].includes(t.helper))invalid('Invalid helper.');
  if(t.help!==undefined&&typeof t.help!=='boolean')invalid('Invalid help request.');
}
function sessionBounds(sessions){array(sessions,LIMITS.sessions,'focus sessions');for(const item of sessions){keys(item,sessionKeys,'focus session');text(item.id,1,160,'session identity');text(item.task,1,160,'session task');}unique(sessions,'session');}
export function normalizeState(value){
  if(!value||typeof value!=='object'||Array.isArray(value))invalid('Choose a valid shared-space state to save or import.');
  const s=clone(value);keys(s,stateKeys,'space');s.active=0;
  array(s.people,2,'people');if(s.people.length!==2)invalid('A shared space needs two sides.');
  for(const p of s.people){
    keys(p,personKeys,'person');p.plans={};
    keys(p.settings,['start','end','focus','break','buffer','theme','sound','one'],'settings');
    array(p.tasks,LIMITS.tasks,'tasks');p.tasks.forEach(taskBounds);
    array(p.routines,LIMITS.routines,'routines');p.routines.forEach(taskBounds);unique(p.routines,'routine');
    array(p.appointments,LIMITS.appointments,'appointments');unique(p.appointments,'appointment');
    for(const a of p.appointments){keys(a,['id','title','date','start','end'],'appointment');text(a.id,1,160,'appointment identity');text(a.title,1,150,'appointment title');}
    sessionBounds(p.sessions);if(p.timer)keys(p.timer,timerKeys,'timer');
  }
  array(s.shared,LIMITS.tasks,'shared tasks');s.shared.forEach(taskBounds);
  if(taskCount(s)>LIMITS.tasks)invalid(`This space supports up to ${LIMITS.tasks} task records. Export a backup and remove old records before importing more.`);
  const routines=s.people.flatMap(p=>p.routines);unique(routines,'routine');
  array(s.notes,LIMITS.notes,'notes');unique(s.notes,'note');for(const n of s.notes){keys(n,['id','from','text','date'],'note');text(n.id,1,160,'note identity');text(n.text,1,500,'note');}
  if(s.togetherTimer)keys(s.togetherTimer,timerKeys,'shared timer');if(s.togetherSessions!==undefined)sessionBounds(s.togetherSessions);
  if(s.tagline!==undefined)text(s.tagline,0,140,'tagline');if(s.pinnedNote!==undefined&&s.pinnedNote!==null)text(s.pinnedNote,1,160,'pinned note identity');
  if(s.checkins)keys(s.checkins,['date','moods'],'check-in');
  if(!validCouple(s))invalid('The space contains an invalid task, date, timer, or setting.');
  if(new TextEncoder().encode(JSON.stringify(s)).byteLength>LIMITS.bytes)invalid('This space is too large for a single saved version. Export and remove old records first.');
  return s;
}
export function wireState(s){const result=clone(s);result.active=0;result.people.forEach(p=>p.plans={});return result;}
export function timerFor(s,owner){return owner===2?s.togetherTimer:s.people[owner].timer;}
export function setTimer(s,owner,timer){if(owner===2)s.togetherTimer=timer;else s.people[owner].timer=timer;}
export function settleTimer(s,owner,now,zone){
  const timer=timerFor(s,owner);if(!timer)return 0;
  const elapsed=timer.running?Math.max(0,Math.min(timer.remaining,now-timer.started)):0;
  if(elapsed>0){
    const sessions=owner===2?(s.togetherSessions??=[]):s.people[owner].sessions;
    let from=timer.started;const until=from+elapsed;
    while(from<until){const midnight=nextMidnight(from,zone),to=Math.min(until,midnight>from?midnight:until);sessions.push({id:crypto.randomUUID(),task:timer.task,start:from,end:to,seconds:(to-from)/1000,date:zoneDay(from,zone)});from=to;}
    const found=taskMap(s).get(timer.task);if(found)found.task.spent+=elapsed/1000;
  }
  timer.remaining=Math.max(0,timer.remaining-elapsed);timer.started=now;timer.running=false;return elapsed;
}
export function setBreak(s,owner,from){for(const i of owner===2?[0,1]:[owner])s.people[i].restUntil=from+s.people[i].settings.break*60000;}
export function expireTimers(s,now,zone){
  let changed=false;
  for(const owner of [0,1,2]){const timer=timerFor(s,owner);if(timer?.running&&timer.started+timer.remaining<=now){const ended=timer.started+timer.remaining;settleTimer(s,owner,ended,zone);setTimer(s,owner,null);setBreak(s,owner,ended);changed=true;}else if(timer&&!timer.running&&timer.remaining<=0){setTimer(s,owner,null);changed=true;}}
  for(const p of s.people)if(p.restUntil&&p.restUntil<=now){p.restUntil=null;changed=true;}
  return changed;
}
export function pausedCopy(s,now,zone){const result=clone(s);for(const owner of [0,1,2]){settleTimer(result,owner,now,zone);if(timerFor(result,owner)?.remaining===0)setTimer(result,owner,null);}return wireState(result);}
export function generateRoutines(s,now,zone){
  const date=zoneDay(now,zone),weekday=civilWeekday(date);let changed=false;const existing=taskMap(s);
  for(const p of s.people)for(const r of p.routines){
    if(r.paused||r.from>date||(r.repeat!=='daily'&&!r.days.includes(weekday))||(r.generatedDays||[]).includes(date))continue;
    if(taskCount(s)>=LIMITS.tasks)continue;
    r.generatedDays??=[];r.generatedDays.push(date);changed=true;
    const id=`${r.id}:${date}`;if(existing.has(id))continue;
    const due=r.due?addCivilDays(date,Math.max(0,civilDifference(r.due,r.from))):'';
    const task={...clone(r),id,routine:r.id,occurrenceDate:date,repeat:'',due,notBefore:date,spent:0,status:'open',created:new Date(now).toISOString(),steps:r.steps.map(x=>({...x,done:false}))};
    delete task.completed;delete task.completedDay;delete task.request;task.help=false;task.helper=null;
    p.tasks.push(task);existing.set(id,{task,owner:s.people.indexOf(p)});
  }
  return changed;
}
export function calendarWindow(s,owners,now,zone,allowOutsideHours=false){
  const date=zoneDay(now,zone);let until=Infinity;
  for(const owner of owners){
    const p=s.people[owner];if(p.restUntil>now)throw new ApiError(422,'break','A break is still running. Skip the break when you are ready.');
    for(const a of p.appointments){const start=zonedAt(a.date,a.start,zone),end=zonedAt(a.date,a.end,zone);if(start<=now&&end>now)throw new ApiError(422,'appointment','This time is protected by an appointment.');if(start>now)until=Math.min(until,start);}
    if(!allowOutsideHours){const start=zonedAt(date,p.settings.start,zone),end=zonedAt(date,p.settings.end,zone);if(now<start||now>=end)throw new ApiError(422,'outside-hours','This is outside the planned day. Choose explicitly whether to use extra time.');until=Math.min(until,end);}
  }
  return until-now;
}
