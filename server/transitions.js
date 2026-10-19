import {ApiError,forbidden} from './errors.js';
import {allTasks,clone,normalizeState,same,setBreak,setTimer,settleTimer,taskMap,timerFor} from './state.js';
import {zoneDay,zonedAt} from './time.js';

function omit(value,fields){const copy=clone(value);for(const field of fields)delete copy[field];return copy;}
const protectedTask=['spent','created','completed','completedDay'];
const content=t=>omit(t,[...protectedTask,'request','assignedBy','help','helper']);
const cleanCompare=t=>omit(t,protectedTask);
function assert(condition,message){if(!condition)throw forbidden(message);}
function verifyRequest(request,from,to,origin){assert(request&&request.from===from&&request.to===to&&(request.origin===undefined||request.origin===origin),'The request does not have valid member provenance.');}
function mapRecords(records){return new Map(records.map(x=>[x.id,x]));}
function hasCompletion(task){return task.status==='done'||(task.status==='archived'&&task.completed&&task.completedDay);}

export function authorizeAndApply(current,proposed,actor,now,zone,historical=new Map()){
  const next=normalizeState(proposed),previous=clone(current),before=taskMap(previous),after=taskMap(next),today=zoneDay(now,zone),stamp=new Date(now).toISOString();
  const other=1-actor;
  for(const key of ['settings','routines','appointments','setup'])assert(same(next.people[other][key],previous.people[other][key]),`Only your partner can change their ${key}.`);
  for(const owner of [0,1]){
    const oldRoutines=mapRecords(previous.people[owner].routines);
    for(const routine of next.people[owner].routines){
      const old=oldRoutines.get(routine.id);
      routine.spent=0;routine.status='open';routine.created=old?.created||stamp;
      routine.generatedDays=clone(old?.generatedDays||[]);delete routine.completed;delete routine.completedDay;delete routine.request;
      routine.steps=routine.steps.map(step=>({...step,done:false}));
      if(owner===actor&&!old)routine.assignedBy=actor;
    }
  }
  const oldNotes=mapRecords(previous.notes),newNotes=mapRecords(next.notes);
  for(const [id,note] of oldNotes){const changed=newNotes.get(id);if(note.from!==actor)assert(changed&&same(note,changed),'Only the author can edit or remove that note.');}
  for(const [id,note] of newNotes){const old=oldNotes.get(id);if(!old){assert(note.from===actor,'A new note must belong to you.');note.date=stamp;}else{assert(note.from===old.from,'A note author cannot be changed.');note.date=old.date;}}
  if(!same(next.checkins,previous.checkins)){
    assert(next.checkins?.date===today,'Check in for today in the shared space’s time zone.');
    const oldMoods=previous.checkins?.date===today?previous.checkins.moods:[null,null];
    assert(next.checkins.moods[other]===oldMoods[other],'Only your partner can change their check-in.');
  }

  for(const [id,oldItem] of before){
    const updated=after.get(id),old=oldItem.task;
    if(!updated){assert((oldItem.owner===actor||oldItem.owner===2)&&!old.request,'Only the owner may delete this task; pending requests must be answered first.');continue;}
    const t=updated.task;
    if(old.request){
      const r=old.request,origin=r.origin??r.from;
      if(t.request){assert(updated.owner===oldItem.owner&&same(cleanCompare(t),cleanCompare(old)),'A pending request must be accepted or returned before editing it.');}
      else if(updated.owner===oldItem.owner){assert(actor===r.to,'Only the recipient may accept a task request.');t.assignedBy=old.assignedBy??r.from;}
      else{
        assert([r.from,r.to].includes(actor)&&updated.owner===origin&&same(content(t),content(old)),'A declined request must return unchanged to its original list.');
        t.assignedBy=r.from;t.help=false;t.helper=null;
      }
    }else if(updated.owner===oldItem.owner){
      assert(!t.request,'A task request cannot be fabricated on an unchanged list.');
      if(oldItem.owner!==actor&&oldItem.owner!==2){
        assert(same(omit(t,[...protectedTask,'helper']),omit(old,[...protectedTask,'helper'])),'Only your partner may edit their personal task.');
        if(t.helper!==old.helper)assert(old.status==='open'&&old.help&&[actor,null].includes(t.helper),'You can offer help only on an open task that requests it.');
      }else if(oldItem.owner===actor){
        const proposedHelper=t.helper??null,oldHelper=old.helper??null;
        assert(proposedHelper===oldHelper||(!t.help&&proposedHelper===null),'A help offer must come from the other member.');
        if(!t.help)t.helper=null;
      }
      t.assignedBy=old.assignedBy;
    }else{
      assert(old.status==='open','Only open tasks can change lists.');
      const owns=oldItem.owner===actor||oldItem.owner===2;
      const takeover=oldItem.owner===other&&updated.owner===actor&&old.help;
      assert(owns||takeover,'Taking over a partner’s task requires their open help request.');
      if(updated.owner===other){
        assert(owns&&t.status==='open','An assignment must remain an open request.');
        verifyRequest(t.request,actor,other,oldItem.owner);
        t.request={from:actor,to:other,origin:oldItem.owner,created:stamp};
      }else{assert(!t.request,'This move does not require a pending request.');delete t.request;}
      t.assignedBy=actor;t.help=false;t.helper=null;
    }
  }
  for(const [id,item] of after)if(!before.has(id)){
    const t=item.task,history=historical.get(id);
    const recorded=[...previous.people.flatMap(p=>p.sessions),...(previous.togetherSessions||[])].some(x=>x.task===id);
    assert(history||!recorded,'This older task identity has recorded history. Restore a verified snapshot instead of recreating it.');
    if(history){
      assert(history.owner===item.owner&&(item.owner===actor||item.owner===2),'Restore a deleted personal task only to its original owner’s list.');
      assert(t.routine===history.task.routine&&t.occurrenceDate===history.task.occurrenceDate,'A restored occurrence must keep its original routine identity.');
    }else{
      assert(!t.routine,'Routine occurrences are generated by the shared space.');
      assert(!next.people.some(p=>p.routines.some(r=>id.startsWith(`${r.id}:`))),'Routine occurrence identities are reserved.');
    }
    if(item.owner===other){verifyRequest(t.request,actor,other,actor);assert(t.status==='open','A new partner request must be open.');t.request={from:actor,to:other,origin:actor,created:stamp};t.help=false;t.helper=null;}
    else{assert(!t.request,'Create a request only on your partner’s list.');assert(t.helper===undefined||t.helper===null||(history&&t.help&&t.helper===history.task.helper),'A new task cannot invent a help offer.');}
    t.assignedBy=history?.task.assignedBy??actor;t.created=history?.task.created||stamp;
  }

  // Settle original server allocations before mutating task location or status.
  // Client timer/session fields never decide whether earned time is recorded.
  for(const owner of [0,1,2]){
    const timer=timerFor(previous,owner);if(!timer)continue;
    const item=after.get(timer.task),old=before.get(timer.task)?.task;
    if(!item||item.owner!==owner||item.task.status!=='open'||item.task.request||item.task.notBefore>today){
      settleTimer(previous,owner,now,zone);setTimer(previous,owner,null);
      if(item&&item.task.status==='done'&&old?.status!=='done')setBreak(previous,owner,now);
    }
  }
  const earned=taskMap(previous);
  for(const [id,item] of after){
    const t=item.task,old=earned.get(id)?.task,history=historical.get(id)?.task;
    const sessionSeconds=[...previous.people.flatMap(p=>p.sessions),...(previous.togetherSessions||[])].filter(x=>x.task===id).reduce((n,x)=>n+x.seconds,0);
    t.spent=old?.spent??(history?Math.max(history.spent||0,sessionSeconds):0);
    if(old)t.created=old.created;
    if(hasCompletion(t)){
      const prior=old&&hasCompletion(old)?old:history&&hasCompletion(history)?history:null;
      t.completed=prior?.completed||stamp;t.completedDay=prior?.completedDay||today;
    }else{delete t.completed;delete t.completedDay;}
    if(item.owner===2){t.help=false;t.helper=null;}
  }
  for(const owner of [0,1]){
    next.people[owner].timer=clone(previous.people[owner].timer??null);
    next.people[owner].sessions=clone(previous.people[owner].sessions);
    next.people[owner].restUntil=previous.people[owner].restUntil??null;
    next.people[owner].plans={};
  }
  next.togetherTimer=clone(previous.togetherTimer??null);next.togetherSessions=clone(previous.togetherSessions||[]);
  for(const owner of [0,1]){
    const appointments=next.people[owner].appointments;
    for(let i=0;i<appointments.length;i++)for(let j=i+1;j<appointments.length;j++)if(appointments[i].date===appointments[j].date&&appointments[i].start<appointments[j].end&&appointments[i].end>appointments[j].start)throw new ApiError(422,'appointment_overlap','Appointments cannot overlap on the same person’s calendar.');
    const oldAppointments=mapRecords(previous.people[owner].appointments);
    const timer=next.togetherTimer?.running?next.togetherTimer:next.people[owner].timer?.running?next.people[owner].timer:null;
    for(const a of appointments)if(timer&&!same(a,oldAppointments.get(a.id))){const start=zonedAt(a.date,a.start,zone),end=zonedAt(a.date,a.end,zone);assert(!(start<timer.started+timer.remaining&&end>now),'Pause the focus session before reserving overlapping time.');}
  }
  return normalizeState(next);
}
