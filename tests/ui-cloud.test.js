import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as eventLoopTurn} from 'node:timers/promises';
import {createCloudSync} from '../cloud-sync.js';
import {API_BASE} from '../cloud-config.js';
import {getCalendarZone,setCalendarZone} from '../core.js';
import {validCouple} from '../couple.js';
import {parseRecovery} from '../cloud-ui.js';
import {MemoryStorage,syncService,sampleState,sampleTask} from './sync-fixture.js';

const KEY='us-together.v2',minute=60000;
let imports=0;

function fixture(){
  const state=sampleState();state.names=['Black','Pink'];
  state.people.forEach(person=>{person.settings.start='00:00';person.settings.end='23:59';});
  state.people[0].tasks.push(sampleTask('black-task','My original plan'));
  state.people[1].tasks.push(sampleTask('pink-task','My partner’s plan'));
  state.shared.push(sampleTask('shared-task','A plan for both of us'));
  state.people[0].appointments.push({id:'appointment-one',title:'Dinner',date:'2026-10-18',start:'18:00',end:'19:00'});
  state.people[0].routines.push({...sampleTask('routine-one','Read a little'),repeat:'daily',days:[],from:'2026-10-18',paused:true});
  state.notes.push({id:'note-one',from:0,text:'An original little note',date:'2026-10-18T01:00:00.000Z'});
  return state;
}

// The real app, sync bridge and API run against an in-memory SQLite D1 adapter.
// This small DOM/event stub verifies handlers and durable state, not browser
// rendering, native form validation, service-worker installation or layout.
async function withUI(options,run){
  const service=syncService(),storage=new MemoryStorage(),elements=new Map();
  const documentListeners=new Map(),windowListeners=new Map(),timeouts=new Map(),intervals=new Map();
  const names=['document','window','localStorage','FormData','setInterval','clearInterval','setTimeout','clearTimeout','confirm','Date','fetch','location','history','navigator'];
  const originals=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const NativeDate=Date,attempts=[];let online=true,pending=0,timerId=0,inlineForms=[],dialogIds=[];
  let seed=null,token=null,prepared=null;
  const role=options.role??0,initialState=structuredClone(options.state??fixture());
  const location=new URL('https://nashjavelona.github.io/us-together/'+(options.hash??''));
  const replacedLocations=[];
  const add=(map,type,handler)=>{if(!map.has(type))map.set(type,[]);map.get(type).push(handler);};
  const remove=(map,type,handler)=>map.set(type,(map.get(type)||[]).filter(item=>item!==handler));
  const dispatch=(map,type,event={})=>{for(const handler of [...map.get(type)||[]])handler(event);};

  function element(selector){
    let html='';
    return {
      selector,id:selector.startsWith('#')?selector.slice(1):'',textContent:'',value:'',dataset:{},fields:{},elements:{recovery:{value:''}},hidden:true,open:false,
      style:{setProperty(){}},classList:{add(){},remove(){},toggle(){}},
      get innerHTML(){return html;},
      set innerHTML(value){
        html=String(value);
        if(selector==='#dialog'){
          for(const id of dialogIds)elements.delete('#'+id);
          dialogIds=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
          for(const id of dialogIds)elements.set('#'+id,element('#'+id));
        }
        if(selector==='#app'){
          inlineForms=[...html.matchAll(/<form\b[^>]*class="add-inline"[^>]*data-owner="([01])"[^>]*>/g)].map(([,owner])=>{
            const form=element('.add-inline');form.dataset.owner=owner;
            const input=element('input');input.matches=()=>true;form.elements={task:input};return form;
          });
        }
      },
      showModal(){this.open=true;},close(){this.open=false;},
      focus(){document.activeElement=this;},scrollIntoView(){},matches(){return false;},
      setAttribute(){},removeAttribute(){},querySelectorAll(){return [];},click(){},remove(){},select(){}
    };
  }
  const get=selector=>{
    const owner=selector.match(/^\.add-inline\[data-owner="([01])"\]$/)?.[1];
    if(owner!==undefined)return inlineForms.find(form=>form.dataset.owner===owner)||null;
    if(!elements.has(selector))elements.set(selector,element(selector));return elements.get(selector);
  };
  const document={
    querySelector:get,querySelectorAll:selector=>selector==='.add-inline'?inlineForms:[],getElementById:id=>get('#'+id),
    addEventListener:(type,handler)=>add(documentListeners,type,handler),removeEventListener:(type,handler)=>remove(documentListeners,type,handler),
    activeElement:{matches(){return false;}},hidden:false,visibilityState:'visible',
    createElement:tag=>element(tag),body:{append(){},appendChild(){}}
  };
  class FormDataStub{
    constructor(form){this.fields=form.fields||{};}
    getAll(name){if(!Object.hasOwn(this.fields,name))return [];const value=this.fields[name];return Array.isArray(value)?value:[value];}
    get(name){return this.getAll(name)[0]??null;}
    has(name){return Object.hasOwn(this.fields,name);}
    *entries(){for(const name of Object.keys(this.fields))for(const value of this.getAll(name))yield [name,value];}
    [Symbol.iterator](){return this.entries();}
  }
  class TestDate extends NativeDate{
    constructor(...args){super(...(args.length?args:[service.now()]));}
    static now(){return service.now();}
  }
  const fetcher=async(url,settings={})=>{
    attempts.push({url:String(url),method:settings.method||'GET',body:settings.body&&JSON.parse(settings.body)});pending++;
    try{if(!online)throw new TypeError('Offline for this UI test');if(options.rejectPutOnce&&settings.method==='PUT'&&!options.rejectPutOnce.used){options.rejectPutOnce.used=true;return new Response(JSON.stringify({code:'forbidden',error:'A task can only be edited by its owner.'}),{status:403});}return await service.fetcher(url,settings);}
    finally{pending--;}
  };
  const mocks={
    document,window:{addEventListener:(type,handler)=>add(windowListeners,type,handler),removeEventListener:(type,handler)=>remove(windowListeners,type,handler),scrollTo(){}},
    localStorage:storage,FormData:FormDataStub,Date:TestDate,fetch:fetcher,location,
    history:{replaceState(_state,_unused,url){replacedLocations.push(url);location.href=new URL(url,location).href;}},
    navigator:{onLine:true},confirm:()=>true,
    setTimeout(handler,delay){const id=++timerId;timeouts.set(id,{handler,delay});return id;},clearTimeout:id=>timeouts.delete(id),
    setInterval(handler,delay){const id=++timerId;intervals.set(id,{handler,delay});return id;},clearInterval:id=>intervals.delete(id),
  };
  for(const [name,value]of Object.entries(mocks))Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
  async function idle(){
    let stable=0;
    for(let turn=0;turn<1500;turn++){
      await eventLoopTurn();
      if(!pending){if(++stable===4)return;}else stable=0;
    }
    throw Error('The local UI/API request did not finish within the bounded event-loop drain.');
  }
  const ui={
    service,storage,attempts,node:get,replacedLocations,
    state:()=>JSON.parse(storage.getItem(KEY)),get prepared(){return prepared;},
    click(dataset){dispatch(documentListeners,'click',{preventDefault(){},target:{closest(selector){return selector==='[data-cloud]'?(dataset.cloud?{dataset}:null):(dataset.a||dataset.action||dataset.view?{dataset}:null);}}});},
    capture(owner,text){dispatch(documentListeners,'submit',{preventDefault(){},target:{id:'',dataset:{owner:String(owner)},matches:selector=>selector==='.add-inline',elements:{task:{value:text}}}});},
    sendDocumentSubmit(form){dispatch(documentListeners,'submit',{preventDefault(){},target:form});},
    inputText(id,value){const node=get('#'+id);node.id=id;node.value=value;dispatch(documentListeners,'input',{target:node});},
    fill(selector,fields){const form=get(selector);assert.equal(typeof form.onsubmit,'function',`${selector} must be open`);form.fields={...fields};return form;},
    async submit(selector,fields){const form=fields?this.fill(selector,fields):get(selector);assert.equal(typeof form.onsubmit,'function',`${selector} must be open`);await form.onsubmit({preventDefault(){},target:form});await idle();},
    async pull(){dispatch(windowListeners,'online');await idle();},
    async flush(){for(const [id,timer]of [...timeouts])if(timer.delay===40){timeouts.delete(id);timer.handler();}await idle();},
    async tick(){for(const timer of intervals.values())if(timer.delay===1000)timer.handler();await idle();},
    advance:ms=>service.advance(ms),offline(){online=false;},online(){online=true;},idle,
    async remote(change){
      const current=await service.request('GET','/state',undefined,token);assert.equal(current.status,200);
      const state=structuredClone(current.body.state);change(state);
      const updated=await service.request('PUT','/state',{revision:current.body.revision,mutationId:crypto.randomUUID(),state},token);
      assert.equal(updated.status,200,JSON.stringify(updated.body));await this.pull();return updated.body;
    },
    protectedState(){const state=this.state();return {people:state.people.map(person=>({timer:person.timer,restUntil:person.restUntil,sessions:person.sessions,tasks:person.tasks.map(task=>({id:task.id,spent:task.spent,status:task.status}))})),togetherTimer:state.togetherTimer,togetherSessions:state.togetherSessions,shared:state.shared.map(task=>({id:task.id,spent:task.spent,status:task.status}))};}
  };
  try{
    if(options.connected!==false){
      let current=initialState;
      seed=createCloudSync({apiBase:API_BASE,storage,fetcher,getState:()=>current,onState:value=>{current=value;}});
      await seed.start();await seed.create({state:initialState,role,zone:'Asia/Manila',deviceName:'UI test browser'});
      token=service.calls.find(call=>call.path==='/spaces').body.deviceToken;
      if(options.beforeBoot)await options.beforeBoot({bridge:seed,service,get state(){return current;}});
      seed.stop();
      // The connection, not an old local profile selection, establishes identity.
      storage.setItem(KEY,JSON.stringify({...current,active:1-role}));
    }else storage.setItem(KEY,JSON.stringify(initialState));
    if(options.prepare)prepared=await options.prepare(service);
    await import(`../app.js?cloud-ui-${++imports}`);await idle();
    await run(ui);
  }finally{
    seed?.stop();timeouts.clear();intervals.clear();await idle();setCalendarZone(null);service.close();
    for(const [name,descriptor]of originals)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];
  }
}

function chosenSide(ui,role){
  assert.match(ui.node('#app').innerHTML,new RegExp(`data-a="profile" data-owner="${role}" class="chosen" aria-pressed="true"`));
}

test('stored identity stays fixed while partner views and subsequent polls preserve the selected side',async()=>{
  for(const role of [0,1])await withUI({role},async ui=>{
    assert.equal(ui.state().active,role);assert.equal(getCalendarZone(),'Asia/Manila');
    for(const action of ['profile','mobile']){
      ui.click({a:action,owner:String(1-role)});chosenSide(ui,1-role);assert.equal(ui.state().active,role);
      await ui.pull();chosenSide(ui,1-role);assert.equal(ui.state().active,role);
    }
    ui.capture(1-role,'A kind request while viewing your side');await ui.flush();
    const task=ui.state().people[1-role].tasks.find(task=>task.title==='A kind request while viewing your side');
    assert.equal(task.request.from,role);assert.equal(task.request.to,1-role);assert.equal(task.assignedBy,role);
    chosenSide(ui,1-role);assert.equal(ui.state().active,role);assert.ok(validCouple(ui.state()));
  });
});

test('partner task and personal focus controls cannot act through a view switch or forged click',async()=>{
  await withUI({},async ui=>{
    ui.click({a:'profile',owner:'1'});const before=ui.protectedState(),sent=ui.attempts.length;
    for(const action of ['complete','edit','starttask','just','delete','archive','help']){
      ui.click({a:action,id:'pink-task',owner:'1'});await ui.idle();
      assert.equal(ui.node('#dialog').open,false);assert.match(ui.node('#toast').innerHTML,/partner/);
    }
    for(const action of ['focus','endtimer','skipbreak','resume-outside'])ui.click({a:action,owner:'1'});
    ui.click({a:'start-early',id:'pink-task',owner:'1',minutes:'5',outside:'1'});await ui.idle();
    assert.deepEqual(ui.protectedState(),before);assert.equal(ui.attempts.length,sent);
    ui.click({a:'taskmenu',id:'pink-task'});
    assert.match(ui.node('#dialog').innerHTML,/partner manages this personal task/i);
    assert.doesNotMatch(ui.node('#dialog').innerHTML,/data-a="(?:edit|complete|starttask)"/);
  });
});

const forms=[
  {name:'task',selector:'#taskform',action:{a:'edit',id:'black-task'},fields:{owner:'0',title:'My saved task draft',minutes:'35',priority:'Medium',notBefore:'2026-10-18',due:'',preferred:'',steps:'Keep one small step',repeat:''},read:s=>s.people[0].tasks.find(x=>x.id==='black-task'),field:'title'},
  {name:'appointment',selector:'#apptform',action:{a:'editappt',owner:'0',id:'appointment-one'},fields:{title:'My saved appointment draft',date:'2026-10-18',start:'18:00',end:'19:00'},read:s=>s.people[0].appointments.find(x=>x.id==='appointment-one'),field:'title'},
  {name:'routine',selector:'#routineform',action:{a:'editroutine',owner:'0',id:'routine-one'},fields:{title:'My saved routine draft',minutes:'15',preferred:'',repeat:'daily',steps:'Read a page'},read:s=>s.people[0].routines.find(x=>x.id==='routine-one'),field:'title'},
  {name:'note',selector:'#noteform',action:{a:'editnote',id:'note-one'},fields:{text:'My saved note draft'},read:s=>s.notes.find(x=>x.id==='note-one'),field:'text'},
];

for(const form of forms)test(`a ${form.name} draft stays open during a remote poll and saves into the current state`,async()=>{
  await withUI({},async ui=>{
    ui.click(form.action);const opened=ui.fill(form.selector,form.fields),html=ui.node('#dialog').innerHTML;
    await ui.remote(state=>{state.shared.find(task=>task.id==='shared-task').title='A new shared plan from another device';});
    assert.equal(ui.node(form.selector),opened);assert.deepEqual(opened.fields,form.fields);assert.equal(ui.node('#dialog').innerHTML,html);
    await ui.submit(form.selector);await ui.flush();
    assert.equal(form.read(ui.state())[form.field],form.fields[form.field]);
    assert.equal(ui.state().shared.find(task=>task.id==='shared-task').title,'A new shared plan from another device');
    assert.equal(ui.node('#storage').dataset.kind,'saved');assert.ok(validCouple(ui.state()));
    await ui.pull();assert.equal(form.read(ui.state())[form.field],form.fields[form.field]);
  });
});

test('same-record changes reject stale task, appointment, routine and note drafts without losing either version',async()=>{
  for(const form of forms)await withUI({},async ui=>{
    ui.click(form.action);const opened=ui.fill(form.selector,form.fields);
    await ui.remote(state=>{form.read(state)[form.field]='Changed on another device';});
    const writes=ui.attempts.filter(call=>call.method==='PUT').length;
    await ui.submit(form.selector);await ui.flush();
    assert.equal(ui.node('#dialog').open,true);assert.equal(ui.node(form.selector),opened);assert.deepEqual(opened.fields,form.fields);
    assert.match(ui.node('#dialog-status').textContent,/changed.*(?:form was open|editing)/i);
    assert.equal(form.read(ui.state())[form.field],'Changed on another device');
    assert.equal(ui.attempts.filter(call=>call.method==='PUT').length,writes);
    // A subsequent render/save must not reveal mutation of a detached stale record.
    ui.click({a:'profile',owner:'0'});assert.equal(form.read(ui.state())[form.field],'Changed on another device');
  });
});

test('connected ticks do not settle or write expired personal/shared timers while offline',async()=>{
  for(const owner of [0,2])await withUI({beforeBoot:async({bridge})=>{
    await bridge.focus({action:'start',owner,taskId:owner===2?'shared-task':'black-task',minutes:1});
  }},async ui=>{
    const before=ui.protectedState(),writes=ui.attempts.filter(call=>call.method!=='GET').length;
    ui.offline();ui.advance(2*minute);await ui.tick();
    assert.deepEqual(ui.protectedState(),before);
    assert.equal(ui.attempts.filter(call=>call.method!=='GET').length,writes);
    assert.ok(ui.attempts.slice(-1)[0].url.endsWith('/state'));
    assert.equal(ui.node(owner===2?'[data-together-timer]':'[data-timer="0"]').textContent,'0:00');
    assert.equal(ui.node('#storage').dataset.kind,'offline');
    ui.online();await ui.pull();
    const state=ui.state();assert.equal(owner===2?state.togetherTimer:state.people[0].timer,null);
    assert.equal((owner===2?state.togetherSessions:state.people[0].sessions).reduce((sum,item)=>sum+item.seconds,0),60);
  });
});

test('connected offline calendar rollover does not generate either partner’s server-owned routine occurrences',async()=>{
  const state=fixture();for(const owner of [0,1])state.people[owner].routines=[{...sampleTask(`daily-${owner}`,'Daily small plan'),repeat:'daily',days:[],from:'2026-10-18'}];
  await withUI({state},async ui=>{
    const before=ui.state().people.map(person=>({tasks:person.tasks,routines:person.routines}));
    ui.offline();ui.advance(24*60*minute);await ui.tick();
    assert.deepEqual(ui.state().people.map(person=>({tasks:person.tasks,routines:person.routines})),before);
    assert.ok(!ui.attempts.some(call=>call.method==='PUT'));
  });
});

test('invitation fragments are escaped/removed and links cannot redirect pairing credentials to another service',async()=>{
  const injection='</textarea><img src=x onerror="bad()">';
  await withUI({connected:false,state:sampleState(),hash:'#join='+encodeURIComponent(injection),prepare:async service=>{
    const creator=await service.create();assert.equal(creator.status,200);
    const invite=await service.request('POST','/invite',{},creator.token);return {creator,invite:invite.body.invite};
  }},async ui=>{
    assert.doesNotMatch(ui.node('#dialog').innerHTML,/<img\b/);assert.match(ui.node('#dialog').innerHTML,/&lt;\/textarea&gt;&lt;img/);
    assert.deepEqual(ui.replacedLocations,['/us-together/']);assert.equal(location.hash,'');assert.equal(ui.attempts.length,0);
    await ui.submit('#cloud-join-form',{invite:'https://untrusted.example/collect#join='+ui.prepared.invite+'&api=https://untrusted.example/api',deviceName:'My test phone'});
    assert.equal(ui.state().active,1);assert.equal(ui.attempts.length,1);
    assert.equal(ui.attempts[0].url,API_BASE+'/join');assert.equal(ui.attempts[0].body.invite,ui.prepared.invite);
    assert.equal(ui.node('#storage').dataset.kind,'saved');
  });
});

test('recovery import keeps the configured API and discards supplied endpoint/token/prototype fields',async()=>{
  await withUI({connected:false,state:sampleState(),prepare:service=>service.create()},async ui=>{
    const creator=ui.prepared;assert.equal(creator.status,200);
    const file=JSON.stringify({type:'us-together-recovery',version:1,spaceId:creator.body.spaceId,role:0,recoveryKey:creator.recoveryKey,service:'https://untrusted.example/api',deviceToken:'attacker',constructor:{prototype:{polluted:true}}});
    assert.deepEqual(Object.keys(parseRecovery(file)),['spaceId','role','recoveryKey']);
    ui.click({cloud:'recover'});await ui.submit('#cloud-recover-form',{recovery:file,deviceName:'My recovered phone'});
    assert.equal(ui.state().active,0);assert.equal(ui.attempts.length,1);assert.equal(ui.attempts[0].url,API_BASE+'/recover');
    assert.equal(ui.attempts[0].body.spaceId,creator.body.spaceId);assert.notEqual(ui.attempts[0].body.deviceToken,'attacker');
    assert.equal(Object.hasOwn(ui.attempts[0].body,'service'),false);assert.equal(Object.hasOwn(ui.attempts[0].body,'constructor'),false);
    assert.equal(({}).polluted,undefined);assert.equal(ui.node('#storage').dataset.kind,'saved');
    assert.throws(()=>parseRecovery({...JSON.parse(file),role:2}),/not a valid/);
  });
});

test('unfinished pairing has retry and safe-resolution controls that never remove local task data', async()=>{
  await withUI({connected:false,state:fixture()},async ui=>{
    const prefix='us-together.cloud.v4:'+encodeURIComponent(API_BASE)+':';
    const handshakeKey=prefix+'handshake';
    const secret=n=>String(n).repeat(43);
    ui.storage.setItem(handshakeKey,JSON.stringify({
      version:1,type:'join',signature:'old device name',body:{
        invite:secret('I'),deviceName:'Old device',deviceToken:secret('D'),recoveryKey:secret('R'),
      }
    }));
    const before=ui.state();
    ui.click({cloud:'open'});
    assert.match(ui.node('#dialog').innerHTML,/earlier connection needs attention/i);
    assert.match(ui.node('#dialog').innerHTML,/data-cloud="pending-retry"/);
    assert.match(ui.node('#dialog').innerHTML,/data-cloud="pending-reset"/);
    assert.doesNotMatch(ui.node('#dialog').innerHTML,/I{43}|D{43}|R{43}/, 'secret values must never render');
    ui.click({cloud:'pending-reset'});
    assert.match(ui.node('#dialog').innerHTML,/check the unfinished connection/i);
    ui.click({cloud:'pending-reset-confirm'});
    await ui.idle();
    assert.equal(ui.storage.getItem(handshakeKey),null);
    assert.deepEqual(ui.state(),before, 'local tasks and notes remain as they were');
    assert.match(ui.node('#dialog').innerHTML,/bring your two little worlds together/i);
  });
});


test('the dashboard explains a rejected cloud save and offers a recoverable discard choice',async()=>{
  const option={used:false};
  await withUI({rejectPutOnce:option},async ui=>{
    ui.click({a:'edit',id:'shared-task'});
    await ui.submit('#taskform',{owner:'2',title:'A rejected task update',minutes:'25',priority:'Medium',notBefore:'2026-10-18',due:'',preferred:'',steps:'',repeat:''});
    await ui.flush();
    assert.equal(option.used,true);
    assert.equal(ui.node('#storage').dataset.kind,'conflict');
    ui.click({cloud:'conflicts'});
    assert.match(ui.node('#dialog').innerHTML,/server declined a save/i);
    assert.match(ui.node('#dialog').innerHTML,/discard rejected save/i);
    assert.doesNotMatch(ui.node('#dialog').innerHTML,/data-cloud="conflicts-local"/,'cannot force server-invalid data');
    ui.click({cloud:'rejected-discard'});await ui.idle();
    assert.equal(ui.state().shared.find(t=>t.id==='shared-task').title,'A plan for both of us');
    assert.equal(ui.node('#storage').dataset.kind,'saved');
  });
});

test('selecting a malformed recovery file clears the stale pasted recovery text',async()=>{
  await withUI({connected:false},async ui=>{
    ui.click({cloud:'recover'});
    const form=ui.node('#cloud-recover-form');
    const input=ui.node('#cloud-recovery-file');
    form.elements.recovery.value='old recovery details';
    input.files=[{size:25, text:async()=>'{"bad":true}'}];
    input.value='bad.json';
    await input.onchange({target:input});
    assert.equal(form.elements.recovery.value,'');
    assert.equal(input.value,'');
    assert.match(ui.node('#dialog-status').textContent,/not a valid|recovery/i);
  });
});

test('the device connection chooser clearly separates own second device from a partner invitation',async()=>{
  await withUI({connected:false},async ui=>{
    ui.click({cloud:'open'});
    assert.match(ui.node('#dialog').innerHTML,/Already use Us, Together on another device/i);
    assert.match(ui.node('#dialog').innerHTML,/For YOUR second phone, laptop/i);
    assert.match(ui.node('#dialog').innerHTML,/For your PARTNER only/i);
    ui.click({cloud:'join'});
    assert.match(ui.node('#dialog').innerHTML,/not your second device/i);
    ui.click({cloud:'open'});
    ui.click({cloud:'recover'});
    assert.match(ui.node('#dialog').innerHTML,/same.*charcoal or pink identity/i);
  });
});

test('disconnect explains that unsent changes do not automatically merge after reconnecting',async()=>{
  await withUI({},async ui=>{
    ui.offline();
    ui.capture(0,'Finish this task while offline');
    ui.click({cloud:'disconnect'});
    assert.match(ui.node('#dialog').innerHTML,/NOT reached the server/i);
    assert.match(ui.node('#dialog').innerHTML,/do(es)? not automatically merge/i);
    assert.match(ui.node('#dialog').innerHTML,/Never upload either file to GitHub/i);
  });
});

test('For You inbox sends an online message, keeps markup escaped, and syncs via the existing note endpoint',async()=>{
  await withUI({role:0},async ui=>{
    ui.click({view:'inbox'});
    assert.match(ui.node('#app').innerHTML,/Just between us/);
    assert.match(ui.node('#app').innerHTML,/Send a little message to Pink/);
    const form=ui.node('#messageform');form.id='messageform';form.fields={message:'I miss you <img src=x onerror=alert(1)> ♡'};
    // Event delegation is the same path used by pressing the message Send button.
    ui.sendDocumentSubmit(form);await ui.flush();
    const message=ui.state().notes.find(n=>n.text.includes('I miss you'));
    assert.ok(message,'the message is saved in the existing notes collection');
    assert.match(ui.node('#app').innerHTML,/&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(ui.node('#app').innerHTML,/<img src=x onerror/);
    assert.equal(ui.state().active,0);
    assert.ok(ui.attempts.some(a=>a.method==='PUT'&&a.body?.state?.notes?.some(n=>n.id===message.id)),'message saved through authenticated API');
    ui.click({view:'home'});assert.match(ui.node('#app').innerHTML,/A LITTLE SOMETHING FOR YOU/);
  });
});

test('For You notes, read buttons and reactions work for both local sides without mixing the original love-note wall',async()=>{
  await withUI({connected:false},async ui=>{
    ui.click({view:'inbox'});
    const form=ui.node('#messageform');form.id='messageform';form.fields={message:'Hello Pink'};ui.sendDocumentSubmit(form);
    const id=ui.state().notes.find(n=>n.text.endsWith('Hello Pink')).id;
    ui.click({a:'compose-letter'});
    assert.match(ui.node('#dialog').innerHTML,/A letter in their pocket/);
    await ui.submit('#letterform',{letter:'You make ordinary days better.'});
    assert.equal(ui.state().notes.length,3,'the existing wall note and two mail items remain');
    ui.click({a:'profile',owner:'1'});ui.click({view:'inbox'});
    assert.match(ui.node('#app').innerHTML,/Hello Pink/);
    assert.match(ui.node('#app').innerHTML,/unopened for Pink/);
    ui.click({a:'mail-seen',id});assert.equal(ui.state().notes.length,4);
    ui.click({a:'mail-react',id,reaction:'heart'});assert.equal(ui.state().notes.length,5);
    ui.click({a:'mail-seen-all'});assert.equal(ui.state().notes.length,6,'letter now read too');
    ui.click({a:'mail-open',id:ui.state().notes.find(n=>n.text.includes('You make ordinary days better')).id});
    assert.match(ui.node('#dialog').innerHTML,/You make ordinary days better/);
    ui.click({a:'notes'});
    assert.match(ui.node('#dialog').innerHTML,/An original little note/);
    assert.doesNotMatch(ui.node('#dialog').innerHTML,/UT-FOR-YOU/);
  });
});


test('unfinished message drafts stay with their author when a shared browser switches profiles',async()=>{
  await withUI({connected:false},async ui=>{
    ui.click({view:'inbox'});ui.inputText('message-text','Black\'s unfinished note');
    ui.click({a:'profile',owner:'1'});
    assert.doesNotMatch(ui.node('#app').innerHTML,/Black&#39;s unfinished note/);
    ui.inputText('message-text','Pink\'s own draft');
    ui.click({a:'profile',owner:'0'});
    assert.match(ui.node('#app').innerHTML,/Black&#39;s unfinished note/);
    assert.doesNotMatch(ui.node('#app').innerHTML,/Pink&#39;s own draft/);
    ui.click({a:'profile',owner:'1'});
    assert.match(ui.node('#app').innerHTML,/Pink&#39;s own draft/);
  });
});

test('advanced pending repair is gated behind a warning and only removes the unfinished browser request',async()=>{
  await withUI({connected:false,state:fixture()},async ui=>{
    const prefix='us-together.cloud.v4:'+encodeURIComponent(API_BASE)+':';
    const handshakeKey=prefix+'handshake';
    ui.storage.setItem(handshakeKey,JSON.stringify({
      version:1,type:'recover',signature:'old interrupted reconnect',body:{
        spaceId:'existing-test-space',role:0,recoveryKey:'R'.repeat(43),deviceName:'Laptop',deviceToken:'D'.repeat(43),
      }
    }));
    const before=ui.state(),previousCalls=ui.attempts.length;
    ui.click({cloud:'open'});
    ui.click({cloud:'pending-reset'});
    assert.match(ui.node('#dialog').innerHTML,/advanced: forget unfinished attempt/i);
    ui.click({cloud:'pending-force-warning'});
    assert.match(ui.node('#dialog').innerHTML,/permanently lose access/i);
    assert.match(ui.node('#dialog').innerHTML,/does not fix an active server rate limit/i);
    assert.notEqual(ui.storage.getItem(handshakeKey),null,'showing warning alone must not remove it');
    ui.click({cloud:'pending-force-confirm'});await ui.idle();
    assert.equal(ui.storage.getItem(handshakeKey),null);
    assert.deepEqual(ui.state(),before,'local tasks and notes remain intact');
    assert.equal(ui.attempts.length,previousCalls,'danger action does not send another pairing attempt');
    assert.match(ui.node('#dialog').innerHTML,/Bring your two little worlds together/i);
  });
});
