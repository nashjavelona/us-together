import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initial,validCouple} from '../couple.js';
import {day,parse} from '../core.js';

const minute=60000,KEY='us-together.v2';
let importNumber=0;

function fixture(){
  const s=initial();s.setup=true;s.names=['Black','Pink'];
  s.people.forEach(person=>{person.settings.start='00:00';person.settings.end='23:59';});
  return s;
}

// A bounded event/DOM stub exercises the real handlers and saved state. It does
// not claim browser rendering, native form validation or layout coverage.
async function withUI(initialState,run){
  let saved=JSON.stringify(initialState),elements=new Map(),listeners=new Map(),windowListeners=new Map();
  const local=new Date();local.setHours(10,0,0,0);let now=local.getTime(),interval;
  const originals={document:globalThis.document,window:globalThis.window,localStorage:globalThis.localStorage,FormData:globalThis.FormData,setInterval:globalThis.setInterval,setTimeout:globalThis.setTimeout,confirm:globalThis.confirm};
  const originalNow=Date.now;
  function element(selector){
    let html='';
    return {
      selector,textContent:'',dataset:{},hidden:true,open:false,style:{setProperty(){}},
      classList:{add(){},remove(){},toggle(){}},
      get innerHTML(){return html;},
      set innerHTML(value){html=value;if(selector==='#dialog'&&elements.has('#dialog-status')){const status=elements.get('#dialog-status');status.hidden=true;status.textContent='';}},
      showModal(){this.open=true;},close(){this.open=false;},
      focus(){doc.activeElement=this;},scrollIntoView(){},matches(){return false;},
      setAttribute(){},removeAttribute(){},click(){}
    };
  }
  const get=selector=>{if(!elements.has(selector))elements.set(selector,element(selector));return elements.get(selector);};
  const doc={querySelector:get,querySelectorAll(){return [];},getElementById(id){return get('#'+id);},addEventListener(type,handler){const list=listeners.get(type)||[];list.push(handler);listeners.set(type,list);},activeElement:{matches(){return false;}},hidden:false};
  class FormDataStub{
    constructor(form){this.fields=form.fields||{};}
    get(name){const values=this.getAll(name);return values.length?values[0]:null;}
    getAll(name){if(!Object.hasOwn(this.fields,name))return [];const value=this.fields[name];return Array.isArray(value)?value:[value];}
    has(name){return Object.hasOwn(this.fields,name);}
    *entries(){for(const name of Object.keys(this.fields))for(const value of this.getAll(name))yield [name,value];}
    [Symbol.iterator](){return this.entries();}
  }
  const dispatch=(type,event)=>{for(const handler of listeners.get(type)||[])handler(event);};
  const load=async()=>{
    elements=new Map();listeners=new Map();windowListeners=new Map();doc.activeElement={matches(){return false;}};
    await import(`../app.js?redesign-${++importNumber}`);
  };
  const ui={
    state:()=>JSON.parse(saved),node:get,
    click(dataset){dispatch('click',{preventDefault(){},target:{closest(){return {dataset};}}});},
    capture(owner,value){dispatch('submit',{preventDefault(){},target:{id:'',dataset:{owner:String(owner)},matches(selector){return selector==='.add-inline';},elements:{task:{value}}}});},
    submit(selector,fields){const form=get(selector);assert.equal(typeof form.onsubmit,'function',`${selector} needs a submit handler`);return form.onsubmit({preventDefault(){},target:{id:selector.slice(1),fields}});},
    advance(milliseconds){now+=milliseconds;},
    tick(){interval?.();},
    async reload(){await load();},
    storage(state){saved=JSON.stringify(state);for(const handler of windowListeners.get('storage')||[])handler({key:KEY,newValue:saved});},
    action(name){
      const tag=get('#dialog').innerHTML.match(new RegExp('<button\\b[^>]*\\bdata-a="'+name+'"[^>]*>'))?.[0];
      assert.ok(tag,`Missing dialog action ${name}`);
      return Object.fromEntries([...tag.matchAll(/\bdata-([\w-]+)="([^"]*)"/g)].map(([,key,value])=>[key.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),value]));
    }
  };
  globalThis.document=doc;
  globalThis.window={addEventListener(type,handler){const list=windowListeners.get(type)||[];list.push(handler);windowListeners.set(type,list);},scrollTo(){}};
  globalThis.localStorage={getItem(key){return key===KEY?saved:null;},setItem(key,value){if(key===KEY)saved=value;}};
  globalThis.FormData=FormDataStub;
  globalThis.setInterval=handler=>{interval=handler;return 0;};globalThis.setTimeout=()=>0;globalThis.confirm=()=>true;Date.now=()=>now;
  try{await load();await run(ui);}
  finally{Object.assign(globalThis,originals);Date.now=originalNow;}
}

test('profile and mobile switches change the acting identity used for personal tasks and requests',async()=>{
  await withUI(fixture(),async ui=>{
    ui.click({a:'profile',owner:'1'});assert.equal(ui.state().active,1);
    ui.capture(1,'My pink-side task for 20 minutes');
    let task=ui.state().people[1].tasks[0];assert.equal(task.assignedBy,1);assert.equal(task.request,undefined);
    ui.click({a:'mobile',owner:'0'});assert.equal(ui.state().active,0);
    ui.capture(0,'My black-side task');task=ui.state().people[0].tasks[0];assert.equal(task.assignedBy,0);assert.equal(task.request,undefined);
    ui.capture(1,'A request for my partner');task=ui.state().people[1].tasks.find(t=>t.title==='A request for my partner');
    assert.equal(task.request.from,0);assert.equal(task.request.to,1);assert.ok(validCouple(ui.state()));
  });
});

test('Just 5 keeps its five-minute choice through the start-early confirmation',async()=>{
  await withUI(fixture(),async ui=>{
    ui.capture(0,'Read tomorrow for 45 minutes');const task=ui.state().people[0].tasks[0];assert.ok(task.notBefore>day());
    ui.click({a:'just',id:task.id});assert.equal(ui.state().people[0].timer,null);
    assert.match(ui.node('#dialog').innerHTML,/Start this task early/);
    const confirmation=ui.action('start-early');assert.equal(confirmation.minutes,'5');ui.click(confirmation);
    const state=ui.state();assert.equal(state.people[0].timer.remaining,5*minute);assert.equal(state.people[0].timer.running,true);assert.equal(state.people[0].tasks[0].notBefore,day());
  });
});

test('shared focus blocks personal timers and pause/resume/end record shared time once',async()=>{
  const s=fixture(),own=parse('Study on my own for 30 minutes'),shared=parse('Plan our weekend for 45 minutes');s.people[0].tasks.push(own);s.shared.push(shared);
  await withUI(s,async ui=>{
    ui.click({a:'together-start',id:shared.id});ui.submit('#togetherform',{minutes:'25'});
    assert.equal(ui.state().togetherTimer.running,true);assert.equal(ui.state().togetherTimer.remaining,25*minute);
    ui.click({a:'starttask',id:own.id});assert.equal(ui.state().people[0].timer,null);assert.match(ui.node('#toast').innerHTML,/shared session/);
    ui.advance(2*minute);ui.click({a:'together-toggle'});
    assert.equal(ui.state().togetherTimer.running,false);assert.equal(ui.state().shared[0].spent,120);
    ui.click({a:'starttask',id:own.id});assert.equal(ui.state().people[0].timer,null);
    ui.advance(7*minute);ui.click({a:'together-toggle'});assert.equal(ui.state().togetherTimer.remaining,23*minute);assert.equal(ui.state().togetherTimer.running,true);
    ui.advance(minute);ui.click({a:'together-end'});let state=ui.state();
    assert.equal(state.togetherTimer,null);assert.equal(state.shared[0].spent,180);assert.equal(state.shared[0].status,'open');
    assert.equal(state.togetherSessions.reduce((n,x)=>n+x.seconds,0),180);assert.equal(state.people.flatMap(p=>p.sessions).length,0);
    ui.click({a:'together-end'});state=ui.state();assert.equal(state.shared[0].spent,180);assert.equal(state.togetherSessions.reduce((n,x)=>n+x.seconds,0),180);assert.ok(validCouple(state));
  });
});

test('optional check-ins and moment cycling survive reloading the saved couple space',async()=>{
  const s=fixture();s.momentIndex=0;
  await withUI(s,async ui=>{
    ui.click({a:'mood',mood:'soft'});ui.click({a:'profile',owner:'1'});ui.click({a:'mood',mood:'bright'});
    assert.deepEqual(ui.state().checkins,{date:day(),moods:['soft','bright']});
    for(let i=0;i<7;i++)ui.click({a:'another-moment'});
    assert.equal(ui.state().momentIndex,1);assert.equal(ui.state().shared.length,0);
    await ui.reload();assert.deepEqual(ui.state().checkins,{date:day(),moods:['soft','bright']});assert.equal(ui.state().momentIndex,1);assert.equal(ui.state().active,1);
    assert.match(ui.node('#app').innerHTML,/Take the long way together/);assert.ok(validCouple(ui.state()));
  });
});

test('invalid edit feedback stays in the dialog status and leaves the running task unchanged',async()=>{
  const s=fixture(),task=parse('Keep my original task for 30 minutes');s.people[0].tasks.push(task);
  await withUI(s,async ui=>{
    ui.click({a:'starttask',id:task.id});ui.click({a:'edit',id:task.id});const before=ui.state();
    assert.equal(ui.node('#dialog').open,true);assert.match(ui.node('#dialog').innerHTML,/id="dialog-status"[^>]*role="alert"/);
    ui.submit('#taskform',{owner:'0',title:'An invalid replacement',minutes:'0',priority:'Medium',notBefore:day(),due:'',preferred:'',steps:'A step',repeat:''});
    assert.equal(ui.node('#dialog').open,true);assert.equal(ui.node('#dialog-status').hidden,false);assert.match(ui.node('#dialog-status').textContent,/duration/);
    assert.deepEqual(ui.state(),before);
    ui.click({a:'close'});ui.click({a:'taskmenu',id:task.id});assert.match(ui.node('#dialog').innerHTML,/Keep my original task/);
  });
});

test('delete confirmation and undo preserve task order, checklist and earned focus time',async()=>{
  const s=fixture(),before=parse('Before'),task=parse('Delete and restore me for 30 minutes'),after=parse('After');
  task.steps=[{title:'Keep this checked step',done:true}];s.people[0].tasks.push(before,task,after);
  await withUI(s,async ui=>{
    ui.click({a:'starttask',id:task.id});ui.advance(minute);ui.click({a:'delete',id:task.id});
    assert.equal(ui.state().people[0].tasks.length,3);ui.click(ui.action('confirm-delete'));
    let state=ui.state();assert.deepEqual(state.people[0].tasks.map(t=>t.id),[before.id,after.id]);assert.equal(state.people[0].timer,null);assert.equal(state.people[0].sessions.reduce((n,x)=>n+x.seconds,0),60);
    ui.click({a:'undo'});state=ui.state();assert.deepEqual(state.people[0].tasks.map(t=>t.id),[before.id,task.id,after.id]);
    assert.deepEqual(state.people[0].tasks[1].steps,task.steps);assert.equal(state.people[0].tasks[1].spent,60);assert.equal(state.people[0].tasks[1].status,'open');assert.equal(state.people[0].timer,null);
    ui.click({a:'undo'});state=ui.state();assert.equal(state.people[0].tasks.length,3);assert.equal(state.people[0].sessions.reduce((n,x)=>n+x.seconds,0),60);assert.ok(validCouple(state));
  });
});

test('legacy shared help requests offer shared focus and can be cleared from either profile',async()=>{
  for(const actor of [0,1]){
    const s=fixture(),task=parse('A shared task needing support for 25 minutes');s.active=actor;
    task.help=true;task.helper=1;s.shared.push(task);
    await withUI(s,async ui=>{
      const teamwork=ui.node('#app').innerHTML.match(/<section\b[^>]*id="teamwork"[^>]*>[\s\S]*?<\/section>/)?.[0];
      assert.ok(teamwork);assert.match(teamwork,/Focus together/);assert.match(teamwork,/Clear help request/);
      assert.match(teamwork,new RegExp('data-a="together-start"[^>]*data-id="'+task.id+'"'));
      assert.match(teamwork,new RegExp('data-a="help"[^>]*data-id="'+task.id+'"'));
      ui.click({a:'together-start',id:task.id});
      assert.equal(ui.node('#dialog').open,true);assert.equal(typeof ui.node('#togetherform').onsubmit,'function');
      ui.click({a:'close'});ui.click({a:'help',id:task.id});
      const state=ui.state();assert.equal(state.shared.length,1);assert.equal(state.shared[0].id,task.id);assert.equal(state.shared[0].help,false);assert.equal(state.shared[0].helper,null);
      assert.equal(state.shared[0].status,'open');assert.equal(state.togetherTimer==null,true);assert.ok(validCouple(state));
    });
  }
});

test('a task edit opened before a storage ownership or request change cannot overwrite the updated task',async()=>{
  for(const pending of [false,true]){
    const s=fixture(),task=parse('Original task for 30 minutes');task.steps=[{title:'Original checked step',done:true}];s.people[0].tasks.push(task);
    await withUI(s,async ui=>{
      ui.click({a:'edit',id:task.id});assert.equal(ui.node('#dialog').open,true);
      const incoming=ui.state(),updated=incoming.people[0].tasks.shift();
      updated.title='Updated in the other tab';updated.minutes=40;updated.assignedBy=0;
      if(pending)updated.request={from:0,to:1,origin:0,created:new Date().toISOString()};
      incoming.people[1].tasks.push(updated);assert.ok(validCouple(incoming));
      const expectedTasks=JSON.parse(JSON.stringify(incoming.people.map(person=>person.tasks)));
      ui.storage(incoming);
      ui.submit('#taskform',{owner:'0',title:'Stale overwrite',minutes:'15',priority:'High',notBefore:day(),due:'',preferred:'',steps:'Replace the checklist',repeat:''});
      assert.equal(ui.node('#dialog').open,true);assert.equal(ui.node('#dialog-status').hidden,false);assert.match(ui.node('#dialog-status').textContent,/changed.*form was open/i);
      assert.deepEqual(ui.state().people.map(person=>person.tasks),expectedTasks);
      // Saving the acting profile also exposes any accidental in-memory edits
      // that might otherwise have remained hidden behind the last saved JSON.
      ui.click({a:'profile',owner:'1'});
      assert.deepEqual(ui.state().people.map(person=>person.tasks),expectedTasks);assert.ok(validCouple(ui.state()));
    });
  }
});
