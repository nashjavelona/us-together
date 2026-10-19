import {backupSnapshot} from './ui-model.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>JSON.parse(JSON.stringify(value));
const countTasks=s=>s.people.reduce((n,p)=>n+p.tasks.length,0)+s.shared.length;

export function downloadJSON(value,filename){
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;
  document.body?.appendChild?.(anchor);anchor.click();anchor.remove?.();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function invitationCode(value){
  const text=String(value||'').trim();
  if(/^https?:\/\//i.test(text)){
    try{return new URLSearchParams(new URL(text).hash.slice(1)).get('join')||'';}catch{return '';}
  }
  return text;
}

export function parseRecovery(value){
  let data;
  try{data=typeof value==='string'?JSON.parse(value):value;}catch{throw Error('Choose the recovery file you saved when connecting this device.');}
  if(!data||data.type!=='us-together-recovery'||data.version!==1||typeof data.spaceId!=='string'||!data.spaceId.length||data.spaceId.length>150||![0,1].includes(data.role)||typeof data.recoveryKey!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(data.recoveryKey))throw Error('This is not a valid Us, Together recovery file. A task backup is a different file.');
  return {spaceId:data.spaceId,role:data.role,recoveryKey:data.recoveryKey};
}

export function createCloudUI({cloud,getState,modal,close,error,toast,render,exportBackup,apiBase}){
  const $=selector=>document.querySelector(selector);
  let busy=false,screen=0,inviteValue='',preview=null;
  const name=role=>getState().names[role];
  const connection=()=>cloud.connection;
  const status=()=>cloud.status||{kind:'local',message:'Saved on this device'};
  const button=(action,text,classes='')=>`<button type="button" data-cloud="${action}" class="${classes}">${text}</button>`;
  const actions=items=>`<div class="form-actions">${items}</div>`;
  const show=html=>{screen++;modal(html);};
  const date=value=>new Date(value).toLocaleString([],{dateStyle:'medium',timeStyle:'short'});
  const taskSummary=s=>`${countTasks(s)} task${countTasks(s)===1?'':'s'}, ${s.notes.length} note${s.notes.length===1?'':'s'}`;
  function pendingHelp(){
    const pending=cloud.pendingConnection?.();
    if(!pending)return '';
    const label=({spaces:'creating a space',join:'joining your partner',recover:'reconnecting a device'})[pending.type]||'connecting';
    return `<section class="pending-connection-help" aria-label="Unfinished connection"><strong>An earlier connection needs attention.</strong><p>You started ${esc(label)} as ${esc(pending.deviceName)}. You can safely check whether it already connected, retry it, or start over. Your tasks will not be deleted.</p><div class="button-row">${button('pending-retry','Retry earlier attempt')}${button('pending-reset','Resolve earlier attempt','btn-rose')}</div></section>`;
  }

  function statusChanged(){
    const region=$('#cloud-banner');
    if(region)region.innerHTML=bannerContents();
    const detail=$('#connection-live-status');if(detail)detail.textContent=status().message;
  }
  function bannerContents(){
    const state=status(),c=connection();
    if(!c)return `<span class="connection-symbol" aria-hidden="true">♡</span><div><strong>One little space. Both your phones.</strong><p>Your plans are saved here. Connect your devices when you’re ready to share.</p></div>${button('open','Connect us ↗','btn-rose')}`;
    const attention=['conflict','error','revoked'].includes(state.kind);
    const heading=attention?'Your shared space needs a little attention':state.kind==='offline'?'Your changes are safe on this device':c.partnerJoined?'Together, wherever you are.':'Your space is ready for your person.';
    return `<span class="connection-symbol" aria-hidden="true">${attention?'!':'♡'}</span><div><strong>${heading}</strong><p>${esc(state.message||'Connecting…')}${c.zone?` · Our day follows ${esc(c.zone.replaceAll('_',' '))}.`:''}</p></div>${button(state.kind==='conflict'?'conflicts':'open',state.kind==='conflict'?'Review changes':!c.partnerJoined?'Invite your person':'Connection','btn-rose')}`;
  }
  function bannerHTML(){return `<section id="cloud-banner" class="connection-banner" aria-label="Shared space connection">${bannerContents()}</section>`;}
  function settingsHTML(){
    return `<h3>${connection()?'Your private shared space':'Use together on two devices'}</h3><p class="field-help">${connection()?`This device is connected as ${esc(name(connection().role))}. Tasks update on both devices when online.`:'Connect once with an invitation. Your device remembers you, with no everyday sign-in screen.'}</p><div class="button-row">${button('open',connection()?'Connection & recovery':'Connect our space','btn-rose')}${connection()?button('history','Automatic backups'):''}</div><h3>A copy to keep</h3><p class="field-help">Task backups contain your plans and notes. Your separate recovery file reconnects your identity on a new device.</p><div class="button-row"><button type="button" data-a="export">Export task backup</button><button type="button" data-a="restore">Restore task backup</button></div>`;
  }
  async function work(job,form=null){
    if(busy)return;busy=true;
    const buttons=[...(form?.querySelectorAll?.('button')||[])];
    buttons.forEach(b=>b.disabled=true);
    try{return await job();}
    catch(err){error(err.message||'We couldn’t finish that connection. Your current tasks are still here.');}
    finally{busy=false;buttons.forEach(b=>b.disabled=false);}
  }
  function preserveLocal(){
    const s=getState();
    if(!countTasks(s)&&!s.notes.length&&!s.people.some(p=>p.routines.length||p.appointments.length||p.sessions.length))return;
    const backup=backupSnapshot(s);
    try{localStorage.setItem('us-together.before-connection.v1',JSON.stringify(backup));}
    catch{throw Error('This browser has no room for the safety copy. Export a task backup in Settings before freeing space and connecting.');}
    downloadJSON(backup,`us-together-before-connecting-${new Date().toISOString().slice(0,10)}.json`);
  }
  function open(){
    if(!connection()){
      show(`<div class="eyebrow">SAME TEAM. WHEREVER YOU ARE.</div><h2>Bring your two little worlds together.</h2><p>Keep your charcoal and pink spaces connected, with a private invitation and your own device identity.</p>${pendingHelp()}<div class="connect-options">${button('create','<strong>Create our shared space</strong><span>Bring the tasks already on this device.</span>','connect-option')}${button('join','<strong>I have an invitation</strong><span>For your PARTNER only. Joining claims the other person’s profile.</span>','connect-option')}${button('recover','<strong>Reconnect my device</strong><span>For YOUR second phone, laptop, or replacement device.</span>','connect-option')}</div><p class="field-help"><strong>Already use Us, Together on another device?</strong> Select Reconnect my device, not I have an invitation. Your personal recovery file is different from the one-time partner invitation.</p><p class="field-help">You can also keep using this device on its own. Export a backup before clearing browser data.</p>${actions(button('close','Keep using this device'))}`);
      return;
    }
    const c=connection();
    show(`<div class="eyebrow">ONE PRIVATE SPACE FOR TWO</div><h2>Connected as ${esc(name(c.role))}.</h2><p id="connection-live-status" role="status">${esc(status().message)}</p><div class="connection-detail"><span>Your side</span><strong>${c.role?'♡ Pink':'◒ Charcoal'}</strong><span>Our shared day</span><strong>${esc(c.zone||'Your timezone')}</strong><span>Saved together</span><strong>${taskSummary(getState())}</strong></div><div class="dialog-list">${!c.partnerJoined?button('invite','Invite your person ♡','btn-rose'):''}${button('recovery-download','Save my recovery file')}${button('devices','My connected devices')}${button('history','Automatic backups')}${status().kind==='conflict'?button('conflicts','Review conflicting changes'):''}${button('retry','Sync now')}${button('disconnect','Disconnect this device…','danger-button')}${button('close','Done')}</div><p class="field-help">Both members can see this couple space. Your personal editing controls belong to your own device identity.</p>`);
  }
  function create(){
    if(connection())return open();
    const s=getState(),zone=Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Manila';
    const zones=[...new Set([zone,'Asia/Manila','UTC'])];
    show(`<form id="cloud-create-form"><div class="eyebrow">MAKE ROOM FOR BOTH OF YOU</div><h2>Create your shared space.</h2><p>Bring ${taskSummary(s)} from this device. A safety copy downloads before connecting; active timers will pause.</p><label>This device belongs to<select name="role">${[0,1].map(i=>`<option value="${i}" ${i===s.active?'selected':''}>${i?'♡ Pink':'◒ Charcoal'} · ${esc(s.names[i])}</option>`).join('')}</select></label><label>Name this device<input name="deviceName" maxlength="60" required value="My device" autocomplete="off"></label><label>Our day follows<select name="zone">${zones.map(z=>`<option value="${esc(z)}">${esc(z.replaceAll('_',' '))}</option>`).join('')}</select></label><p class="field-help">Both phones use this timezone for tasks and focus history.</p>${actions(button('open','Back')+'<button class="btn-rose">Create our shared space ♡</button>')}</form>`);
    $('#cloud-create-form').onsubmit=e=>{e.preventDefault();const form=e.target,f=new FormData(form);return work(async()=>{
      preserveLocal();await cloud.create({state:clone(getState()),role:Number(f.get('role')),zone:String(f.get('zone')),deviceName:String(f.get('deviceName')||'My device').trim()});ready();
    },form);};
  }
  function join(prefill=''){
    if(connection())return open();
    show(`<form id="cloud-join-form"><div class="eyebrow">YOUR PERSON MADE ROOM FOR YOU</div><h2>Join your shared space.</h2><p class="field-help"><strong>This is for your partner, not your second device.</strong> If you already use the charcoal or pink profile on another phone or computer, go Back and choose Reconnect my device using your personal recovery file.</p><label>Invitation link or code<textarea name="invite" required maxlength="2048" rows="3" autocomplete="off" spellcheck="false" placeholder="Paste your partner’s invitation">${esc(prefill)}</textarea></label><label>Name this device<input name="deviceName" maxlength="60" required value="My device" autocomplete="off"></label><p class="field-help">This opens your partner’s shared space. The current ${taskSummary(getState())} stay in a separate safety backup; they are not mixed into the invitation’s space. Active timers pause.</p>${actions(button('open','Back')+'<button class="btn-rose">Join my person ♡</button>')}</form>`);
    $('#cloud-join-form').onsubmit=e=>{e.preventDefault();const form=e.target,f=new FormData(form);return work(async()=>{
      const invite=invitationCode(f.get('invite'));if(!invite)throw Error('Paste a complete invitation link or code.');
      preserveLocal();await cloud.join({invite,deviceName:String(f.get('deviceName')||'My device').trim()});ready();
    },form);};
  }
  function ready(){
    render();
    show(`<div class="connection-success" aria-hidden="true">♡</div><div class="eyebrow">A LITTLE CLOSER, ALREADY</div><h2>You’re connected, ${esc(name(connection().role))}.</h2><p>Your tasks now have a shared home. Save your personal recovery file so you can reconnect if you change phones or clear browser data.</p><p class="field-help">Keep this file somewhere private. It grants access as you and is separate from a task backup.</p><div class="dialog-list">${button('recovery-download','Download my recovery file','btn-rose')}${!connection().partnerJoined?button('invite','Create an invitation for my person'):''}${button('close','Go to our space')}</div>`);
  }
  function recoveryDownload(){
    const data=cloud.recoveryDetails();
    if(!data?.recoveryKey)return error('The recovery key is not stored on this device. Use the recovery file you saved when you first connected.');
    downloadJSON({type:'us-together-recovery',version:1,spaceId:data.spaceId||connection().spaceId,role:data.role??connection().role,recoveryKey:data.recoveryKey,service:apiBase,createdAt:new Date().toISOString()},`us-together-my-${connection().role?'pink':'charcoal'}-recovery.json`);
    toast('Your personal recovery file is ready. Keep it private.');
  }
  function recover(){
    if(connection())return open();
    show(`<form id="cloud-recover-form"><div class="eyebrow">WELCOME BACK TO YOUR LITTLE SPACE</div><h2>Reconnect as you.</h2><p class="field-help">Use this when you have a second phone or laptop but want the <strong>same</strong> charcoal or pink identity. Use your personal recovery JSON file—not a partner invitation code or a task backup.</p>${pendingHelp()}<label>Your recovery file<input id="cloud-recovery-file" type="file" accept="application/json,.json"></label><label>Or paste its contents<textarea name="recovery" required rows="4" maxlength="16000" spellcheck="false" autocomplete="off" placeholder="Paste your saved recovery file here"></textarea></label><label>Name this device<input name="deviceName" required maxlength="60" value="My new device"></label><p class="field-help">A task backup cannot prove your identity. Use your own recovery file; your partner’s file connects as them.</p>${actions(button('open','Back')+'<button class="btn-rose">Reconnect my space</button>')}</form>`);
    const form=$('#cloud-recover-form');
    $('#cloud-recovery-file').onchange=async e=>{
      const file=e.target.files?.[0];if(!file)return;
      try{if(file.size>16000)throw Error('Choose the small recovery file, not a task backup.');const text=await file.text();parseRecovery(text);form.elements.recovery.value=text;}catch(err){form.elements.recovery.value='';e.target.value='';error(err.message);}
    };
    form.onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);return work(async()=>{
      const recovery=parseRecovery(String(f.get('recovery')||''));preserveLocal();await cloud.recover({...recovery,deviceName:String(f.get('deviceName')||'My new device').trim()});ready();
    },e.target);};
  }
  async function invite(){
    const token=screen;
    const result=await cloud.invite();if(screen!==token)return;
    const base=typeof location!=='undefined'?`${location.origin}${location.pathname}`:apiBase.replace(/\/api$/,'/');
    inviteValue=`${base}#join=${encodeURIComponent(result.invite)}`;
    show(`<div class="eyebrow">A PRIVATE INVITATION FOR YOUR PERSON</div><h2>There’s a space beside you.</h2><p>Send this link to your partner yourself. It can be used once and expires ${esc(date(result.expiresAt))}.</p><label>Your invitation<textarea id="cloud-invite-link" rows="4" readonly spellcheck="false">${esc(inviteValue)}</textarea></label><p class="field-help">Only share it with your partner. Creating another invitation replaces this one.</p>${actions(button('open','Back')+button('invite-copy','Copy invitation','btn-rose'))}`);
  }
  async function history(){
    const token=screen,result=await cloud.history();if(screen!==token)return;
    const items=result.snapshots||[];
    show(`<div class="eyebrow">A LITTLE ROOM TO GO BACK</div><h2>Your automatic backups.</h2><p>The last 50 saved snapshots are kept as your space changes. Restoring one creates another backup of the current space.</p><div class="snapshot-list">${items.map(item=>`<button type="button" data-cloud="snapshot" data-id="${esc(item.id)}" class="snapshot-row"><span><strong>${esc(date(item.createdAt))}</strong><small>${esc(item.reason||'Saved change')} · ${Number(item.taskCount)||0} tasks</small></span><span>Preview ↗</span></button>`).join('')||'<p class="field-help">Your first backup appears after the next saved change.</p>'}</div>${actions(button('open','Back')+button('export','Export a task backup'))}`);
  }
  async function snapshot(id){
    const token=screen,result=await cloud.snapshot(id);if(screen!==token)return;
    preview=result.snapshot;
    const state=preview.state,counts=[0,1,2].map(i=>i===2?state.shared.length:state.people[i].tasks.length);
    show(`<div class="eyebrow">LOOK BEFORE YOU RESTORE</div><h2>Your space on ${esc(date(preview.createdAt))}.</h2><div class="connection-detail">${[0,1,2].map(i=>`<span>${esc(i===2?'Both of us':state.names[i])}</span><strong>${counts[i]} tasks</strong>`).join('')}<span>Love notes</span><strong>${state.notes.length}</strong></div><p>This replaces the tasks, notes and settings for <strong>both of you</strong>. A backup of your current space is saved first. Timers return paused; your device connections stay connected.</p>${actions(button('history','Keep current space')+button('snapshot-download','Download this copy')+button('snapshot-restore','Restore for both of us','btn-rose'))}`);
  }
  async function devices(){
    const token=screen,result=await cloud.devices();if(screen!==token)return;
    show(`<div class="eyebrow">THE DEVICES THAT KNOW IT’S YOU</div><h2>Your connected devices.</h2><p>You can remove access from your own old or lost device. Your partner manages theirs.</p><div class="snapshot-list">${(result.devices||[]).map(d=>`<div class="device-row"><div><strong>${esc(d.name||'My device')}${d.current?' · this device':''}</strong><small>Connected ${esc(date(d.createdAt))}</small></div><button type="button" class="danger-button" data-cloud="device-confirm" data-id="${esc(d.id)}" data-current="${d.current?'1':'0'}">Remove access…</button></div>`).join('')}</div>${actions(button('open','Back'))}`);
  }
  function conflicts(){
    const list=status().conflicts||[];
    const rejected=list.find(item=>item.kind==='save-rejected');
    if(rejected){
      show(`<div class="eyebrow">YOUR EDITS ARE STILL ON THIS DEVICE</div><h2>The server declined a save.</h2><p>${esc(rejected.reason||'The shared space could not accept this change.')}</p><p>Automatic retries are paused so this error cannot loop. Export your current copy before discarding this rejected save. Any newer queued edits will be preserved and retried separately.</p>${actions(button('export','Export this device’s copy')+button('rejected-discard','Discard rejected save','danger-button')+button('close','Decide later'))}`);
      return;
    }
    show(`<div class="eyebrow">TWO CHANGES NEED A LITTLE CHOICE</div><h2>Let’s keep the right version.</h2><p>Your edits are still saved on this device. Some of the same records changed in the shared space.</p><ul class="conflict-list">${list.map(c=>`<li><strong>${esc(c.label||c.path||'A shared record')}</strong><div class="conflict-versions"><div><small>This device</small><pre>${esc(JSON.stringify(c.local??c.localValue??'(removed)',null,2)).slice(0,3500)}</pre></div><div><small>Shared space</small><pre>${esc(JSON.stringify(c.remote??c.remoteValue??'(removed)',null,2)).slice(0,3500)}</pre></div></div></li>`).join('')||'<li>Open the connection again after the current sync finishes.</li>'}</ul><p class="field-help">Independent changes are kept. Your choice applies to the conflicting records shown here. Export this device’s copy first if you want to keep both versions.</p>${actions(button('export','Export this device’s copy')+button('conflicts-remote','Use shared versions')+button('conflicts-local','Keep my versions','btn-rose')+button('close','Decide later'))}`);
  }
  function disconnect(){
    show(`<div class="eyebrow">YOUR SPACE WILL STILL BE THERE</div><h2>Disconnect this device?</h2><p>${status().pending?'Some changes have NOT reached the server. Export a task backup before disconnecting: reconnecting does not automatically merge these unsent changes.':'A copy of the tasks stays on this browser.'} This device will stop receiving shared updates. Your partner’s access stays connected.</p><p class="field-help">Keep your personal recovery file to reconnect. A task backup is different and does not reconnect your identity. Never upload either file to GitHub.</p>${actions(button('open','Stay connected')+button('recovery-download','Save recovery file')+button('disconnect-confirm','Export copy & disconnect','danger-button'))}`);
  }
  function handleInviteLink(){
    if(typeof location==='undefined'||!location.hash?.startsWith('#join='))return false;
    const code=new URLSearchParams(location.hash.slice(1)).get('join');
    globalThis.history?.replaceState?.(null,'',location.pathname+location.search);
    if(code)join(code);return !!code;
  }
  document.addEventListener('click',e=>{
    const target=e.target.closest?.('[data-cloud]');if(!target?.dataset.cloud)return;
    e.preventDefault?.();const action=target.dataset.cloud;
    if(busy&&!['close'].includes(action))return;
    switch(action){
      case 'open':open();break;
      case 'close':screen++;close();break;
      case 'create':create();break;
      case 'join':join();break;
      case 'recover':recover();break;
      case 'pending-retry':work(async()=>{const result=await cloud.retryPending();if(result.outcome==='connected')ready();else open();});break;
      case 'pending-reset':show(`<div class="eyebrow">A SAFE FRESH START</div><h2>Check the unfinished connection?</h2><p>We’ll first ask the server whether that earlier attempt already connected. If it did, we’ll reopen that same space. Otherwise, we’ll clear only the unfinished connection, not your tasks.</p><p class="field-help">If you are offline, we will keep the attempt rather than risk losing access to a space it created. As a last resort, you may deliberately forget the unfinished attempt, but you could lose access to an already-created new space.</p>${actions(button('open','Keep it')+button('pending-reset-confirm','Check &amp; resolve','btn-rose')+button('pending-force-warning','Advanced: forget unfinished attempt'))}`);break;
      case 'pending-reset-confirm':work(async()=>{const result=await cloud.resetPending();if(result.outcome==='connected')ready();else{open();toast('Your unfinished connection is cleared. Your tasks are still here.');}});break;
      case 'pending-force-warning':show(`<div class="eyebrow">ADVANCED RECOVERY ONLY</div><h2>Forget the unfinished attempt on this browser?</h2><p>If the earlier request succeeded on the server but its response was lost, <strong>forgetting it could permanently lose access to that new space</strong> unless you have its personal recovery file. This does not fix an active server rate limit.</p><p>Your locally saved tasks and notes will stay here. Use <strong>Check &amp; resolve</strong> first whenever the server is reachable. Never use this action to disconnect an already connected device.</p>${actions(button('pending-reset','Back to safer option')+button('pending-force-confirm','I understand — forget unfinished attempt','danger-button'))}`);break;
      case 'pending-force-confirm':work(async()=>{const result=await cloud.forgetPending();open();toast(result.outcome==='cleared'?'Unfinished attempt forgotten. Your local tasks remain.':'There was no unfinished attempt to forget.');});break;
      case 'recovery-download':recoveryDownload();break;
      case 'invite':work(invite);break;
      case 'invite-copy':work(async()=>{if(globalThis.navigator?.clipboard?.writeText){await navigator.clipboard.writeText(inviteValue);toast('Invitation copied. Share it with your person.');}else{$('#cloud-invite-link')?.select?.();toast('Select and copy the invitation above.');}});break;
      case 'history':work(history);break;
      case 'snapshot':work(()=>snapshot(target.dataset.id));break;
      case 'snapshot-download':if(preview)downloadJSON(preview.state,`us-together-backup-${preview.revision}.json`);break;
      case 'snapshot-restore':work(async()=>{if(!preview)return;await cloud.restore({snapshotId:preview.id});close();toast('Your shared space is restored. Timers are paused.');});break;
      case 'devices':work(devices);break;
      case 'device-confirm':show(`<h2>Remove this device’s access?</h2><p>It will need your personal recovery file to reconnect. Its downloaded files and local task copies are not erased.</p>${actions(button('devices','Keep access')+`<button type="button" class="danger-button" data-cloud="device-revoke" data-id="${esc(target.dataset.id)}" data-current="${esc(target.dataset.current)}">Remove access</button>`)}`);break;
      case 'device-revoke':work(async()=>{await cloud.revoke(target.dataset.id);if(target.dataset.current==='1'){cloud.disconnect();render();open();}else await devices();});break;
      case 'retry':work(async()=>{await cloud.flush();await cloud.pull();statusChanged();toast('Your connection has been checked.');});break;
      case 'conflicts':conflicts();break;
      case 'rejected-discard':work(async()=>{await cloud.discardRejected();close();render();toast('Rejected save discarded. Newer edits remain queued for sync.');});break;
      case 'conflicts-remote':case 'conflicts-local':work(async()=>{await cloud.resolveConflicts(action==='conflicts-local'?'local':'remote');close();render();});break;
      case 'export':exportBackup();break;
      case 'disconnect':disconnect();break;
      case 'disconnect-confirm':exportBackup();cloud.disconnect();render();open();break;
    }
  });
  return {open,bannerHTML,settingsHTML,statusChanged,handleInviteLink};
}
