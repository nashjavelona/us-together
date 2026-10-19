import {at,day,remaining,settle,validDate,validTime} from './core.js';
import {locate} from './couple.js';
import {settleTogether} from './together.js';

export function focusWindow(person,task,minutes=null,now=Date.now(),outsideHours=false,allowFinalSeconds=false){
  if(!task||task.status!=='open'||task.request)return {ok:false,reason:'task'};
  const date=day(new Date(now));
  if(task.notBefore>date)return {ok:false,reason:'future'};
  if(person.restUntil>now)return {ok:false,reason:'break'};
  const appointments=person.appointments.map(a=>({...a,startMs:at(a.date,a.start),endMs:at(a.date,a.end)}));
  const current=appointments.find(a=>a.startMs<=now&&a.endMs>now);
  if(current)return {ok:false,reason:'appointment',appointment:current};
  if(!outsideHours&&(now<at(date,person.settings.start)||now>=at(date,person.settings.end)))return {ok:false,reason:'hours'};
  const estimate=task.minutes-task.spent/60;
  const requested=minutes??Math.min(person.settings.focus,estimate>0?Math.max(1,estimate):5);
  if(!Number.isFinite(requested)||requested<=0||requested>120)return {ok:false,reason:'duration'};
  const next=appointments.filter(a=>a.startMs>now).sort((a,b)=>a.startMs-b.startMs)[0];
  const duration=Math.min(requested*60000,next?next.startMs-now:Infinity,outsideHours?Infinity:at(date,person.settings.end)-now);
  const finalSeconds=allowFinalSeconds&&duration>0&&Math.abs(duration-requested*60000)<1;
  return duration>=60000||finalSeconds?{ok:true,duration}:{ok:false,reason:'short'};
}

export function nextAction(person,now=Date.now()){
  const date=day(new Date(now));
  const taskFor=id=>person.tasks.find(t=>t.id===id&&t.status==='open'&&!t.request);
  const appointment=person.appointments.find(a=>a.date===date&&at(date,a.start)<=now&&at(date,a.end)>now);
  if(appointment)return {kind:'appointment',appointment};
  if(person.timer){const task=taskFor(person.timer.task);if(task)return {kind:'timer',task,timer:person.timer,duration:remaining(person.timer,now)};}
  if(person.restUntil>now)return {kind:'rest',duration:person.restUntil-now};
  const available=person.tasks.filter(t=>t.status==='open'&&!t.request&&t.notBefore<=date);
  if(!available.length)return {kind:'empty',upcoming:person.tasks.filter(t=>t.status==='open'&&!t.request&&t.notBefore>date).length};
  if(now<at(date,person.settings.start)||now>=at(date,person.settings.end))return {kind:'hours',before:now<at(date,person.settings.start),task:available[0]};
  const block=person.plans[date]?.blocks.find(b=>b.type==='focus'&&b.end>now&&taskFor(b.task));
  if(!block)return {kind:'full',task:available[0]};
  const task=taskFor(block.task);
  if(block.start>now+60000)return {kind:'waiting',task,starts:block.start};
  const window=focusWindow(person,task,null,now);
  return window.ok?{kind:'ready',task,duration:window.duration,block}:{kind:'full',task};
}

export function validateTaskDraft(values){
  if(!values.title?.trim()||values.title.trim().length>300)return 'Give the task a name of 1–300 characters.';
  if(!Number.isFinite(values.minutes)||values.minutes<1||values.minutes>1440)return 'Choose a duration between 1 and 1,440 minutes.';
  if(!['Low','Medium','High'].includes(values.priority))return 'Choose a valid priority.';
  if(!validDate(values.notBefore))return 'Choose a real start date.';
  if(values.due&&!validDate(values.due))return 'Choose a real deadline or leave it blank.';
  if(values.due&&values.due<values.notBefore&&!values.allowLate)return 'This starts after its deadline. Change a date or allow an overdue start below.';
  if(values.preferred&&!validTime(values.preferred))return 'Choose a valid preferred time.';
  return '';
}

// Match unchanged checklist labels in occurrence order, so moving a step does
// not erase its checkmark. A renamed or genuinely new step starts unchecked.
export function reconcileSteps(text,previous=[]){
  const matches=new Map();
  previous.forEach(step=>{const list=matches.get(step.title)||[];list.push(!!step.done);matches.set(step.title,list);});
  return String(text||'').split('\n').map(title=>title.trim()).filter(Boolean).map(title=>({title,done:matches.get(title)?.shift()??false}));
}

// Text, priority and checklist edits do not interrupt an allocated focus session.
// Moving the task to a future day does stop its timer, with earned time preserved.
export function applyTaskDraft(s,id,values,now=Date.now()){
  const error=validateTaskDraft(values);if(error)return {ok:false,error};
  const found=locate(s,id);if(!found)return {ok:false,error:'That task is no longer available.'};
  let stopped=false;
  if(values.notBefore>day(new Date(now))){
    if(found.owner<2&&s.people[found.owner].timer?.task===id){settle(s.people[found.owner],now);s.people[found.owner].timer=null;stopped=true;}
    if(s.togetherTimer?.task===id){settleTogether(s,now);s.togetherTimer=null;stopped=true;}
  }
  const {allowLate,...fields}=values;
  Object.assign(found.t,fields,{title:values.title.trim()});
  return {ok:true,stopped};
}

// The backup's timers are paused at export time. The actual running app is untouched.
export function backupSnapshot(s,now=Date.now()){
  const copy=JSON.parse(JSON.stringify(s));
  copy.people.forEach(p=>{if(p.timer)settle(p,now);});
  if(copy.togetherTimer)settleTogether(copy,now);
  return copy;
}
