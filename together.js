import {at,day,uid,nextCalendarMidnight} from './core.js';

const minute=60000;
const failed=reason=>({ok:false,reason});

// Every shared session needs both people to be free. An explicit hours
// override never bypasses an appointment, another timer, or a current break.
function availableWindow(s,now,allowOutsideHours){
  if(s.people.some(p=>p.timer))return failed('personal-active');
  if(s.people.some(p=>p.restUntil>now))return failed('break');
  const appointments=s.people.flatMap(p=>p.appointments.map(a=>({
    start:at(a.date,a.start),end:at(a.date,a.end)
  })));
  if(appointments.some(a=>a.start<=now&&a.end>now))return failed('appointment');
  let until=Math.min(Infinity,...appointments.filter(a=>a.start>now).map(a=>a.start));
  if(!allowOutsideHours){
    const date=day(new Date(now));
    for(const p of s.people){
      const start=at(date,p.settings.start),end=at(date,p.settings.end);
      if(now<start||now>=end)return failed('outside-hours');
      until=Math.min(until,end);
    }
  }
  return {ok:true,remaining:until-now};
}

function availableTask(s,id,now){
  const task=s.shared.find(t=>t.id===id&&t.status==='open'&&!t.request);
  if(!task)return failed('task-unavailable');
  if(task.notBefore>day(new Date(now)))return failed('future-task');
  return {ok:true,task};
}

/** Start one shared timer; no personal work or task ownership is changed. */
export function beginTogether(s,id,minutes,now=Date.now(),allowOutsideHours=false){
  if(!Number.isFinite(now))return failed('invalid-time');
  if(!Number.isInteger(minutes)||minutes<1||minutes>120)return failed('invalid-duration');
  if(s.togetherTimer)return failed('together-active');
  const found=availableTask(s,id,now);
  if(!found.ok)return found;
  const window=availableWindow(s,now,allowOutsideHours);
  if(!window.ok)return window;
  const estimate=found.task.minutes-found.task.spent/60;
  const duration=Math.min(minutes*minute,(estimate>0?Math.max(1,estimate):5)*minute,window.remaining);
  if(duration<minute)return failed('short-window');
  s.togetherTimer={task:id,remaining:duration,started:now,running:true};
  return {ok:true};
}

/** Record earned time once and pause. Return elapsed milliseconds. */
export function settleTogether(s,now=Date.now()){
  const timer=s.togetherTimer;
  if(!timer||!Number.isFinite(now))return 0;
  const elapsed=timer.running?Math.max(0,Math.min(timer.remaining,now-timer.started)):0;
  if(elapsed>0){
    s.togetherSessions??=[];
    let from=timer.started;
    const until=from+elapsed;
    while(from<until){
      const to=Math.min(until,nextCalendarMidnight(from));
      s.togetherSessions.push({id:uid(),task:timer.task,start:from,end:to,seconds:(to-from)/1000,date:day(new Date(from))});
      from=to;
    }
    const task=s.shared.find(t=>t.id===timer.task);
    if(task)task.spent+=elapsed/1000;
  }
  timer.remaining=Math.max(0,timer.remaining-elapsed);
  timer.started=now;
  timer.running=false;
  return elapsed;
}

export function pauseTogether(s,now=Date.now()){
  return settleTogether(s,now);
}

/** Resume the unspent allocation, shortened only by a real time boundary. */
export function resumeTogether(s,now=Date.now(),allowOutsideHours=false){
  if(!Number.isFinite(now))return failed('invalid-time');
  const timer=s.togetherTimer;
  if(!timer)return failed('no-session');
  if(timer.running)return failed('already-running');
  if(timer.remaining<=0)return failed('finished');
  const found=availableTask(s,timer.task,now);
  if(!found.ok)return found;
  const window=availableWindow(s,now,allowOutsideHours);
  if(!window.ok)return window;
  const duration=Math.min(timer.remaining,window.remaining);
  // A paused session may finish its final seconds. Do not create a new,
  // truncated sub-minute session immediately before a protected boundary.
  if(duration<=0||(duration<minute&&duration<timer.remaining))return failed('short-window');
  timer.remaining=duration;
  timer.started=now;
  timer.running=true;
  return {ok:true};
}

/** Ending a session keeps the shared task unfinished for a later decision. */
export function endTogether(s,now=Date.now()){
  const elapsed=settleTogether(s,now);
  s.togetherTimer=null;
  return elapsed;
}
