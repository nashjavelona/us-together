import {day as calendarDay,uid,parse,plan,remaining,settle,at,validDate,validTime,validTask,setCalendarZone,getCalendarZone,addCalendarDays} from './core.js';
import {initial,locate,move,finish,validCouple,migrate,todayTasks,requestMove,respond,rejectRequest,undoSnapshot,restoreAction} from './couple.js';
import {beginTogether,pauseTogether,resumeTogether,endTogether,settleTogether} from './together.js';
import {focusWindow,nextAction,validateTaskDraft,applyTaskDraft,backupSnapshot,reconcileSteps} from './ui-model.js';
import {createCloudSync} from './cloud-sync.js';
import {createCloudUI} from './cloud-ui.js';
import {API_BASE} from './cloud-config.js';
import {BODY_LIMIT, REACTIONS, wallNotes, mailItems, unreadFor, sendForYou, markForYouRead, reactForYou, removeForYou, pruneOrphanForYouMetadata, NOTE_LIMIT} from './for-you.js';

const $=q=>document.querySelector(q);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEY='us-together.v2';
let cloud=null,cloudUI=null,cloudBusy=false,cloudOffset=0,cloudExpiryPull=0,connectionIdentity=null;
const appNow=()=>Date.now()+cloudOffset;
const day=value=>calendarDay(value??new Date(appNow()));
let s=initial(),view='home',mobile=0,filter='today',broken=false,saveOK=true,lastDay=day(),lastPlan=0,undo=null,query='',mailDrafts=['',''],mailVisible=40;
let toastTimer;const expandedPlans=new Set();
let syncStatus={kind:'local',message:'Saved on this device',pending:false};
const connected=()=>!!cloud?.connection;
const canEditOwner=owner=>!connected()||owner===2||owner===cloud.connection.role;
// Unsent drafts stay on this browser, scoped to the current member and space.
// Do not put drafts into the shared state or another member's inbox.
const mailDraftKey=connection=>connection?
  `us-together.mail-drafts.v1:${connection.spaceId}:${connection.role}`:
  'us-together.mail-drafts.v1:local';
function readMailDrafts(connection=cloud?.connection){
 try{
  const drafts=JSON.parse(localStorage.getItem(mailDraftKey(connection))||'null');
  if(Array.isArray(drafts)&&drafts.length===2&&drafts.every(value=>typeof value==='string'))
   return drafts.map(value=>value.slice(0,BODY_LIMIT));
 }catch{/* Optional drafts must never prevent opening the dashboard. */}
 return ['',''];
}
function persistMailDrafts(){
 try{localStorage.setItem(mailDraftKey(cloud?.connection),JSON.stringify(mailDrafts));}
 catch{/* A full browser still needs to save committed tasks; draft persistence is best effort. */}
}
try{
  const raw=localStorage.getItem(KEY);
  if(raw){const value=JSON.parse(raw);if(!validCouple(value))throw Error('Invalid saved space');s=value;}
  else{const old=localStorage.getItem('momentum.brain.v1');if(old)s=migrate(JSON.parse(old));}
}catch{broken=true;s=initial();}
mobile=s.active;
setCalendarZone(null);
cloud=createCloudSync({apiBase:API_BASE,getState:()=>s,onState:receiveCloudState,onStatus:status=>{
  syncStatus=status;updateStorageIndicator();cloudUI?.statusChanged();
},onConnection:connection=>{
  const identity=connection?`${connection.spaceId}:${connection.deviceId}:${connection.role}`:null;
  const changed=identity!==connectionIdentity;connectionIdentity=identity;
  if(connection){s.active=connection.role;if(changed)mobile=connection.role;setCalendarZone(connection.zone);}
  else{cloudOffset=0;setCalendarZone(null);}
  if(changed){mailDrafts=readMailDrafts(connection);undo=null;cloudExpiryPull=0;if(cloudUI)render();}
  cloudUI?.statusChanged();
}});
if(cloud.connection){s.active=cloud.connection.role;mobile=s.active;connectionIdentity=`${cloud.connection.spaceId}:${cloud.connection.deviceId}:${cloud.connection.role}`;setCalendarZone(cloud.connection.zone);}
cloudUI=createCloudUI({cloud,getState:()=>s,modal,close,error,toast,render,exportBackup,apiBase:API_BASE});
mailDrafts=readMailDrafts();

const name=i=>i===2?'Both of us':s.names[i];
const all=()=>[...s.people[0].tasks,...s.people[1].tasks,...s.shared];
const isWin=t=>t.status==='done'||(t.status==='archived'&&t.completed&&t.completedDay);
const wins=()=>all().filter(isWin);
const doneToday=()=>wins().filter(t=>t.completedDay===day());
const open=i=>(i===2?s.shared:s.people[i].tasks).filter(t=>t.status==='open');
const time=timestamp=>new Date(timestamp).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',...(getCalendarZone()?{timeZone:getCalendarZone()}:{})});
const niceDate=date=>new Date(date+'T12:00').toLocaleDateString([],{month:'short',day:'numeric'});
const fmt=ms=>{const n=Math.max(0,Math.ceil(ms/1000));return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;};
const sessionMinutes=(sessions,date)=>Math.round((sessions||[]).filter(x=>x.date===date).reduce((n,x)=>n+x.seconds,0)/60);
const initials=i=>s.initials?.[i]||name(i).slice(0,1).toUpperCase();
const moodData={soft:{icon:'☁',label:'Soft start',note:'One small thing is enough.'},steady:{icon:'◒',label:'Steady',note:'Your pace is a good pace.'},bright:{icon:'✦',label:'Feeling good',note:'A little energy for what matters.'}};
const moments=[
 {title:'Tea for two, phones away',text:'A warm drink. Ten minutes. Just catching up.',minutes:10},
 {title:'Take the long way together',text:'A little walk, with nowhere urgent to be.',minutes:15},
 {title:'Trade one good thing',text:'Tell each other one thing that made today better.',minutes:5},
 {title:'Make something delicious',text:'Pick a meal and make a little mess together.',minutes:30},
 {title:'One-song kitchen dance',text:'Your favorite song counts as a very good plan.',minutes:5},
 {title:'Dream up your next little date',text:'A small adventure to look forward to.',minutes:15}
];
const momentIndex=()=>s.momentIndex??(Number(day().slice(-2))%moments.length);
const moodFor=i=>s.checkins?.date===day()?s.checkins.moods[i]:null;

function toast(message,canUndo=false){
  if(!saveOK&&!broken){message='Changes are not saved. Export a backup before closing.';canUndo=false;}
  $('#toast').innerHTML=`<span>${esc(message)}</span>${canUndo?'<button data-a="undo">Undo</button>':''}<button class="toast-dismiss" data-a="dismiss-toast" aria-label="Dismiss message">×</button>`;
  $('#toast').classList.add('show');clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),canUndo?12000:6500);
}
function error(message){
  const region=$('#dialog-status');
  if($('#dialog').open&&region){region.textContent=message;region.hidden=false;region.focus?.();region.scrollIntoView?.({block:'nearest'});}
  else toast(message);
}
function updateStorageIndicator(){
  const node=$('#storage');if(!node)return;
  node.textContent=broken?'Saved data needs attention · Settings':!saveOK?'Not saved · export a backup':connected()?(syncStatus.message||'Connecting to your shared space'):'Saved on this device · connect to share';
  node.dataset.kind=connected()?syncStatus.kind:'local';
  const label=$('#cloud-label');if(label)label.textContent=connected()?'Our connection':'Connect us';
}
function receiveCloudState(value,envelope){
  if(!validCouple(value))return error('A shared update could not be read. Your current tasks are still here.');
  const prior=s,ownRole=envelope?.role??s.active;
  if(Number.isFinite(envelope?.serverOffset))cloudOffset=envelope.serverOffset;
  const now=appNow(),expired=(old,next)=>old?.running&&!next&&old.started+old.remaining<=now&&now-(old.started+old.remaining)<60000;
  const ended=expired(prior.people[ownRole]?.timer,value.people[ownRole]?.timer)||expired(prior.togetherTimer,value.togetherTimer);
  s=value;broken=false;
  if(envelope?.role===0||envelope?.role===1)s.active=envelope.role;
  if(envelope?.zone)setCalendarZone(envelope.zone);
  planSpace(s,appNow());save(false);render();
  if(ended&&document.visibilityState!=='hidden'){chime();toast('Your focus session is done. A little reset?');}
}
function save(sync=true){
  if(broken)return false;
  if(connected())s.active=cloud.connection.role;
  try{if(!validCouple(s))throw Error('Invalid state');localStorage.setItem(KEY,JSON.stringify(s));saveOK=true;}
  catch{saveOK=false;toast('Could not save. Export a backup before closing.');}
  if(saveOK&&sync&&connected()&&!cloud.save(s))saveOK=false;
  updateStorageIndicator();
  return saveOK;
}
function planSpace(space,now=appNow()){
  const timer=space.togetherTimer;
  const busy=timer?.running&&remaining(timer,now)>0?[{start:now,end:now+remaining(timer,now),type:'together',title:space.shared.find(t=>t.id===timer.task)?.title||'Focus together'}]:[];
  space.people.forEach(p=>plan(p,now,busy,!connected()));
}
function refresh(sync=true){planSpace(s);lastPlan=appNow();save(sync);render();}
function modal(html){
  $('#dialog').innerHTML=`<div id="dialog-status" class="form-error" role="alert" tabindex="-1" hidden></div>${html.replace('<h2','<h2 id="dialog-title"')}`;
  if(!$('#dialog').open)$('#dialog').showModal();
}
function close(){if($('#dialog').open)$('#dialog').close();}
function navigate(next){view=next;close();if(next==='inbox'&&pruneOrphanForYouMetadata(s,s.active))save();render();window.scrollTo?.({top:0,behavior:'instant'});}
function goTo(id){if(view!=='home'){view='home';close();render();}$(id)?.scrollIntoView?.({behavior:typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});}
function current(i){return nextAction(s.people[i],appNow()).task;}
async function runCloudFocus(args){
  if(cloudBusy)return;cloudBusy=true;
  const shownDialog=$('#dialog').innerHTML;
  try{
    await cloud.focus(args);
    if($('#dialog').innerHTML===shownDialog)close();
    if(args.owner===2)goTo('#together-focus');
    toast(args.action==='end'?'Your focused time is saved. The task stays open.':args.action==='pause'?'Paused. Your focused time is saved.':args.action==='skip-break'?'Ready when you are.':'Your shared space has the updated timer.');
  }catch(err){error(err.message||'Reconnect before starting or changing a shared timer.');}
  finally{cloudBusy=false;}
}
function last7(){return Array.from({length:7},(_,i)=>addCalendarDays(day(),i-6));}
const taskDraftSignature=t=>JSON.stringify([t.title,t.minutes,t.priority,t.due,t.notBefore,t.preferred,t.steps,t.status,t.request]);

function taskrow(t,owner){
  const metadata=[`<span>${t.minutes} min</span>`];
  if(t.priority==='High')metadata.push('<span class="priority-high">A priority</span>');
  if(t.due)metadata.push(`<span class="${t.due<day()&&t.status==='open'?'overdue':''}">${t.due<day()&&t.status==='open'?'Overdue ·':'Due'} ${niceDate(t.due)}</span>`);
  if(t.request)metadata.push(`<span class="request-pill">Request from ${esc(name(t.request.from))}</span>`);
  if(t.routine)metadata.push('<span>↻ Routine</span>');
  if(t.help)metadata.push(`<span>♡ ${t.helper===0||t.helper===1?`${esc(name(t.helper))} offered a hand`:'A hand would help'}</span>`);
  if(t.notBefore>day())metadata.push(`<span>Starts ${niceDate(t.notBefore)}</span>`);
  if(t.steps.length)metadata.push(`<span>${t.steps.filter(x=>x.done).length}/${t.steps.length} steps</span>`);
  return `<div class="taskrow ${isWin(t)?'done':''}"><button class="check" data-a="complete" data-id="${esc(t.id)}" ${t.request||t.status!=='open'||!canEditOwner(owner)?'disabled':''} aria-label="${isWin(t)?'Completed':'Complete'} ${esc(t.title)}"><span aria-hidden="true">${isWin(t)?'✓':''}</span></button><div class="taskbody"><div class="tasktitle">${esc(t.title)}</div><div class="taskmeta">${metadata.join('')}</div></div><button class="more" data-a="taskmenu" data-id="${esc(t.id)}" aria-label="Options for ${esc(t.title)}">···</button></div>`;
}
function timerRing(duration,timer,owner){
  const total=timer?.total||timer?.remaining||duration||1;
  const progress=timer?Math.min(100,Math.max(0,(1-duration/total)*100)):0;
  return `<div class="timer-ring" style="--progress:${progress}" ${timer?`data-ring="${owner}"`:''}><div class="mission-time" ${owner==='together'?'data-together-timer':`data-timer="${owner}"`} aria-label="Focus time remaining">${fmt(duration)}</div><span class="timer-caption">${timer?(timer.running?'a little time, well spent':'paused · take your time'):'minutes, just for this'}</span></div>`;
}
function mission(i){
  const p=s.people[i],next=nextAction(p,appNow()),t=next.task;
  if(connected()&&i!==s.active&&!s.togetherTimer){
    const timer=p.timer,title=timer?t?.title||'A little focus':next.kind==='appointment'?next.appointment.title:next.kind==='rest'?'A little reset':t?.title||'Room for their next small step';
    return `<section class="doing-now partner-focus"><div class="eyebrow">${esc(name(i))}’S RHYTHM</div><h3>${esc(title)}</h3>${timer?timerRing(remaining(timer,appNow()),timer,i):`<p class="tiny">${next.kind==='appointment'?'This time is protected.':next.kind==='rest'?'Taking a breath between little steps.':'Their focus controls stay on their device. You can still send a kind request or offer a hand.'}</p>`}<button data-a="schedule" data-owner="${i}">View their day ↗</button></section>`;
  }
  if(s.togetherTimer)return `<section class="doing-now shared-focus-state"><div class="state-icon" aria-hidden="true">♡</div><div class="eyebrow">SAME TEAM, SAME MOMENT</div><h3>You’re in this together.</h3><p class="tiny">Your individual plans can wait while you share a little focus.</p><button data-a="shared-focus-jump">Go to your shared timer ↗</button></section>`;
  if(next.kind==='appointment')return `<section class="doing-now"><div class="state-icon" aria-hidden="true">◷</div><div class="eyebrow">PROTECTED TIME</div><h3>${esc(next.appointment.title)}</h3><p>Until ${time(at(day(),next.appointment.end))}</p><p class="tiny">${p.timer?'Your paused focus is saved for afterward.':'Your next task will be here when you’re free.'}</p><button data-a="schedule" data-owner="${i}">View your day</button></section>`;
  if(next.kind==='rest')return `<section class="doing-now"><div class="focus-label"><span class="eyebrow">A LITTLE RESET</span><span aria-hidden="true">☁</span></div><h3>Take a breath.</h3><div class="mission-time" data-rest="${i}">${fmt(next.duration)}</div><p class="tiny">Stretch, get some water, or say hello to your favorite person.</p><button data-a="skipbreak" data-owner="${i}">I’m ready · skip break</button></section>`;
  if(next.kind==='empty')return `<section class="doing-now empty-focus"><div class="empty-symbol" aria-hidden="true">✦</div><div class="eyebrow">A LITTLE ROOM TO BREATHE</div><h3>${next.upcoming?'Today has some space.':'Start with one tiny thing.'}</h3><p class="tiny">${next.upcoming?`${next.upcoming} future task${next.upcoming===1?' is':'s are'} waiting for another day.`:'No need to plan your whole life. Just the next small step.'}</p><button data-a="edit" data-owner="${i}">${i===s.active?'＋ Add my first task':`＋ Ask ${esc(name(i))}`}</button></section>`;
  if(next.kind==='hours')return `<section class="doing-now"><div class="state-icon" aria-hidden="true">${next.before?'☀':'☾'}</div><div class="eyebrow">${next.before?'A GENTLE START':'YOU CAN CALL IT A DAY'}</div><h3>${next.before?`Your day starts at ${time(at(day(),p.settings.start))}.`:'There’s life beyond the list.'}</h3><p class="tiny">Your unfinished tasks are safe. ${next.before?'Enjoy the space before you begin.':'Tomorrow is another little beginning.'}</p><div class="mission-actions"><button data-a="starttask" data-id="${esc(t.id)}">Choose a little extra focus</button><button data-a="schedule" data-owner="${i}">View plan</button></div></section>`;
  if(next.kind==='waiting')return `<section class="doing-now"><div class="state-icon" aria-hidden="true">◷</div><div class="eyebrow">A LITTLE LATER</div><h3>${esc(t.title)}</h3><p class="tiny">Planned for ${time(next.starts)}. There’s room to pause until then.</p><div class="mission-actions"><button data-a="starttask" data-id="${esc(t.id)}">I’d like to start now</button><button data-a="edit" data-id="${esc(t.id)}">Adjust plan</button></div></section>`;
  if(next.kind==='full')return `<section class="doing-now"><div class="state-icon" aria-hidden="true">☁</div><div class="eyebrow">A FULL DAY IS ENOUGH</div><h3>Let’s make some room.</h3><p class="tiny">There isn’t a full minute free in the remaining plan. Your tasks are still here.</p><button data-a="edit" data-id="${esc(t.id)}">Move a task to another day</button></section>`;
  const timer=p.timer;
  return `<section class="doing-now ${timer?.running?'is-focusing':''}"><div class="focus-label"><span class="eyebrow">${timer?(timer.running?'● IN YOUR LITTLE FOCUS ZONE':'PAUSED · YOUR PROGRESS IS SAFE'):'YOUR NEXT SMALL STEP'}</span><span aria-hidden="true">✦</span></div><h3>${esc(t.title)}</h3>${timerRing(next.duration,timer,i)}<div class="mission-actions"><button class="mission-start" data-a="focus" data-owner="${i}">${timer?(timer.running?'Ⅱ Pause':'▶ Resume'):'▶ Start focus'}</button><button data-a="complete" data-id="${esc(t.id)}">✓ Done</button></div><div class="mission-links">${timer?`<button data-a="endtimer" data-owner="${i}">End session</button>`:`<button data-a="just" data-id="${esc(t.id)}">Just 5 minutes</button>`}<button data-a="edit" data-id="${esc(t.id)}">Make it smaller</button></div>${t.spent/60>=t.minutes?'<p class="tiny">You used the estimate. Keep going for five minutes or call it done.</p>':''}</section>`;
}
function inlinePlan(i){
  const p=s.people[i].plans[day()],blocks=p?.blocks||[];
  return `<details class="timeline-disclosure" data-owner="${i}" ${expandedPlans.has(i)?'open':''}><summary><span>Your day, gently planned</span><span aria-hidden="true">⌄</span></summary><section class="inline-plan">${p?.overflow.length?`<div class="capacity">${p.overflow.length} task${p.overflow.length===1?' needs':'s need'} a little more room. Nothing has been removed.</div>`:''}<div class="day-blocks">${blocks.map(b=>`<div class="day-block ${esc(b.type)}"><time>${time(b.start)}</time><span>${esc(b.title)}</span><small>${Math.round((b.end-b.start)/60000)}m</small></div>`).join('')||'<p class="tiny">No focus blocks left in today’s plan.</p>'}</div><div class="button-row"><button class="plan-detail" data-a="schedule" data-owner="${i}">Appointments & full plan ↗</button><button class="plan-detail" data-a="replan-inline" data-owner="${i}">Refresh plan</button></div></section></details>`;
}
function person(i){
  const p=s.people[i],tasks=todayTasks(s,i,day()),completed=p.tasks.filter(t=>isWin(t)&&t.completedDay===day()),total=tasks.length+completed.length,pct=total?Math.round(completed.length/total*100):0,mood=moodData[moodFor(i)];
  const focused=sessionMinutes([...p.sessions,...(s.togetherSessions||[])],day());
  const upcoming=p.tasks.filter(t=>t.status==='open'&&!t.request&&t.notBefore>day()).length;
  return `<section class="person ${i?'pink':'black'} ${mobile!==i?'mobile-hidden':''} ${s.active===i?'is-active':''}" aria-label="${esc(name(i))}’s space"><div class="person-head"><div class="avatar" aria-hidden="true">${esc(initials(i))}</div><div><div class="person-label">${s.active===i?'YOUR LITTLE SPACE':'YOUR PARTNER’S LITTLE SPACE'}</div><h2>${esc(name(i))}</h2></div><button class="edit-name" data-a="settings" aria-label="Edit nicknames and personalize">↗</button></div><p class="pace-note">${mood?`${mood.icon} ${mood.note}`:i?'A little softness. A little progress.':'Different rhythm. Same little team.'}</p><div class="progress-line"><span>${completed.length} of ${total} done today</span><div class="track" role="progressbar" aria-label="${esc(name(i))}’s task progress" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div><span>${pct}%</span></div>${mission(i)}<label class="capture-label" for="capture-${i}">${i===s.active?'What’s one thing on your mind?':`A little request for ${esc(name(i))}?`}</label><form class="add-inline" data-owner="${i}"><input id="capture-${i}" name="task" placeholder="e.g. Read for 20 minutes" required maxlength="300" autocomplete="off"><button type="submit" aria-label="${i===s.active?'Add my task':`Ask ${esc(name(i))}`}" title="Save task">＋</button></form><div class="capture-hint">${i===s.active?'Add a duration or date. We’ll make room for it.':`This will be a request from ${esc(name(s.active))}, ready for their yes.`}</div><div class="task-section-label"><span>THE LITTLE LIST</span><span>${tasks.length} to do</span></div>${tasks.slice(0,3).map(t=>taskrow(t,i)).join('')||'<div class="empty-person">Nothing left on today’s list. That counts, too.</div>'}${completed.slice(-1).map(t=>taskrow(t,i)).join('')}<div class="person-footer"><span>${focused} min of showing up</span><button data-a="upcoming">${upcoming} upcoming →</button>${tasks.length>3?'<button data-view="tasks">See all →</button>':''}</div>${inlinePlan(i)}</section>`;
}
function checkin(){
  const selected=moodFor(s.active),other=moodData[moodFor(1-s.active)];
  return `<section class="checkin-strip" aria-label="Optional daily energy check-in"><div class="checkin-heading"><span class="eyebrow">A TINY CHECK-IN</span><strong>How are you arriving, ${esc(name(s.active))}?</strong><span class="tiny">${other?`${esc(name(1-s.active))}: ${other.label.toLowerCase()} today.`:'You can have different kinds of days.'}</span></div><div class="mood-options">${Object.entries(moodData).map(([key,m])=>`<button data-a="mood" data-mood="${key}" class="${selected===key?'selected':''}" aria-pressed="${selected===key}"><span aria-hidden="true">${m.icon}</span> ${m.label}</button>`).join('')}</div></section>`;
}
function teamwork(){
  const requests=all().filter(t=>t.status==='open'&&t.request),help=all().filter(t=>t.status==='open'&&t.help&&!t.request);
  if(!requests.length&&!help.length)return '';
  return `<section class="shared teamwork" id="teamwork" tabindex="-1"><div class="section-head"><div><span class="eyebrow">SHOWING UP FOR EACH OTHER</span><h2>A little teamwork</h2><p>Ask kindly. Help when you have room.</p></div><span class="team-count">${requests.length+help.length}</span></div>${requests.length?'<h3 class="team-label">WAITING FOR A LITTLE YES</h3>':''}${requests.map(t=>`<div class="team-row"><div><strong>${esc(t.title)}</strong><p>${esc(name(t.request.from))} → ${esc(name(t.request.to))} · ${t.minutes} min</p></div><div class="team-actions">${s.active===t.request.to?`<button class="btn-rose" data-a="accept" data-id="${esc(t.id)}">I’ve got it</button><button data-a="request-date" data-id="${esc(t.id)}">Another day</button><button data-a="decline" data-id="${esc(t.id)}">Not now</button>`:`${connected()?`<span class="tiny">Waiting for ${esc(name(t.request.to))}</span>`:`<button data-a="profile" data-owner="${t.request.to}">Switch to ${esc(name(t.request.to))}</button>`}<button data-a="cancel-request" data-id="${esc(t.id)}">Cancel request</button>`}</div></div>`).join('')}${help.length?'<h3 class="team-label">A HAND WOULD HELP</h3>':''}${help.map(t=>{const owner=locate(s,t.id).owner;return `<div class="team-row"><div><strong>${esc(t.title)}</strong><p>${esc(name(owner))} ${t.helper===0||t.helper===1?`· ${esc(name(t.helper))} is available`:'could use a little support'}</p></div><div class="team-actions">${owner===2?`<button data-a="together-start" data-id="${esc(t.id)}">Focus together</button><button data-a="help" data-id="${esc(t.id)}">Clear help request</button>`:owner!==s.active?`<button data-a="offer" data-id="${esc(t.id)}">${t.helper===s.active?'Withdraw offer':'I’m here to help'}</button><button class="btn-rose" data-a="takeover" data-id="${esc(t.id)}">I’ll take this</button>`:`<button data-a="help" data-id="${esc(t.id)}">We’re all good now</button>`}</div></div>`;}).join('')}</section>`;
}
function togetherFocus(){
  const timer=s.togetherTimer;if(!timer)return '';
  const task=s.shared.find(t=>t.id===timer.task);if(!task)return '';
  return `<section class="shared together-focus" id="together-focus" aria-label="Shared focus session"><div class="section-head"><div><div class="eyebrow">ONE TASK. TWO PEOPLE. A LITTLE MOMENT.</div><h2>${esc(task.title)}</h2><p>${esc(name(0))} + ${esc(name(1))} · shared focus, counted once</p></div><span class="heart" aria-hidden="true">♡</span></div>${timerRing(remaining(timer,appNow()),timer,'together')}<div class="mission-actions"><button class="btn-rose" data-a="together-toggle">${timer.running?'Ⅱ Pause together':'▶ Resume together'}</button><button class="btn-dark" data-a="complete" data-id="${esc(task.id)}">✓ We did it</button><button data-a="together-end">End session</button></div><p class="tiny">Ending a session saves the time. “We did it” completes the task.</p></section>`;
}
function sharedSection(){
  const tasks=open(2).filter(t=>t.notBefore<=day()),moment=moments[momentIndex()],next=tasks[0];
  return `<section class="shared shared-section" id="shared"><div class="section-head"><div class="section-title"><span class="heart" aria-hidden="true">♡</span><div><div class="eyebrow">THE THINGS WE SHARE</div><h2>Ours to do</h2><p>Life admin. Little adventures. A little more us.</p></div></div><button class="btn-dark" data-a="edit" data-owner="2">＋ Add together</button></div><div class="shared-grid"><div>${tasks.map(t=>taskrow(t,2)).join('')||'<div class="shared-empty"><span class="empty-symbol" aria-hidden="true">∞</span><h3>Your next little thing starts here.</h3><p>Plan a date, sort the groceries, or dream up something together.</p></div>'}${next&&!s.togetherTimer?`<button class="btn-rose shared-start" data-a="together-start" data-id="${esc(next.id)}">▶ Focus together</button>`:''}${open(2).some(t=>t.notBefore>day())?'<button class="text-btn" data-a="upcoming">See your upcoming shared plans →</button>':''}</div><aside class="ritual-card"><div class="ritual-kicker">A MOMENT FOR US <span aria-hidden="true">✦</span></div><h3 class="ritual-title">${moment.title}</h3><p>${moment.text}</p><span class="tiny">An idea, not another obligation. About ${moment.minutes} minutes.</span><div class="ritual-actions"><button class="btn-rose" data-a="plan-moment">Make it a plan ♡</button><button data-a="another-moment">Another idea ↻</button></div></aside></div></section>`;
}
function notesAndWeek(){
  const notes=wallNotes(s),note=notes.find(n=>n.id===s.pinnedNote)||notes.at(-1),week=last7();
  return `<div class="bottom-grid"><section class="little-card love-card"><div class="section-head"><div><div class="eyebrow">THE SMALL THINGS WE SAY</div><h2>Love, left here.</h2></div><button class="text-btn" data-a="note">Leave a note ↗</button></div><div class="note-paper">${note?`<p class="note">“${esc(note.text)}”</p><div class="note-byline">${note.id===s.pinnedNote?'Pinned with love · ':''}From ${esc(name(note.from))}<span>${new Date(note.date).toLocaleDateString([],{month:'short',day:'numeric'})}</span></div>`:'<p class="note">A thank-you. A tiny encouragement. Or simply, “I’m glad it’s you.”</p><span class="note-byline">Your first little note belongs here.</span>'}</div>${notes.length?'<button class="text-btn" data-a="notes">Open our little note collection →</button>':''}</section><section class="little-card"><div class="section-head"><div><div class="eyebrow">PROGRESS, WITHOUT KEEPING SCORE</div><h2>A week of little wins</h2></div><button class="text-btn" data-view="wins">View all ↗</button></div><div class="week">${week.map(date=>{const n=wins().filter(t=>t.completedDay===date).length;return `<div class="day" aria-label="${niceDate(date)}: ${n} completed tasks">${new Date(date+'T12:00').toLocaleDateString([],{weekday:'short'})}<span class="${n?'filled':''}" aria-hidden="true">${n?'♡':'·'}</span></div>`;}).join('')}</div><p class="tiny">${wins().filter(t=>week.includes(t.completedDay)).length} things finished this week. Small steps still move you forward.</p><p class="closing">Different rhythms. Same team.</p></section></div>`;
}
// A small post office for two, saved through our existing author-locked note records.
const mailTime=stamp=>new Date(stamp).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',...(getCalendarZone()?{timeZone:getCalendarZone()}:{})});
const mailPrompt=["Just wanted to say I'm proud of you ♡","What's one good thing about today?","I love our little everyday moments.","Can we plan a tiny date this week?"];
function mailboxPreview(){
 const unread=unreadFor(s,s.active),recent=mailItems(s).filter(item=>item.to===s.active).at(-1);
 return `<section class="postcard-peek" aria-label="Notes and messages for you"><div class="postcard-stamp" aria-hidden="true">✉<span>♡</span></div><div class="postcard-copy"><div class="eyebrow">A LITTLE SOMETHING FOR YOU</div><h2>${unread?`${unread} unopened little thing${unread===1?'':'s'} ♡`:recent?'Your person left something sweet.':'Make their day in two sentences.'}</h2><p>${recent?recent.kind==='letter'?'A letter is waiting in your shared mailbox.':`Latest from ${esc(name(recent.from))}: ${esc(recent.text.slice(0,100))}${recent.text.length>100?'…':''}`:'Send your person a tiny hello, or leave a letter for a hard day.'}</p></div><button class="btn-rose" data-view="inbox">${unread?'Open what’s for me':'Open For You'} →</button></section>`;
}
function mailbox(){
 const items=mailItems(s),actor=s.active,incoming=items.filter(item=>item.to===actor),unread=unreadFor(s,actor),letters=items.filter(item=>item.kind==='letter').slice(-24).reverse(),messages=items.filter(item=>item.kind==='message'),visible=messages.slice(-mailVisible);
 return `<section class="post-office" aria-label="For You: messages and letters"><div class="post-office-header"><div><span class="eyebrow">TWO PEOPLE. ONE LITTLE POST OFFICE.</span><h2>Your little corner of <em>us.</em></h2><p>A message for today, a letter for someday, and the little things we forget to say aloud.</p></div><div class="post-counter"><span class="mail-heart">♡</span><strong>${unread}</strong><small>unopened for ${esc(name(actor))}</small></div></div><div class="post-tools"><button class="btn-rose" data-a="compose-letter">✎ Write a letter</button><button data-a="mail-prompt">♡ Surprise my person</button><span class="tiny">${connected()?'Messages sync between your connected devices while online.':'Saved on this browser. Connect your shared space to deliver between devices.'}</span></div>${unread?`<button class="mail-read-all" data-a="mail-seen-all">Mark all ${unread} as read ✓</button>`:''}<div class="mail-layout"><section class="mail-thread" aria-label="Messages"><div class="mail-section-title"><div><span class="eyebrow">THE LITTLE CONVERSATION</span><h3>Just between us <span aria-hidden="true">↗</span></h3></div><span class="mail-count">${messages.length} message${messages.length===1?'':'s'}</span></div><div class="mail-bubbles" id="mail-bubbles">${messages.length>visible.length?`<button class="mail-more" data-a="mail-more">Load earlier messages (${messages.length-visible.length})</button>`:''}${visible.map(item=>`<article class="mail-bubble ${item.from===actor?'mine':'theirs'}"><span class="mail-sender">${esc(name(item.from))} · ${mailTime(item.date)}</span><p>${esc(item.text)}</p><div class="mail-small-actions">${item.from===actor?`<span>${item.seen?'Seen ♡':'Sent · awaiting read'}</span><button data-a="mail-remove" data-id="${esc(item.id)}" aria-label="Remove my message">Remove</button>`:`${!item.seen?`<button data-a="mail-seen" data-id="${esc(item.id)}">Mark read</button>`:'<span>Read ♡</span>'}${Object.entries(REACTIONS).map(([code,emoji])=>`<button data-a="mail-react" data-id="${esc(item.id)}" data-reaction="${code}" aria-label="React ${code}" title="${code}" class="${item.reaction===code?'selected':''}" aria-pressed="${item.reaction===code}">${emoji}</button>`).join('')}`}${item.reaction?`<span class="mail-reaction">${REACTIONS[item.reaction]}</span>`:''}</div></article>`).join('')||'<div class="mail-empty"><span aria-hidden="true">✉</span><h3>Say your first little hello.</h3><p>It doesn’t have to be a big message. A few kind words are enough.</p></div>'}</div><form id="messageform" class="mail-compose"><label for="message-text">Send a little message to ${esc(name(1-actor))}</label><div class="mail-compose-box"><textarea id="message-text" name="message" rows="2" required maxlength="${BODY_LIMIT}" placeholder="Thinking of you…" aria-describedby="mail-compose-help">${esc(mailDrafts[actor])}</textarea><button class="btn-rose" type="submit">Send ♡</button></div><span id="mail-compose-help" class="tiny">Short and sweet · ${BODY_LIMIT} characters max · No push alerts yet</span></form></section><section class="letter-shelf" aria-label="Little letters"><div class="mail-section-title"><div><span class="eyebrow">KEEP WHAT MATTERS</span><h3>Letters to open ♡</h3></div><span class="mail-count">${letters.length} letter${letters.length===1?'':'s'}</span></div><p class="tiny">A small surprise for your favorite person. Open it when you need a little warmth.</p><div class="letter-pile">${letters.map(item=>`<article class="envelope ${item.to===actor&&!item.seen?'unopened':''}"><span class="letter-seal" aria-hidden="true">${item.to===actor&&!item.seen?'✉':'♡'}</span><div><strong>${item.from===actor?'A letter you wrote':item.seen?'A letter from '+esc(name(item.from)):'A sealed letter for '+esc(name(actor))}</strong><span>${mailTime(item.date)} · ${item.to===actor?(item.seen?'Opened':'Not opened yet'):(item.seen?'Read by your person':'Waiting to be opened')}</span></div><button data-a="mail-open" data-id="${esc(item.id)}">${item.to===actor&&!item.seen?'Open ♡':'Read letter'}</button></article>`).join('')||'<div class="letter-empty"><div class="stamp-large" aria-hidden="true">✉</div><h3>A letter lasts longer than a notification.</h3><p>Leave one they can open when they need you.</p><button data-a="compose-letter">Write the first one →</button></div>'}</div></section></div><p class="mail-privacy tiny">Your messages and letters are visible to the two members of this space. A device recovery file gives access to the space—keep it private. Messages sync while the website is open and online.</p></section>`;
}
function composeLetter(prefill=''){
 const author=s.active;
 modal(`<form id="letterform"><span class="eyebrow">A NOTE JUST FOR ${esc(name(1-author)).toUpperCase()}</span><h2>A letter in their pocket. ♡</h2><p>Some words are worth keeping. Write a little letter and leave it for your person to open.</p><div class="letter-writing"><label for="letter-text">Dear ${esc(name(1-author))},</label><textarea id="letter-text" name="letter" rows="7" maxlength="${BODY_LIMIT}" required placeholder="I wanted to remind you that…">${esc(prefill)}</textarea><span>With love, ${esc(name(author))} ♡</span></div><div class="note-prompts"><span class="field-help">Need a starting line?</span>${["One thing I appreciate about you is ","For a day when you need a smile: ","My favorite memory of us is "].map(text=>`<button type="button" data-a="letter-prompt" data-text="${esc(text)}">${esc(text.trim())}…</button>`).join('')}</div><p class="field-help">${connected()?'Your person can open this when the space syncs.':'This stays in this browser until you connect your shared space.'}</p><div class="form-actions"><button type="button" data-a="close">Not yet</button><button class="btn-rose">Seal with love ♡</button></div></form>`);
 $('#letterform').onsubmit=e=>{e.preventDefault();if(broken)return error('Your saved data needs attention before sending.');if(s.active!==author)return error('Your profile changed. Reopen this letter first.');try{sendForYou(s,author,'letter',String(new FormData(e.target).get('letter')||''),new Date(appNow()).toISOString());}catch(err){return error(err.message);}if(!save())return;close();render();toast(connected()?'Your letter is saved and waiting to sync ♡':'Your letter is saved here ♡');};
}
function openLetter(id){
 const letter=mailItems(s).find(item=>item.id===id&&item.kind==='letter');if(!letter)return error('That letter is no longer here.');
 if(letter.to===s.active&&!letter.seen){try{markForYouRead(s,s.active,id,new Date(appNow()).toISOString());save();render();}catch(err){return error(err.message);}}
 const item=mailItems(s).find(row=>row.id===id);
 modal(`<div class="letter-reader"><div class="eyebrow">OPEN WITH LOVE ✉</div><h2>${esc(name(item.from))} left this for ${esc(name(item.to))}.</h2><div class="opened-paper"><div>Dear ${esc(name(item.to))},</div><p>${esc(item.text)}</p><div>Always, ${esc(name(item.from))} ♡</div></div><span class="tiny">Written ${mailTime(item.date)}</span>${item.to===s.active?`<div class="letter-reactions">A little reply without words ${Object.entries(REACTIONS).map(([code,emoji])=>`<button data-a="mail-react" data-id="${esc(item.id)}" data-reaction="${code}" class="${item.reaction===code?'selected':''}" aria-label="React ${code}" aria-pressed="${item.reaction===code}">${emoji}</button>`).join('')}</div>`:item.reaction?`<p class="tiny">Your person reacted ${REACTIONS[item.reaction]}</p>`:''}<div class="form-actions"><button data-a="close">Close letter</button>${item.from===s.active?`<button class="danger-button" data-a="mail-remove" data-id="${esc(item.id)}">Remove my letter</button>`:''}<button class="btn-rose" data-view="inbox">Our little inbox →</button></div></div>`);
}
function headerContent(){
  const titles={home:'A little you. A little me.<br><em>A lot of us.</em>',tasks:'Your plans,<br><em>side by side.</em>',wins:'Look at you two,<br><em>showing up.</em>',inbox:'A little note,<br><em>just for you.</em>'};
  const descriptions={home:s.tagline||'A softer place for your plans, your progress, and your favorite person.',tasks:'Your own goals, shared plans, and room to help each other.',wins:'Every small step counts. You don’t have to move at the same pace.',inbox:'A tiny hello, a sealed letter, or just a reminder: you have each other.'};
  return `<div class="intro"><div><div class="eyebrow">OUR EVERYDAY, A LITTLE LIGHTER</div><h1>${titles[view]}</h1><p>${esc(descriptions[view])}</p></div><div class="intro-art" aria-hidden="true"><svg viewBox="0 0 210 140" fill="none"><path d="M33 80C11 59 35 32 57 46C69 16 108 28 100 61C99 81 74 97 52 115C45 100 40 93 33 80Z" fill="#f1c5d5" stroke="#853658" stroke-width="2"/><path d="M117 95C92 80 103 44 130 50C137 24 177 30 176 58C182 78 165 101 145 120C132 112 124 104 117 95Z" fill="#24232a" stroke="#24232a" stroke-width="2"/><path d="M69 81C96 56 117 62 137 82M187 19v16m-8-8h16M23 21l9 10m-13 0 13-10" stroke="#997846" stroke-width="2" stroke-linecap="round"/></svg><span class="sticker-note">same team,<br>always.</span></div></div>`;
}
function render(){
  const oldMail=$('#mail-bubbles');
  const scrollState=oldMail&&Number.isFinite(oldMail.scrollTop)&&Number.isFinite(oldMail.scrollHeight)?{top:oldMail.scrollTop,bottom:oldMail.scrollHeight-oldMail.scrollTop-oldMail.clientHeight<85}:null;
  const wasWriting=document.activeElement?.id==='message-text';
  const cursor=wasWriting?{start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd}:null;
  const drafts=[...document.querySelectorAll('.add-inline')].map(f=>({owner:f.dataset.owner,value:f.elements.task.value,focused:document.activeElement===f.elements.task}));
  document.querySelectorAll('nav [data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute?.('aria-current',b.dataset.view===view?'page':'false');});
  document.querySelectorAll('nav [data-view="inbox"]').forEach(b=>{const count=unreadFor(s,s.active);b.setAttribute?.('aria-label',count?`For You, ${count} unread`:'For You');b.innerHTML=`For You ♡${count?`<span class="nav-count" aria-hidden="true">${Math.min(99,count)}${count>99?'+':''}</span>`:''}`;});
  const incoming=all().filter(t=>t.request?.to===s.active).length,totalFocused=sessionMinutes([...s.people.flatMap(p=>p.sessions),...(s.togetherSessions||[])],day());
  let html=headerContent()+(cloudUI?.bannerHTML()||'');
  if(broken)html+='<div class="notice" role="alert">Saved data could not be read and has not been overwritten. Open Settings to export the original or restore a backup.</div>';
  html+=`<div class="toolbar"><div class="profiles"><span>${connected()?`Here as ${esc(name(s.active))} · view`:'Here as'}</span>${[0,1].map(i=>`<button data-a="profile" data-owner="${i}" class="${(connected()?mobile:s.active)===i?'chosen':''}" aria-pressed="${(connected()?mobile:s.active)===i}"><span class="profile-dot ${i?'pink':'black'}" aria-hidden="true">${esc(initials(i))}</span>${esc(name(i))}</button>`).join('')}</div>${incoming?`<button class="request-banner" data-a="requests">♡ ${incoming} request${incoming===1?'':'s'} for you <span aria-hidden="true">→</span></button>`:'<span class="local">One little team, at your own pace.</span>'}</div>`;
  if(view==='home'){
    html+=`<div class="couple-pulse"><div class="pulse-stat"><strong>${doneToday().length}</strong><span>little wins today</span></div><div class="pulse-stat"><strong>${totalFocused}<small> min</small></strong><span>of showing up</span></div><div class="pulse-stat"><strong>${open(2).length}</strong><span>plans for us</span></div></div>${checkin()}${mailboxPreview()}${togetherFocus()}<div class="couple"><span class="together-mark" aria-hidden="true">♡</span>${person(0)}${person(1)}</div>${teamwork()}${sharedSection()}${notesAndWeek()}`;
  }else if(view==='tasks'){
    html+=`<form id="searchform" class="task-search"><label class="sr-only" for="task-query">Search tasks</label><input id="task-query" name="query" placeholder="Find a little thing…" value="${esc(query)}"><button>Search</button>${query?'<button type="button" data-a="clearsearch">Clear</button>':''}</form><div class="section-head task-list-heading"><div class="filters" aria-label="Task filter">${['today','upcoming','requests','open','done','archived'].map(x=>`<button data-a="filter" data-filter="${x}" class="${filter===x?'active':''}" aria-pressed="${filter===x}">${({today:'Today',upcoming:'Upcoming',requests:'Requests',open:'All open',done:'Completed',archived:'Archived'})[x]}</button>`).join('')}</div><button class="btn-dark" data-a="edit" data-owner="${s.active}">＋ Add task</button></div><div class="couple">${[0,1].map(i=>`<section class="person ${i?'pink':'black'}"><div class="section-head"><h2>${esc(name(i))}</h2><span class="filter-count">${s.people[i].tasks.filter(matchesFilter).length}</span></div>${s.people[i].tasks.filter(matchesFilter).map(t=>taskrow(t,i)).join('')||'<div class="empty-person">Nothing in this view. A little breathing room.</div>'}<div class="person-footer"><button data-a="routines" data-owner="${i}">Manage routines ↻</button></div></section>`).join('')}</div><section class="shared"><div class="section-head"><h2>Both of us</h2><button data-a="edit" data-owner="2">＋ Add for us</button></div>${s.shared.filter(matchesFilter).map(t=>taskrow(t,2)).join('')||'<p class="tiny">No shared tasks in this view.</p>'}</section>`;
  }else if(view==='inbox'){
    html+=mailbox();
  }else{
    const days=last7(),history=wins().sort((a,b)=>b.completed.localeCompare(a.completed)),week=history.filter(t=>days.includes(t.completedDay));
    const minutes=Math.round([...s.people.flatMap(p=>p.sessions),...(s.togetherSessions||[])].filter(x=>days.includes(x.date)).reduce((n,x)=>n+x.seconds,0)/60);
    html+=`<div class="metrics"><div class="metric"><span class="eyebrow">WINS TODAY</span><strong>${doneToday().length}</strong><span class="tiny">Little things, real progress</span></div><div class="metric"><span class="eyebrow">FOCUS THIS WEEK</span><strong>${minutes}<small> min</small></strong><span class="tiny">Shared sessions counted once</span></div><div class="metric"><span class="eyebrow">SHARED WINS</span><strong>${s.shared.filter(isWin).length}</strong><span class="tiny">Things you finished together</span></div></div><section class="shared"><h2>A week of little steps</h2><p class="tiny">Tasks completed by either of you. No comparisons, just progress.</p><div class="bars" role="img" aria-label="${days.map(d=>`${niceDate(d)}: ${week.filter(t=>t.completedDay===d).length} completed`).join('; ')}">${days.map(d=>{const n=week.filter(t=>t.completedDay===d).length,max=Math.max(1,...days.map(x=>week.filter(t=>t.completedDay===x).length));return `<div class="barcol"><span>${n}</span><div class="bar" style="height:${n/max*100}px"></div><span>${new Date(d+'T12:00').toLocaleDateString([],{weekday:'short'})}</span></div>`;}).join('')}</div></section><section class="shared"><h2>Look what you did.</h2>${history.map(t=>`<div class="wins-row"><div>♡ &nbsp;${esc(t.title)}<span class="owner-label">${esc(name(locate(s,t.id).owner))}${t.status==='archived'?' · archived':''}</span></div><span class="tiny">${niceDate(t.completedDay)}</span></div>`).join('')||'<div class="shared-empty"><h3>Your first little win belongs here.</h3><p>It doesn’t have to be a big one.</p><button data-view="home">Back to our space</button></div>'}</section>`;
  }
  $('#app').innerHTML=html;
  if(view==='inbox'){const list=$('#mail-bubbles');if(list&&Number.isFinite(list.scrollHeight))list.scrollTop=scrollState&&!scrollState.bottom?scrollState.top:list.scrollHeight;}
  if(view==='inbox'&&wasWriting){const field=$('#message-text');field?.focus?.();if(field?.setSelectionRange&&cursor?.start!==null&&cursor?.start!==undefined)field.setSelectionRange(cursor.start,cursor.end);}
  for(const d of drafts){const f=$(`.add-inline[data-owner="${d.owner}"]`);if(f?.elements?.task){f.elements.task.value=d.value;if(d.focused)f.elements.task.focus?.();}}
  updateStorageIndicator();cloudUI?.statusChanged();
}
function matchesFilter(t){
  if(query&&!t.title.toLowerCase().includes(query.toLowerCase()))return false;
  if(filter==='today')return t.status==='open'&&!t.request&&t.notBefore<=day();
  if(filter==='upcoming')return t.status==='open'&&!t.request&&t.notBefore>day();
  if(filter==='requests')return t.status==='open'&&!!t.request;
  return t.status===filter;
}

function edit(id,owner=s.active,preset=null){
  const found=id&&locate(s,id);if(id&&!found){error('That task is no longer here.');return;}
  if(found?.t.request){error('Respond to the request before editing this task.');return;}
  if(found&&!canEditOwner(found.owner))return error('Your partner edits their personal tasks. Offer a hand when they ask for help.');
  const t=found?.t||{...parse('',25,new Date(appNow())),...(preset||{})};if(found)owner=found.owner;
  const expectedStatus=t.status;
  const expectedDraft=taskDraftSignature(t);
  const isRunning=(owner<2&&s.people[owner].timer?.task===id)||s.togetherTimer?.task===id;
  modal(`<form id="taskform"><div class="eyebrow">ONE SMALL NEXT STEP</div><h2>${id?'Make it work for you.':'What’s on your mind?'}</h2><label>Task<input name="title" required maxlength="300" value="${esc(t.title)}" placeholder="Plan our next date night"></label><div class="formgrid"><label>Whose task?<select name="owner">${(id&&t.status!=='open'?[owner]:[0,1,2]).map(i=>`<option value="${i}" ${owner===i?'selected':''}>${esc(name(i))}</option>`).join('')}</select></label><label>Estimated minutes<input name="minutes" type="number" min="1" max="1440" required value="${t.minutes}"></label><label>Priority<select name="priority">${['Low','Medium','High'].map(x=>`<option ${t.priority===x?'selected':''}>${x}</option>`).join('')}</select></label><label>Deadline · optional<input name="due" type="date" value="${esc(t.due)}"></label><label>Schedule from<input name="notBefore" type="date" required value="${esc(t.notBefore)}"></label><label>Preferred time · optional<input name="preferred" type="time" value="${esc(t.preferred)}"></label></div><label class="checkbox-label"><input type="checkbox" name="allowLate" ${t.due&&t.due<t.notBefore?'checked':''}> Allow a start after the deadline; keep it marked overdue.</label>${!id?`<label>Repeat · personal tasks only<select name="repeat"><option value="">Just once</option><option value="daily">Every day</option><option value="weekly">Selected weekdays</option></select></label><fieldset class="weekdays"><legend>For selected weekdays</legend>${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d,i)=>`<label><input type="checkbox" name="days" value="${i}"> ${d}</label>`).join('')}</fieldset>`:''}<label>Make it smaller · one step per line<textarea name="steps" rows="3" placeholder="Open the notes&#10;Read one page">${(t.steps||[]).map(x=>esc(x.title)).join('\n')}</textarea></label>${isRunning?'<p class="field-help">Text and checklist edits keep your timer running. Moving this task to another person or a future day ends the session and keeps the time you earned.</p>':''}<p class="field-help">Choosing your partner adds a request for them to accept. “Both of us” creates a shared task.</p><div class="form-actions"><button type="button" data-a="close">Cancel</button><button class="btn-rose">Save this little plan ♡</button></div></form>`);
  $('#taskform').onsubmit=e=>{
    e.preventDefault();if(broken)return error('Restore a valid backup before editing.');
    const f=new FormData(e.target),to=Number(f.get('owner'));
    if(![0,1,2].includes(to))return error('Choose one of your two profiles or Both of us.');
    const live=id&&locate(s,id);
    if(id&&(!live||live.owner!==owner||live.t.status!==expectedStatus||live.t.request))return error('This task changed while the form was open. Close it and reopen the task before editing.');
    if(id&&taskDraftSignature(live.t)!==expectedDraft)return error('This task changed on another device while you were editing. Your draft is still here; copy it if needed, then reopen the task to review the latest version.');
    if(id&&to!==owner&&live.t.status!=='open')return error('Reopen this task before moving it to another list.');
    const values={title:String(f.get('title')||'').trim(),minutes:Number(f.get('minutes')),priority:f.get('priority'),due:f.get('due')||'',notBefore:f.get('notBefore'),preferred:f.get('preferred')||'',allowLate:f.has('allowLate'),steps:reconcileSteps(f.get('steps'),live?live.t.steps:t.steps)};
    const message=validateTaskDraft(values);if(message)return error(message);
    const repeat=f.get('repeat')||'',days=f.getAll('days').map(Number);
    if(repeat&&to===2)return error('Shared plans are one-time tasks. Choose one person to set up a repeating routine.');
    if(repeat&&to!==s.active)return error(`Switch to ${name(to)} to set up their own repeating routine.`);
    if(repeat==='weekly'&&!days.length)return error('Choose at least one weekday for this routine.');
    if(!['','daily','weekly'].includes(repeat))return error('Choose a valid repeat option.');
    let stopped=false;
    if(id){const result=applyTaskDraft(s,id,values,appNow());if(!result.ok)return error(result.error);stopped=result.stopped;
      if(to!==owner){if(!requestMove(s,id,to))return error('This task cannot be moved right now.');stopped=stopped||!!isRunning;}
    }else{
      const {allowLate,...fields}=values;Object.assign(t,fields);t.assignedBy=s.active;
      if(repeat)s.people[to].routines.push({...t,repeat,days,from:t.notBefore});
      else{if(to<2&&to!==s.active)t.request={from:s.active,to,origin:s.active,created:new Date().toISOString()};(to===2?s.shared:s.people[to].tasks).push(t);}
    }
    const pending=!!locate(s,id||t.id)?.t.request;
    close();refresh();toast(stopped?'Saved. Your session ended and the time you earned is kept.':pending?'A kind request, ready for their yes.':'A little plan, saved.');
  };
}
function menu(id){
  const found=locate(s,id);if(!found)return;const {t,owner}=found;
  if(!canEditOwner(owner)&&!t.request){
    modal(`<div class="eyebrow">${esc(name(owner))}’S LITTLE PLAN</div><h2>${esc(t.title)}</h2><p class="field-help">Your partner manages this personal task. You can see their progress and offer support.</p>${t.steps.length?`<ul class="partner-steps">${t.steps.map(step=>`<li>${step.done?'✓':'○'} ${esc(step.title)}</li>`).join('')}</ul>`:''}<div class="dialog-list">${t.status==='open'&&t.help?`<button data-a="offer" data-id="${esc(id)}">${t.helper===s.active?'Withdraw my offer':'I’m available to help ♡'}</button><button class="btn-rose" data-a="takeover" data-id="${esc(id)}">I’ll take this over</button>`:''}<button data-a="close">Close</button></div>`);return;
  }
  let actions='';
  if(t.request){actions=`<p class="field-help">${esc(name(t.request.from))} is asking ${esc(name(t.request.to))} to take this one.</p>${s.active===t.request.to?`<button class="btn-rose" data-a="accept" data-id="${esc(id)}">I’ve got it · accept</button><button data-a="request-date" data-id="${esc(id)}">Choose another day</button><button data-a="decline" data-id="${esc(id)}">Not now</button>`:`<button data-a="cancel-request" data-id="${esc(id)}">Cancel my request</button>`}<button data-a="requests">Go to all requests →</button>`;}
  else if(t.status==='archived'){actions=`<button class="btn-rose" data-a="restore-task" data-id="${esc(id)}">Restore task</button><button class="danger-button" data-a="delete" data-id="${esc(id)}">Delete task…</button>`;}
  else{
    if(t.status==='open'){
      actions+=owner===2?`<button class="btn-rose" data-a="together-start" data-id="${esc(id)}">♡ Focus on this together</button>`:`<button class="btn-rose" data-a="starttask" data-id="${esc(id)}">▶ Start focusing</button><button data-a="just" data-id="${esc(id)}">Just start · 5 minutes</button>`;
      if(owner===2&&t.help)actions+=`<button data-a="help" data-id="${esc(id)}">Clear help request</button>`;
      if(owner===s.active)actions+=`<button data-a="help" data-id="${esc(id)}">♡ ${t.help?'We’re all good · clear request':'Ask for a little help'}</button>`;
      if(owner!==s.active&&owner<2&&t.help)actions+=`<button data-a="offer" data-id="${esc(id)}">♡ ${t.helper===s.active?'Withdraw my offer':'I’m available to help'}</button><button data-a="takeover" data-id="${esc(id)}">I’ll take this over</button>`;
      actions+=[0,1,2].filter(i=>i!==owner).map(i=>`<button data-a="assign" data-id="${esc(id)}" data-owner="${i}">↗ ${i===2?'Make it a shared task':i===s.active?'Move to my list':`Ask ${esc(name(i))} to take this`}</button>`).join('');
    }else actions+=`<button data-a="reopen" data-id="${esc(id)}">Reopen this task</button>`;
    actions+=`<button data-a="edit" data-id="${esc(id)}">Edit, reschedule or break it down</button><button data-a="archive" data-id="${esc(id)}">Archive task</button><button class="danger-button" data-a="delete" data-id="${esc(id)}">Delete task…</button>`;
  }
  modal(`<div class="eyebrow">${esc(name(owner))} · ${t.minutes} MINUTES</div><h2>${esc(t.title)}</h2>${t.steps.length?`<div class="steps"><h3>The smaller steps</h3>${t.steps.map((step,index)=>`<label><input type="checkbox" data-step="${index}" data-id="${esc(id)}" ${step.done?'checked':''} ${t.status!=='open'||t.request?'disabled':''}> ${esc(step.title)}</label>`).join('')}</div>`:''}<div class="dialog-list">${actions}<button data-a="close">Close</button></div>`);
}
function start(i,id,minutes=null,outsideHours=false,early=false){
  if(!canEditOwner(i))return error('Your partner starts focus from their own device.');
  const p=s.people[i],t=p?.tasks.find(x=>x.id===id);if(!t||t.status!=='open'||t.request)return;
  if(s.togetherTimer)return error('End your shared session before starting an individual timer.');
  if(p.timer)return error('Resume your current timer, or end that session before starting another.');
  if(t.notBefore>day()&&!early){modal(`<h2>Start this task early?</h2><p>It’s planned for ${niceDate(t.notBefore)}. ${minutes?`Your ${minutes}-minute choice will stay the same.`:'You can move it to today.'}</p><div class="form-actions"><button data-a="close">Keep planned date</button><button class="btn-rose" data-a="start-early" data-id="${esc(id)}" data-owner="${i}" data-minutes="${minutes??''}" data-outside="${outsideHours?'1':'0'}">Move to today & start</button></div>`);return;}
  const candidate={...t,notBefore:early?day():t.notBefore},window=focusWindow(p,candidate,minutes,appNow(),outsideHours);
  if(!window.ok){
    if(window.reason==='hours')modal(`<h2>A little extra focus?</h2><p>You’re outside your planned day (${p.settings.start}–${p.settings.end}). This is optional extra time.</p><div class="form-actions"><button data-a="close">Rest sounds good</button><button class="btn-rose" data-a="outside-start" data-id="${esc(id)}" data-owner="${i}" data-minutes="${minutes??''}" data-early="${early?'1':'0'}">Start anyway</button></div>`);
    else error(({break:'Take your break, or choose Skip break first.',appointment:'This time is reserved for an appointment.',short:'Less than a minute is free before your next time boundary.',duration:'Choose a focus duration between 1 and 120 minutes.'})[window.reason]||'This task is not available to start right now.');
    return;
  }
  if(connected())return runCloudFocus({action:'start',owner:i,taskId:id,minutes,allowOutsideHours:outsideHours,allowEarly:early});
  if(early)t.notBefore=day();p.timer={task:id,remaining:window.duration,total:window.duration,started:Date.now(),running:true};close();refresh();
}
function resumePersonal(i,outsideHours=false){
  if(!canEditOwner(i))return error('Your partner resumes focus from their own device.');
  const p=s.people[i],timer=p.timer,t=p.tasks.find(x=>x.id===timer?.task);if(!timer||!t)return;
  if(s.togetherTimer)return error('End your shared session before resuming an individual timer.');
  const window=focusWindow(p,t,timer.remaining/60000,appNow(),outsideHours,true);
  if(!window.ok){
    if(window.reason==='hours')modal(`<h2>Resume outside your planned day?</h2><p>Your focus time is saved. Continue only if you have room.</p><div class="form-actions"><button data-a="close">Stay paused</button><button class="btn-rose" data-a="resume-outside" data-owner="${i}">Resume anyway</button></div>`);
    else error(window.reason==='appointment'?'This time is reserved. Resume after your appointment.':window.reason==='break'?'Skip your break before resuming.':'There isn’t enough free time to resume before the next boundary.');
    return;
  }
  if(connected())return runCloudFocus({action:'resume',owner:i,allowOutsideHours:outsideHours});
  timer.remaining=window.duration;timer.started=Date.now();timer.running=true;close();refresh();
}
function endtimer(i){const p=s.people[i];if(!p?.timer||!canEditOwner(i))return;if(connected())return runCloudFocus({action:'end',owner:i});settle(p);p.timer=null;close();refresh();toast('Time saved. The unfinished task is still yours.');}
function togetherSetup(id){
  const t=s.shared.find(t=>t.id===id&&t.status==='open');if(!t)return;
  if(s.togetherTimer){close();goTo('#together-focus');return;}
  modal(`<form id="togetherform"><div class="eyebrow">A LITTLE TIME ON THE SAME TEAM</div><h2>Focus together.</h2><p>${esc(t.title)}</p><label>Minutes together<input type="number" name="minutes" min="1" max="120" required value="${Math.min(s.people[0].settings.focus,s.people[1].settings.focus)}"></label><p class="field-help">One shared timer for both of you. It fits around both calendars and records the time once.</p><div class="form-actions"><button type="button" data-a="close">Another time</button><button class="btn-rose">Start together ♡</button></div></form>`);
  $('#togetherform').onsubmit=e=>{e.preventDefault();startShared(id,Number(new FormData(e.target).get('minutes')));};
}
function sharedFailure(reason){return ({'personal-active':'End both individual sessions before starting a shared one. Paused sessions count, too.',break:'One of you is taking a break. Skip that break when you’re both ready.',appointment:'One of your calendars has an appointment right now. Choose a shared moment afterward.','short-window':'You don’t have a full minute free together before the next time boundary.','invalid-duration':'Choose a whole number from 1 to 120 minutes.','task-unavailable':'That shared task is no longer available.','together-active':'Your shared session is already here.','future-task':'Move this shared plan to today before starting.','finished':'That session has ended. Start a new session if you need more time.'})[reason]||'This shared session cannot start right now.';}
function startShared(id,minutes,outsideHours=false,early=false){
  const t=s.shared.find(t=>t.id===id);if(!t)return;
  if(t.notBefore>day()&&!early){modal(`<h2>Make this a moment for today?</h2><p>Your shared task is planned for ${niceDate(t.notBefore)}.</p><div class="form-actions"><button data-a="close">Keep that date</button><button class="btn-rose" data-a="shared-early" data-id="${esc(id)}" data-minutes="${minutes}" data-outside="${outsideHours?'1':'0'}">Move to today & start</button></div>`);return;}
  const trial=connected()?JSON.parse(JSON.stringify(s)):s,trialTask=trial.shared.find(x=>x.id===id);
  const previousDate=t.notBefore;if(early)trialTask.notBefore=day();
  const result=beginTogether(trial,id,minutes,appNow(),outsideHours);
  if(!result.ok){t.notBefore=previousDate;if(result.reason==='outside-hours')modal(`<h2>A moment beyond your plans?</h2><p>One or both of you is outside their planned day. Choose together whether to make a little extra room.</p><div class="form-actions"><button data-a="close">Let’s rest</button><button class="btn-rose" data-a="shared-outside" data-id="${esc(id)}" data-minutes="${minutes}" data-early="${early?'1':'0'}">Start together anyway</button></div>`);else error(sharedFailure(result.reason));return;}
  if(connected())return runCloudFocus({action:'start',owner:2,taskId:id,minutes,allowOutsideHours:outsideHours,allowEarly:early});
  s.togetherTimer.total=s.togetherTimer.remaining;close();refresh();goTo('#together-focus');toast('A little shared focus. Same team, same moment.');
}
function resumeShared(outsideHours=false){
  const result=resumeTogether(connected()?JSON.parse(JSON.stringify(s)):s,appNow(),outsideHours);
  if(!result.ok){if(result.reason==='outside-hours')modal(`<h2>Continue outside your planned day?</h2><p>Your shared progress is safe. A little more time is your choice.</p><div class="form-actions"><button data-a="close">Stay paused</button><button class="btn-rose" data-a="shared-resume-outside">Resume together</button></div>`);else error(sharedFailure(result.reason));return;}
  if(connected())return runCloudFocus({action:'resume',owner:2,allowOutsideHours:outsideHours});
  close();refresh();
}
function requestDate(id){
  const f=locate(s,id);if(!f?.t.request||f.t.request.to!==s.active)return;
  modal(`<form id="requestdate"><h2>A day that works for you.</h2><p>Accept this task for another day. ${f.t.due?`Its current deadline is ${niceDate(f.t.due)}.`:''}</p><label>Schedule for<input name="date" type="date" required min="${day()}" value="${day()}"></label>${f.t.due?'<label class="checkbox-label"><input type="checkbox" name="extend"> If needed, move the deadline to this day too.</label>':''}<div class="form-actions"><button type="button" data-a="close">Cancel</button><button class="btn-rose">Accept for this day</button></div></form>`);
  $('#requestdate').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),date=f.get('date');if(!validDate(date)||date<day())return error('Choose today or a future date.');if(!respond(s,id,s.active,date,f.has('extend')))return error('This is after the deadline. Choose an earlier date or allow the deadline to move.');close();refresh();toast('Accepted for a day that works for you.');};
}
function settings(){
  const signature=()=>JSON.stringify([s.names,s.tagline,s.initials,s.sound,s.people.filter((_,i)=>canEditOwner(i)).map(p=>p.settings)]);
  const expected=signature();
  modal(`<form id="settingsform"><div class="eyebrow">MAKE YOURSELVES AT HOME</div><h2>Your space. Your names.</h2><div class="formgrid">${[0,1].map(i=>`<label>${i?'♡ Pink side':'◒ Black side'}<input name="name${i}" required maxlength="30" value="${esc(name(i))}"></label>`).join('')}</div><label>Our tagline<input name="tagline" maxlength="140" value="${esc(s.tagline||'')}" placeholder="Different rhythms. Same team."></label><div class="formgrid">${[0,1].map(i=>`<label>Avatar initials · ${i?'pink':'black'}<input name="initial${i}" maxlength="3" value="${esc(s.initials?.[i]||'')}" placeholder="${esc(initials(i))}"></label>`).join('')}</div><h3>Your days can have different rhythms.</h3><div class="formgrid">${[0,1].map(i=>`<fieldset class="day-settings" ${canEditOwner(i)?'':'disabled'}><label>Day starts · ${esc(name(i))}<input type="time" name="start${i}" required value="${s.people[i].settings.start}"></label><label>Day ends<input type="time" name="end${i}" required value="${s.people[i].settings.end}"></label><label>Focus minutes<input type="number" name="focus${i}" min="1" max="120" required value="${s.people[i].settings.focus}"></label><label>Break minutes<input type="number" name="break${i}" min="0" max="60" required value="${s.people[i].settings.break}"></label></fieldset>`).join('')}</div><p class="field-help">New settings shape the next sessions. A running timer keeps its current allocation.</p><label class="checkbox-label"><input type="checkbox" name="sound" ${s.sound?'checked':''}> A gentle sound when a session ends</label><p class="field-help">Keep the app open for sounds. A closed app cannot ring.</p><div class="form-actions"><button type="button" data-a="close">Close</button><button class="btn-rose">Save our space ♡</button></div><hr>${cloudUI?.settingsHTML()||''}<p class="field-help"><a href="https://github.com/nashjavelona/us-together/archive/refs/heads/main.zip" target="_blank" rel="noopener noreferrer">Download your GitHub repository source ↗</a></p></form>`);
  $('#settingsform').onsubmit=e=>{
    e.preventDefault();if(broken)return error('Restore a valid backup before changing settings.');
    if(signature()!==expected)return error('Your space settings changed while this form was open. Your draft is still here; reopen Settings to review the latest version.');
    const f=new FormData(e.target),names=[0,1].map(i=>String(f.get('name'+i)||'').trim());
    for(let i=0;i<2;i++){
      if(!names[i]||names[i].length>30)return error('Give each side a nickname of 1–30 characters.');
      if(!canEditOwner(i))continue;
      if(!validTime(f.get('start'+i))||!validTime(f.get('end'+i))||f.get('end'+i)<=f.get('start'+i))return error('Each day needs a valid end time after its start.');
      const focus=Number(f.get('focus'+i)),rest=Number(f.get('break'+i));
      if(!Number.isInteger(focus)||focus<1||focus>120||!Number.isInteger(rest)||rest<0||rest>60)return error('Focus time should be 1–120 whole minutes; breaks can be 0–60.');
    }
    s.names=names;s.tagline=String(f.get('tagline')||'').trim().slice(0,140);s.initials=[0,1].map(i=>String(f.get('initial'+i)||'').trim().slice(0,3));
    s.people.forEach((p,i)=>{if(canEditOwner(i))Object.assign(p.settings,{start:f.get('start'+i),end:f.get('end'+i),focus:Number(f.get('focus'+i)),break:Number(f.get('break'+i))});});
    s.sound=f.has('sound');s.setup=true;close();refresh();toast('Feels a little more like you two.');
  };
}
function welcome(){
  modal(`<form id="welcomeform" class="welcome-form"><div class="welcome-art" aria-hidden="true"><span>◒</span><span>♡</span></div><div class="eyebrow">HELLO, YOU TWO.</div><h2>A little space<br>to call your own.</h2><p>Start with the names you call each other. Everything else can wait.</p><div class="formgrid"><label>Black side<input name="black" maxlength="30" required placeholder="Your nickname" value="${s.names[0]==='You'?'':esc(s.names[0])}"></label><label>Pink side<input name="pink" maxlength="30" required placeholder="Their nickname" value="${s.names[1]==='Your person'?'':esc(s.names[1])}"></label></div><p class="field-help">Start here on this device. Choose “Connect us” when you’re ready to share across both phones, with no everyday sign-in screen.</p><div class="form-actions"><button type="button" data-a="welcome-skip">Explore first</button><button class="btn-rose">Make it ours ♡</button></div></form>`);
  $('#welcomeform').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),names=[f.get('black'),f.get('pink')].map(x=>String(x||'').trim());if(names.some(x=>!x||x.length>30))return error('Add both nicknames, up to 30 characters each.');s.names=names;s.setup=true;close();refresh();toast('Welcome to your little space.');};
}
function schedule(i){
  const p=s.people[i],pl=p.plans[day()]||{blocks:[],overflow:[]},editable=canEditOwner(i);
  modal(`<h2>${esc(name(i))}’s day</h2><p>A flexible plan, with breaks and ${p.settings.buffer}-minute buffers.</p>${pl.overflow.length?`<div class="notice">${pl.overflow.length} task${pl.overflow.length===1?' needs':'s need'} more time than today has. Nothing was removed.</div>`:''}${pl.blocks.map(b=>`<div class="schedule-row"><span>${esc(b.title)}</span><small>${time(b.start)}–${time(b.end)}</small></div>`).join('')||'<p class="tiny">No focus blocks remain in today’s plan.</p>'}<div class="form-actions">${editable?`<button data-a="appointment" data-owner="${i}">＋ Add fixed time</button><button data-a="replan" data-owner="${i}">Replan</button>`:''}<button data-a="close">Done</button></div><h3 class="appointment-heading">Current & upcoming appointments</h3>${p.appointments.filter(a=>a.date>=day()).sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)).map(a=>`<div class="schedule-row"><span>${esc(a.title)}<small>${niceDate(a.date)} · ${a.start}–${a.end}</small></span>${editable?`<div class="button-row"><button data-a="editappt" data-owner="${i}" data-id="${esc(a.id)}">Edit</button><button data-a="removeappt" data-owner="${i}" data-id="${esc(a.id)}">Remove</button></div>`:''}</div>`).join('')||'<p class="tiny">No appointments planned yet.</p>'}`);
}
function appointment(i,id){
  if(!canEditOwner(i))return error('Your partner manages their own protected time.');
  const old=s.people[i].appointments.find(a=>a.id===id);
  const expected=old?JSON.stringify(old):null;
  modal(`<form id="apptform"><h2>A little protected time.</h2><label>Appointment<input name="title" required maxlength="150" value="${esc(old?.title||'')}" placeholder="Dinner, a meeting, or time away"></label><label>Date<input name="date" type="date" required value="${old?.date||day()}"></label><div class="formgrid"><label>From<input name="start" type="time" required value="${old?.start||''}"></label><label>Until<input name="end" type="time" required value="${old?.end||''}"></label></div><div class="form-actions"><button type="button" data-a="close">Cancel</button><button class="btn-rose">Save protected time</button></div></form>`);
  $('#apptform').onsubmit=e=>{
    e.preventDefault();const a={...Object.fromEntries(new FormData(e.target)),id:old?.id||uid()},p=s.people[i];a.title=a.title.trim();
    const live=id?p.appointments.find(x=>x.id===id):null;
    if(id&&(!live||JSON.stringify(live)!==expected))return error('This appointment changed while the form was open. Reopen it to review the latest version.');
    if(!a.title||a.title.length>150||!validDate(a.date)||!validTime(a.start)||!validTime(a.end)||a.end<=a.start)return error('Add a name, a real date, and an end time after the start.');
    if(p.appointments.some(b=>b.id!==a.id&&b.date===a.date&&b.start<a.end&&b.end>a.start))return error('This overlaps another appointment. Choose a free time.');
    const timer=s.togetherTimer?.running?s.togetherTimer:p.timer?.running?p.timer:null;
    if(timer&&at(a.date,a.start)<appNow()+remaining(timer,appNow())&&at(a.date,a.end)>appNow())return error('Pause or end the focus session before reserving overlapping time.');
    if(live)Object.assign(live,a);else p.appointments.push(a);refresh();schedule(i);
  };
}
function routineList(i){
  const editable=canEditOwner(i);
  modal(`<h2>${esc(name(i))}’s routines</h2><p>Repeating plans, with room for real life.${editable?'':' Your partner manages these from their own device.'}</p>${s.people[i].routines.map(r=>`<div class="wins-row"><div>${esc(r.title)}<span class="owner-label">${r.paused?'Paused · ':''}${r.repeat==='daily'?'Daily':r.days.map(d=>['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ')}</span></div>${editable?`<div class="button-row"><button data-a="editroutine" data-owner="${i}" data-id="${esc(r.id)}">Edit</button><button data-a="routine" data-owner="${i}" data-id="${esc(r.id)}">${r.paused?'Resume':'Pause'}</button><button class="danger-button" data-a="remove-routine" data-owner="${i}" data-id="${esc(r.id)}">Remove</button></div>`:''}</div>`).join('')||'<p class="tiny">Create a personal task and choose Repeat to begin a routine.</p>'}<div class="form-actions"><button data-a="close">Done</button></div>`);
}
function routineEdit(i,id){
  if(!canEditOwner(i))return error('Your partner manages their own routines.');
  const r=s.people[i].routines.find(r=>r.id===id);if(!r)return;
  const signature=x=>JSON.stringify([x.title,x.minutes,x.preferred,x.repeat,x.days,x.steps,x.from,x.paused]);
  const expected=signature(r);
  modal(`<form id="routineform"><h2>Edit future occurrences</h2><p class="field-help">Tasks already on your list keep their own edits and history.</p><label>Routine name<input name="title" required maxlength="300" value="${esc(r.title)}"></label><div class="formgrid"><label>Minutes<input type="number" min="1" max="1440" required name="minutes" value="${r.minutes}"></label><label>Preferred time<input type="time" name="preferred" value="${esc(r.preferred)}"></label></div><label>Repeat<select name="repeat"><option value="daily" ${r.repeat==='daily'?'selected':''}>Daily</option><option value="weekly" ${r.repeat==='weekly'?'selected':''}>Selected weekdays</option></select></label><fieldset class="weekdays"><legend>For selected weekdays</legend>${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d,n)=>`<label><input type="checkbox" name="days" value="${n}" ${r.days.includes(n)?'checked':''}> ${d}</label>`).join('')}</fieldset><label>Small steps<textarea name="steps" rows="3">${r.steps.map(x=>esc(x.title)).join('\n')}</textarea></label><div class="form-actions"><button type="button" data-a="close">Cancel</button><button class="btn-rose">Save routine</button></div></form>`);
  $('#routineform').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),days=f.getAll('days').map(Number),title=String(f.get('title')||'').trim(),minutes=Number(f.get('minutes')),preferred=f.get('preferred')||'',repeat=f.get('repeat');
    const live=s.people[i].routines.find(x=>x.id===id);
    if(!live||signature(live)!==expected)return error('This routine changed while the form was open. Reopen it to review the latest version.');
    if(!title||title.length>300||!Number.isFinite(minutes)||minutes<1||minutes>1440||(preferred&&!validTime(preferred)))return error('Check the name, duration, and preferred time.');
    if(!['daily','weekly'].includes(repeat)||(repeat==='weekly'&&!days.length))return error('Choose a repeat pattern and at least one weekday.');
    Object.assign(live,{title,minutes,preferred,repeat,days,steps:String(f.get('steps')||'').split('\n').map(x=>x.trim()).filter(Boolean).map(title=>({title,done:false}))});close();refresh();toast('Future routine occurrences updated.');
  };
}
function note(id){
  const old=wallNotes(s).find(n=>n.id===id);if(id&&!old)return error('This love note is not available.');if(old&&old.from!==s.active)return error('Switch to the author’s profile to edit their note.');
  const author=s.active,expected=old?JSON.stringify(old):null;
  modal(`<form id="noteform"><div class="eyebrow">LOVE, LEFT HERE.</div><h2>A little love, from ${esc(name(s.active))}.</h2><label>Your note<textarea id="note-text" name="text" required maxlength="500" rows="4" placeholder="Something you appreciate about them…">${esc(old?.text||'')}</textarea></label>${!old?`<div class="note-prompts"><span class="field-help">A tiny starting point:</span>${["I'm proud of you for ","Thank you for ","My favorite thing about us is "].map(text=>`<button type="button" data-a="note-prompt" data-text="${esc(text)}">${esc(text.trim())}…</button>`).join('')}</div>`:''}<p class="field-help">${connected()?'Your person can read it in your shared space after it syncs.':'Left on this device for the next time you look together.'}</p><div class="form-actions"><button type="button" data-a="close">Cancel</button><button class="btn-rose">${old?'Save this note':'Leave a little love ♡'}</button></div></form>`);
  $('#noteform').onsubmit=e=>{e.preventDefault();const text=String(new FormData(e.target).get('text')||'').trim();if(!text||text.length>500)return error('Write a little note, up to 500 characters.');const live=id?wallNotes(s).find(n=>n.id===id):null;if(s.active!==author||(id&&(!live||live.from!==author||JSON.stringify(live)!==expected)))return error('This note changed while the form was open. Reopen it to review the latest version.');if(!live&&s.notes.length>=1000)return error('Your note collection is full. Export a backup and remove older notes.');if(live)live.text=text;else s.notes.push({id:uid(),from:s.active,text,date:new Date().toISOString()});close();save();render();toast('A little kindness, left here.');};
}
function noteList(){modal(`<h2>Your little love notes</h2>${[...wallNotes(s)].reverse().map(n=>`<div class="wins-row"><div><p class="note">${esc(n.text)}</p><span class="note-meta">From ${esc(name(n.from))} · ${new Date(n.date).toLocaleDateString()}</span><div class="button-row"><button class="text-btn" data-a="pin" data-id="${esc(n.id)}">${s.pinnedNote===n.id?'Unpin':'Pin this note'}</button>${n.from===s.active?`<button class="text-btn" data-a="editnote" data-id="${esc(n.id)}">Edit</button><button class="text-btn danger-button" data-a="deletenote" data-id="${esc(n.id)}">Delete</button>`:''}</div></div></div>`).join('')||'<p>Your first note is waiting to be written.</p>'}<div class="form-actions"><button data-a="note">Leave a note</button><button data-a="close">Done</button></div>`);}
function deleteTask(id){const f=locate(s,id);if(!f||f.t.request)return;modal(`<h2>Delete this little task?</h2><p>${esc(f.t.title)}</p><p class="field-help">The task and checklist will be removed. Recorded focus time stays. Any timer on this task will end. You’ll have a moment to undo.</p><div class="form-actions"><button data-a="close">Keep it</button><button class="danger-button" data-a="confirm-delete" data-id="${esc(id)}">Delete task</button></div>`);}
function removeTask(id){
  const f=locate(s,id);if(!f||f.t.request)return;
  if(f.owner<2&&s.people[f.owner].timer?.task===id){settle(s.people[f.owner]);s.people[f.owner].timer=null;}
  if(s.togetherTimer?.task===id)endTogether(s);
  const list=f.owner===2?s.shared:s.people[f.owner].tasks,index=list.findIndex(t=>t.id===id);
  undo={kind:'delete',owner:f.owner,index,task:JSON.parse(JSON.stringify(f.t))};list.splice(index,1);close();refresh();toast('Task deleted. Recorded focus time is kept.',true);
}
function completeTask(id){
  const f=locate(s,id);if(!f||f.t.request||f.t.status!=='open')return;
  undo={kind:'status',owner:f.owner,afterStatus:'done',snapshot:undoSnapshot(f.t)};
  const personal=f.owner<2&&s.people[f.owner].timer?.task===id,shared=s.togetherTimer?.task===id;
  finish(s,id,appNow());
  if(personal)s.people[f.owner].restUntil=appNow()+s.people[f.owner].settings.break*60000;
  if(shared)s.people.forEach(p=>p.restUntil=appNow()+p.settings.break*60000);
  close();refresh();toast(`♡ ${f.owner===2?'You two did it':'One little win'}: ${f.t.title}`,true);
  const app=$('#app');app.classList.remove('celebrate');app.classList.add('celebrate');setTimeout(()=>app.classList.remove('celebrate'),700);
}
function performUndo(){
  if(!undo)return;const action=undo;undo=null;
  if(connected()){
    const live=action.kind==='status'?locate(s,action.snapshot.id):null;
    if(!canEditOwner(action.owner)||(action.kind==='status'&&(!live||live.owner!==action.owner||live.t.status!==action.afterStatus)))return error('This task changed since that action. Open its latest version before changing it again.');
  }
  if(action.kind==='delete'){if(locate(s,action.task.id))return;const list=action.owner===2?s.shared:s.people[action.owner].tasks;list.splice(Math.min(action.index,list.length),0,action.task);}
  else restoreAction(s,action.snapshot);
  refresh();toast('Undone. Time you actually focused is still kept.');
}
function exportBackup(){
  const raw=broken?(localStorage.getItem(KEY)||localStorage.getItem('momentum.brain.v1')):JSON.stringify(backupSnapshot(s,appNow()),null,2);
  const url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),anchor=document.createElement('a');anchor.href=url;anchor.download=`us-together-${day()}.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  if(!broken)toast('Backup ready. Timers are paused in the copy.');
}

// Event delegation keeps controls consistent as the two spaces re-render.
document.addEventListener('submit',e=>{
  const form=e.target;
  if(form.id==='messageform'){
    e.preventDefault();if(broken)return error('Restore a valid backup before sending.');
    const body=String(new FormData(form).get('message')||'');
    try{sendForYou(s,s.active,'message',body,new Date(appNow()).toISOString());}catch(err){return error(err.message);}
    if(!save())return;mailDrafts[s.active]='';persistMailDrafts();render();toast(connected()?'Saved — your person will see it when synced ♡':'Message saved here. Connect both devices to share it.');return;
  }
  if(form.id==='searchform'){
    e.preventDefault();query=String(new FormData(form).get('query')||'').trim();render();return;
  }
  if(!form.matches?.('.add-inline'))return;
  e.preventDefault();if(broken)return error('Restore a valid backup before adding tasks.');
  const owner=Number(form.dataset.owner),text=String(form.elements.task.value||'').trim();
  if(![0,1].includes(owner)||!text)return;
  if(text.length>300)return error('Keep this little task under 300 characters.');
  const task=parse(text,s.people[owner].settings.focus,new Date(appNow()));task.assignedBy=s.active;
  if(!validTask(task))return error('Check the task name, duration, and date.');
  if(task.repeat&&owner!==s.active)return error(`Switch to ${name(owner)} to add their repeating routine.`);
  if(task.repeat)s.people[owner].routines.push({...task,from:task.notBefore,days:[]});
  else{if(owner!==s.active)task.request={from:s.active,to:owner,origin:s.active,created:new Date().toISOString()};s.people[owner].tasks.push(task);}
  form.elements.task.value='';refresh();
  const typedDate=text.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if(typedDate&&!validDate(typedDate[0]))toast('Saved as written. Check the date in task options; that date is not valid.');
  else toast(owner!==s.active?'A little request, ready for their yes.':task.repeat?'Your routine is ready. One day at a time.':'One less thing to keep in your head.');
});

document.addEventListener('click',e=>{
  const button=e.target.closest?.('[data-view], [data-a], [data-action]');if(!button)return;
  const d=button.dataset,a=d.a||d.action,id=d.id,i=[0,1,2].includes(Number(d.owner))?Number(d.owner):s.active;
  const f=id&&locate(s,id),minutes=d.minutes===''||d.minutes===undefined?null:Number(d.minutes);
  e.preventDefault?.();
  if(d.view){if(['home','tasks','inbox','wins'].includes(d.view))navigate(d.view);return;}
  if(connected()){
    s.active=cloud.connection.role;
    if(f&&!f.t.request&&!canEditOwner(f.owner)&&['complete','reopen','restore-task','archive','delete','confirm-delete','assign','just','starttask','edit','help'].includes(a))return error('Your partner manages this personal task. You can offer help when they ask for a hand.');
    if(!canEditOwner(i)&&['appointment','editappt','removeappt','confirm-removeappt','editroutine','routine','remove-routine','confirm-remove-routine','focus','skipbreak','endtimer','resume-outside'].includes(a))return error('These controls belong to your partner’s device.');
  }
  if(broken&&!['settings','export','restore','close','dismiss-toast'].includes(a))return error('Your saved data needs attention. Export it or restore a valid backup in Settings.');
  switch(a){
    case 'dismiss-toast':$('#toast').classList.remove('show');break;
    case 'welcome-skip':s.setup=true;close();refresh();break;
    case 'close':close();break;
    case 'settings':settings();break;
    case 'profile':case 'mobile':
      if(i>1)return;if(!connected())s.active=i;mobile=i;close();save(false);render();break;
    case 'shared':close();goTo('#shared');break;
    case 'compose-letter':composeLetter();break;
    case 'mail-prompt':composeLetter('One tiny thing I appreciate about you is ');break;
    case 'letter-prompt':if($('#letter-text')){$('#letter-text').value=d.text||'';$('#letter-text').focus?.();}break;
    case 'mail-more':mailVisible+=40;render();break;
    case 'mail-open':openLetter(id);break;
    case 'mail-seen':
      try{if(markForYouRead(s,s.active,id,new Date(appNow()).toISOString())){save();render();}}catch(err){error(err.message);}break;
    case 'mail-seen-all':{
      const cleared=pruneOrphanForYouMetadata(s,s.active);
      const pending=mailItems(s).filter(item=>item.to===s.active&&!item.seen);
      if(s.notes.length+pending.length>NOTE_LIMIT){if(cleared)save();return error('Your note collection is full. Export a backup and remove older notes.');}
      for(const item of pending)markForYouRead(s,s.active,item.id,new Date(appNow()).toISOString());
      if(pending.length||cleared){save();render();toast('All caught up ♡');}break;
    }
    case 'mail-react':
      try{reactForYou(s,s.active,id,d.reaction,new Date(appNow()).toISOString());save();render();if($('#dialog').open&&$('#dialog').innerHTML.includes('letter-reader'))openLetter(id);}catch(err){error(err.message);}break;
    case 'mail-remove':
      if(!mailItems(s).some(item=>item.id===id&&item.from===s.active))return error('You can only remove your own message or letter.');
      modal(`<h2>Remove this little thing?</h2><p>Your message or letter will disappear from both inboxes after syncing. You cannot undo this.</p><div class="form-actions"><button data-a="close">Keep it</button><button class="danger-button" data-a="mail-confirm-remove" data-id="${esc(id)}">Remove for us</button></div>`);break;
    case 'mail-confirm-remove':
      if(!removeForYou(s,s.active,id))return error('This message changed or does not belong to you.');close();save();render();toast('Removed. Your shared space will sync the change.');break;
    case 'shared-focus-jump':close();goTo('#together-focus');break;
    case 'requests':close();goTo('#teamwork');break;
    case 'mood':
      if(!Object.hasOwn(moodData,d.mood))return;
      if(s.checkins?.date!==day())s.checkins={date:day(),moods:[null,null]};
      s.checkins.moods[s.active]=s.checkins.moods[s.active]===d.mood?null:d.mood;
      save();render();break;
    case 'another-moment':s.momentIndex=(momentIndex()+1)%moments.length;save();render();break;
    case 'plan-moment':{const moment=moments[momentIndex()];edit(null,2,{title:moment.title,minutes:moment.minutes});break;}
    case 'clearsearch':query='';render();break;
    case 'filter':if(['today','upcoming','requests','open','done','archived'].includes(d.filter)){filter=d.filter;render();}break;
    case 'upcoming':filter='upcoming';navigate('tasks');break;
    case 'edit':edit(id,i);break;
    case 'taskmenu':menu(id);break;
    case 'complete':completeTask(id);break;
    case 'reopen':
      if(!f||f.t.request||f.t.status!=='done')return;
      f.t.status='open';delete f.t.completed;delete f.t.completedDay;close();refresh();toast('Reopened, with the focus time you earned.');break;
    case 'restore-task':
      if(!f||f.t.status!=='archived')return;
      f.t.status=f.t.completed&&f.t.completedDay?'done':'open';close();refresh();toast('Task restored.');break;
    case 'archive':
      if(!f||f.t.request||f.t.status==='archived')return;
      undo={kind:'status',owner:f.owner,afterStatus:'archived',snapshot:undoSnapshot(f.t)};
      if(f.owner<2&&s.people[f.owner].timer?.task===id){settle(s.people[f.owner]);s.people[f.owner].timer=null;}
      if(s.togetherTimer?.task===id)endTogether(s);
      f.t.status='archived';close();refresh();toast('Tucked away. Completed wins are still remembered.',true);break;
    case 'delete':deleteTask(id);break;
    case 'confirm-delete':removeTask(id);break;
    case 'undo':performUndo();break;
    case 'help':
      if(!f||(f.owner!==s.active&&f.owner!==2)||f.t.status!=='open'||f.t.request)return;
      f.t.help=f.owner===2?false:!f.t.help;if(!f.t.help)f.t.helper=null;close();refresh();toast(f.t.help?'A little help request is on your teamwork board.':'Help request cleared.');break;
    case 'offer':
      if(!f||f.owner===s.active||f.owner>1||!f.t.help||f.t.status!=='open'||f.t.request)return;
      f.t.helper=f.t.helper===s.active?null:s.active;close();refresh();toast(f.t.helper===s.active?'Your partner can see you’re available to help.':'Your offer is withdrawn. It’s okay to need your own space.');break;
    case 'takeover':
      if(!f||f.owner===s.active||f.owner>1||!f.t.help||f.t.status!=='open'||f.t.request)return;
      if(requestMove(s,id,s.active)){close();refresh();toast('On your list now. The time already spent is kept.');}break;
    case 'assign':
      if(!requestMove(s,id,i))return error('This task cannot be moved right now.');
      close();refresh();toast(i===2?'A little plan for both of you.':i===s.active?'Moved to your list.':connected()?'Request ready to sync to your partner.':'Request sent to your partner’s side of this device.');break;
    case 'accept':
      if(!respond(s,id,s.active))return error('Switch to the person receiving this request first.');
      close();refresh();toast('You’ve got this. The task is on your list.');break;
    case 'request-date':requestDate(id);break;
    case 'decline':case 'cancel-request':
      if(!f?.t.request||(a==='decline'?f.t.request.to:f.t.request.from)!==s.active)return;
      if(rejectRequest(s,id,s.active)){close();refresh();toast('Returned to the list it came from. No pressure.');}break;
    case 'starttask':case 'just':
      if(!f)return;if(f.owner===2)togetherSetup(id);else start(f.owner,id,a==='just'?5:null);break;
    case 'start-early':start(i,id,minutes,d.outside==='1',true);break;
    case 'outside-start':start(i,id,minutes,true,d.early==='1');break;
    case 'resume-outside':resumePersonal(i,true);break;
    case 'focus':
      if(i>1)return;
      if(s.people[i].timer?.running){if(connected())runCloudFocus({action:'pause',owner:i});else{settle(s.people[i]);refresh();}}
      else if(s.people[i].timer)resumePersonal(i);
      else{const task=current(i);if(task)start(i,task.id);}
      break;
    case 'endtimer':if(i<2)endtimer(i);break;
    case 'skipbreak':if(i<2){if(connected())runCloudFocus({action:'skip-break',owner:i});else{s.people[i].restUntil=null;refresh();}}break;
    case 'together-start':togetherSetup(id);break;
    case 'shared-early':startShared(id,minutes,d.outside==='1',true);break;
    case 'shared-outside':startShared(id,minutes,true,d.early==='1');break;
    case 'shared-resume-outside':resumeShared(true);break;
    case 'together-toggle':
      if(!s.togetherTimer)return;
      if(s.togetherTimer.running){if(connected())runCloudFocus({action:'pause',owner:2});else{pauseTogether(s);refresh();}}else resumeShared();break;
    case 'together-end':
      if(!s.togetherTimer)return;if(connected()){runCloudFocus({action:'end',owner:2});break;}endTogether(s);close();refresh();toast('Your shared time is saved. The task stays open.');break;
    case 'schedule':if(i<2)schedule(i);break;
    case 'appointment':if(i<2)appointment(i);break;
    case 'editappt':if(i<2)appointment(i,id);break;
    case 'removeappt':
      if(i>1)return;
      if(s.people[i].appointments.some(x=>x.id===id))modal(`<h2>Remove this protected time?</h2><p>Your plan will have room to use this time again.</p><div class="form-actions"><button data-a="close">Keep it</button><button class="danger-button" data-a="confirm-removeappt" data-id="${esc(id)}" data-owner="${i}">Remove appointment</button></div>`);break;
    case 'confirm-removeappt':if(i<2){s.people[i].appointments=s.people[i].appointments.filter(x=>x.id!==id);refresh();schedule(i);}break;
    case 'replan':if(i<2){refresh();schedule(i);}break;
    case 'replan-inline':refresh();toast('Your plan is refreshed around the time you have.');break;
    case 'routines':if(i<2)routineList(i);break;
    case 'editroutine':if(i<2)routineEdit(i,id);break;
    case 'routine':{
      if(i>1)return;const routine=s.people[i].routines.find(x=>x.id===id);if(!routine)return;
      routine.paused=!routine.paused;refresh();routineList(i);break;
    }
    case 'remove-routine':
      if(i>1||!s.people[i].routines.some(x=>x.id===id))return;
      modal(`<h2>Stop this repeating plan?</h2><p>Tasks already on your list stay there. Future occurrences will stop.</p><div class="form-actions"><button data-a="close">Keep routine</button><button class="danger-button" data-a="confirm-remove-routine" data-id="${esc(id)}" data-owner="${i}">Remove routine</button></div>`);break;
    case 'confirm-remove-routine':if(i<2){s.people[i].routines=s.people[i].routines.filter(x=>x.id!==id);refresh();routineList(i);}break;
    case 'note':note();break;
    case 'notes':noteList();break;
    case 'editnote':note(id);break;
    case 'note-prompt':if($('#note-text')){$('#note-text').value=d.text||'';$('#note-text').focus?.();}break;
    case 'pin':
      if(!wallNotes(s).some(x=>x.id===id))return;s.pinnedNote=s.pinnedNote===id?null:id;save();render();noteList();break;
    case 'deletenote':
      if(!wallNotes(s).some(x=>x.id===id&&x.from===s.active))return;
      modal(`<h2>Remove this little note?</h2><p>${connected()?'This deletes the note from your shared collection.':'This deletes the note from your collection on this device.'}</p><div class="form-actions"><button data-a="notes">Keep note</button><button class="danger-button" data-a="confirm-deletenote" data-id="${esc(id)}">Delete note</button></div>`);break;
    case 'confirm-deletenote':
      if(!wallNotes(s).some(x=>x.id===id&&x.from===s.active))return;
      s.notes=s.notes.filter(x=>x.id!==id);if(s.pinnedNote===id)s.pinnedNote=null;save();render();noteList();break;
    case 'export':exportBackup();break;
    case 'restore':$('#restore').click?.();break;
  }
});

document.addEventListener('input',e=>{if(e.target?.id==='message-text'){mailDrafts[s.active]=String(e.target.value||'').slice(0,BODY_LIMIT);persistMailDrafts();}});

document.addEventListener('change',e=>{
  const input=e.target;if(!input.matches?.('[data-step]')||broken)return;
  const f=locate(s,input.dataset.id),index=Number(input.dataset.step);
  if(!f||f.t.status!=='open'||f.t.request||!Number.isInteger(index)||!f.t.steps[index])return;
  if(!canEditOwner(f.owner)){input.checked=f.t.steps[index].done;return error('Your partner manages their own checklist.');}
  f.t.steps[index].done=!!input.checked;save();render();
});
document.addEventListener('toggle',e=>{
  if(!e.target.matches?.('.timeline-disclosure'))return;
  const i=Number(e.target.dataset.owner);if(e.target.open)expandedPlans.add(i);else expandedPlans.delete(i);
},true);

$('#restore').onchange=async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
    if(file.size>10*1024*1024)throw Error('This file is too large. Choose a backup under 10 MB.');
    let value;try{value=JSON.parse(await file.text());}catch{throw Error('That file is not readable JSON. Choose an Us, Together backup.');}
    if(!validCouple(value))throw Error('This is not a valid Us, Together backup. Your current space is unchanged.');
    if(!confirm(connected()?'Restore this backup for BOTH of you? This replaces shared tasks, notes, and settings. The current shared version is backed up automatically.':'Replace this browser’s current couple space with the backup? Export your current data first if you want to keep it.'))return;
    if(connected()){await cloud.restore({state:value});undo=null;close();toast('Shared backup restored for both of you. Timers are paused.');return;}
    value.people.forEach(p=>{if(p.timer)settle(p);});if(value.togetherTimer)settleTogether(value);
    planSpace(value);if(!validCouple(value))throw Error('The backup could not be prepared. Your current space is unchanged.');
    s=value;mobile=s.active;broken=false;undo=null;close();refresh();toast('Backup restored. Saved timers are paused until you’re ready.');
  }catch(err){error(err.message||'That backup could not be restored. Your current space is unchanged.');}
  finally{e.target.value='';}
};

function chime(){
  if(!s.sound)return;
  try{const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;const ctx=new Audio(),osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='sine';osc.frequency.value=660;gain.gain.setValueAtTime(.08,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.7);osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.7);osc.onended=()=>ctx.close();}catch{/* Sound may be unavailable under the browser's audio policy. */}
}
function tick(){
  if(broken)return;const now=appNow();let changed=false,ended=false;
  if(connected()){
    const timers=[...s.people.map(p=>p.timer),s.togetherTimer];
    const expired=timers.some(t=>t?.running&&remaining(t,now)<=0)||s.people.some(p=>p.restUntil&&p.restUntil<=now);
    s.people.forEach((p,i)=>{
      const clock=$(`[data-timer="${i}"]`),rest=$(`[data-rest="${i}"]`),ring=$(`[data-ring="${i}"]`);
      if(clock&&p.timer)clock.textContent=fmt(remaining(p.timer,now));
      if(rest&&p.restUntil)rest.textContent=fmt(Math.max(0,p.restUntil-now));
      if(ring&&p.timer)ring.style?.setProperty('--progress',String(Math.min(100,Math.max(0,(1-remaining(p.timer,now)/(p.timer.total||p.timer.remaining||1))*100))));
    });
    if(s.togetherTimer){const t=s.togetherTimer,clock=$('[data-together-timer]'),ring=$('[data-ring="together"]');if(clock)clock.textContent=fmt(remaining(t,now));ring?.style?.setProperty('--progress',String(Math.min(100,Math.max(0,(1-remaining(t,now)/(t.total||t.remaining||1))*100))));}
    if(expired&&now-cloudExpiryPull>=5000){cloudExpiryPull=now;cloud.pull().catch(()=>{});}
    const date=day(new Date(now)),editing=document.activeElement?.matches?.('input,textarea,select');
    if(date!==lastDay||(now-lastPlan>=60000&&!editing&&!$('#dialog').open)){lastDay=date;refresh(false);}
    return;
  }
  if(s.togetherTimer?.running&&remaining(s.togetherTimer,now)<=0){
    const end=s.togetherTimer.started+s.togetherTimer.remaining;settleTogether(s,end);s.togetherTimer=null;
    s.people.forEach(p=>p.restUntil=end+p.settings.break*60000);changed=true;ended=true;
    toast('Your shared focus is complete. Take a little breath together.');
  }
  s.people.forEach((p,i)=>{
    if(p.timer?.running&&remaining(p.timer,now)<=0){const end=p.timer.started+p.timer.remaining;settle(p,end);p.timer=null;p.restUntil=end+p.settings.break*60000;changed=true;ended=true;toast(`${name(i)}, your focus session is done. A little reset?`);}
    if(p.restUntil&&p.restUntil<=now){p.restUntil=null;changed=true;}
    const clock=$(`[data-timer="${i}"]`),rest=$(`[data-rest="${i}"]`),ring=$(`[data-ring="${i}"]`);
    if(clock&&p.timer)clock.textContent=fmt(remaining(p.timer,now));
    if(rest&&p.restUntil)rest.textContent=fmt(p.restUntil-now);
    if(ring&&p.timer)ring.style?.setProperty('--progress',String(Math.min(100,Math.max(0,(1-remaining(p.timer,now)/(p.timer.total||p.timer.remaining||1))*100))));
  });
  const timer=s.togetherTimer;
  if(timer){const clock=$('[data-together-timer]'),ring=$('[data-ring="together"]');if(clock)clock.textContent=fmt(remaining(timer,now));ring?.style?.setProperty('--progress',String(Math.min(100,Math.max(0,(1-remaining(timer,now)/(timer.total||timer.remaining||1))*100))));}
  if(ended)chime();
  const date=day(new Date(now)),editing=document.activeElement?.matches?.('input,textarea,select');
  if(changed||date!==lastDay||(now-lastPlan>=60000&&!editing&&!$('#dialog').open)){lastDay=date;refresh();}
}
window.addEventListener('storage',e=>{
  if(connected())return;
  if(e.key!==KEY||!e.newValue||broken)return;
  try{const value=JSON.parse(e.newValue);if(!validCouple(value))return;s=value;mobile=s.active;undo=null;planSpace(s);render();}catch{/* Ignore an incomplete update without overwriting this space. */}
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
if(!s.setup&&s.names[0]==='Your nickname'&&s.names[1]==='Their nickname')s.names=['You','Your person'];
refresh(false);tick();setInterval(tick,1000);
cloud.start().catch(()=>{});
const invited=cloudUI.handleInviteLink();
if(!invited&&!connected()&&!s.setup&&!broken)welcome();
if(typeof navigator!=='undefined'&&'serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
