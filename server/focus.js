import {ApiError,requireThat} from './errors.js';
import {calendarWindow,clone,expireTimers,normalizeState,setTimer,settleTimer,taskMap,timerFor} from './state.js';
import {zoneDay} from './time.js';

export function focusCommand(current,actor,command,now,zone){
  const s=clone(current),owner=command.owner,action=command.action;
  requireThat([0,1,2].includes(owner),400,'invalid_request','Choose a valid focus owner.');
  requireThat(owner===actor||owner===2,403,'forbidden','You can control only your own timer or the shared timer.');
  requireThat(['start','pause','resume','end','skip-break'].includes(action),400,'invalid_request','Choose a supported focus action.');
  expireTimers(s,now,zone);
  if(action==='skip-break'){for(const i of owner===2?[0,1]:[owner])s.people[i].restUntil=null;return normalizeState(s);}
  const timer=timerFor(s,owner);
  if(action==='pause'||action==='end'){
    requireThat(timer,422,'no-session','There is no active session on this side.');settleTimer(s,owner,now,zone);if(action==='end')setTimer(s,owner,null);return normalizeState(s);
  }
  if(owner===2)requireThat(!s.people.some(p=>p.timer),422,'personal-active','End both individual sessions, including paused sessions, before focusing together.');
  else requireThat(!s.togetherTimer,422,'together-active','End the shared session before starting an individual one.');
  if(action==='start')requireThat(!timer,422,'session-active','Resume or end the existing session before starting another.');
  else{requireThat(timer,422,'no-session','There is no saved session to resume.');requireThat(!timer.running,422,'already-running','The session is already running.');}
  const found=taskMap(s).get(action==='start'?command.taskId:timer.task);
  requireThat(found&&found.owner===owner&&found.task.status==='open'&&!found.task.request,422,'task-unavailable','That task is not available for this timer.');
  const task=found.task,today=zoneDay(now,zone);
  if(task.notBefore>today){requireThat(command.allowEarly===true,422,'future-task','Move this task to today explicitly before starting.');task.notBefore=today;}
  const available=calendarWindow(s,owner===2?[0,1]:[owner],now,zone,command.allowOutsideHours===true);
  let allocation;
  if(action==='start'){
    const estimate=task.minutes-task.spent/60,remainingEstimate=estimate>0?Math.max(1,estimate):5;
    const defaultMinutes=owner===2?Math.min(s.people[0].settings.focus,s.people[1].settings.focus):Math.min(s.people[owner].settings.focus,remainingEstimate);
    const minutes=command.minutes??defaultMinutes;
    requireThat(Number.isFinite(minutes)&&minutes>=1&&minutes<=120&&(owner!==2||Number.isInteger(minutes)),400,'invalid-duration',owner===2?'Choose a whole-number shared focus duration from 1 to 120 minutes.':'Choose a focus duration from 1 to 120 minutes.');
    allocation=Math.min(minutes*60000,available,owner===2?remainingEstimate*60000:Infinity);
    requireThat(allocation>=60000,422,'short-window','There is less than one minute before your next protected time boundary.');
    setTimer(s,owner,{task:task.id,remaining:allocation,total:allocation,started:now,running:true});
  }else{
    allocation=Math.min(timer.remaining,available);
    requireThat(allocation>0&&(allocation>=60000||allocation===timer.remaining),422,'short-window','There is not enough free time to resume before the next boundary.');
    timer.remaining=allocation;timer.started=now;timer.running=true;
  }
  return normalizeState(s);
}
