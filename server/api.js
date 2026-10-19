import {ApiError,bad,requireThat} from './errors.js';
import {canonicalZone} from './time.js';
import {LIMITS,allTasks,clone,expireTimers,generateRoutines,normalizeState,pausedCopy,stable,taskCount,taskMap,wireState} from './state.js';
import {authorizeAndApply} from './transitions.js';
import {focusCommand} from './focus.js';

const ORIGINS=new Set(['https://momentum-my-second-brain.void-mag-inv-5623.chatgpt.site','https://nashjavelona.github.io']);
const MAX_BODY=1024*1024;
const tokenPattern=/^[A-Za-z0-9_-]{43}$/;
const mutationPattern=/^[A-Za-z0-9_-]{8,128}$/;
const clock=env=>typeof env.NOW==='function'?env.NOW():Date.now();
const uuid=()=>crypto.randomUUID();
async function hash(value){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');}
function secret(){return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function credential(value,label){requireThat(typeof value==='string'&&tokenPattern.test(value),400,'invalid_request',`${label} must be a 32-byte base64url capability.`);return value;}
function roleValue(role){requireThat([0,1].includes(role),400,'invalid_request','Choose the black or pink member role.');return role;}
function deviceName(value){requireThat(typeof value==='string'&&value.trim().length>0&&value.trim().length<=80,400,'invalid_request','Give this device a name of 1–80 characters.');return value.trim();}
function safeTree(value,depth=0,count={n:0}){
  if(depth>24||++count.n>150000)throw bad('The JSON structure is too complex.');
  if(value&&typeof value==='object')for(const key of Object.keys(value)){if(['__proto__','prototype','constructor'].includes(key))throw bad('Prototype keys are not allowed.');safeTree(value[key],depth+1,count);}
}
async function body(request){
  const declared=Number(request.headers.get('content-length')||0);if(declared>MAX_BODY)throw new ApiError(413,'body_too_large','Request bodies are limited to 1 MiB.');
  if(!request.headers.get('content-type')?.toLowerCase().includes('application/json'))throw new ApiError(415,'json_required','Send a JSON request body.');
  const reader=request.body?.getReader();if(!reader)throw bad('A JSON body is required.');let size=0;const chunks=[];
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY){await reader.cancel();throw new ApiError(413,'body_too_large','Request bodies are limited to 1 MiB.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let value;try{value=JSON.parse(new TextDecoder().decode(bytes));}catch{throw bad('The body is not readable JSON.');}
  requireThat(value&&typeof value==='object'&&!Array.isArray(value),400,'invalid_request','Send one JSON object.');safeTree(value);return value;
}
function cors(request,env){
  const headers=new Headers({'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','Vary':'Origin','X-Content-Type-Options':'nosniff'});
  const origin=request.headers.get('origin');if(!origin)return headers;
  let local=false;try{const a=new URL(origin),b=new URL(request.url);local=['localhost','127.0.0.1'].includes(a.hostname)&&['http:','https:'].includes(a.protocol)&&(['localhost','127.0.0.1'].includes(b.hostname)||env.ENVIRONMENT==='development');}catch{}
  requireThat(ORIGINS.has(origin)||local,403,'origin_forbidden','This origin is not permitted to use the shared-space API.');
  headers.set('Access-Control-Allow-Origin',origin);headers.set('Access-Control-Allow-Methods','GET, POST, PUT, DELETE, OPTIONS');headers.set('Access-Control-Allow-Headers','Authorization, Content-Type');return headers;
}
function reply(value,status,headers){return new Response(JSON.stringify(value),{status,headers});}
async function deviceForToken(db,token){return db.prepare('SELECT * FROM couple_devices WHERE token_hash = ?').bind(await hash(`device:${token}`)).first();}
function usable(device){requireThat(device,401,'unauthorized','This device is not connected to a shared space.');requireThat(device.revoked_at===null,401,'revoked','This device has been revoked. Recover your member access to reconnect.');return device;}
async function authenticate(request,db,now){
  const auth=request.headers.get('authorization')||'';
  const match=auth.match(/^Bearer ([A-Za-z0-9_-]{43})$/);requireThat(match,401,'unauthorized','Connect this device before opening the shared space.');
  const device=usable(await deviceForToken(db,match[1]));
  if(now-device.last_seen>=60000)await db.prepare('UPDATE couple_devices SET last_seen = ? WHERE id = ? AND revoked_at IS NULL').bind(now,device.id).run();
  return device;
}
async function spaceRow(db,id){const row=await db.prepare('SELECT * FROM couple_spaces WHERE id = ?').bind(id).first();requireThat(row,404,'not_found','The shared space was not found.');return row;}
async function envelope(db,row,device,now){const count=await db.prepare('SELECT COUNT(*) AS count FROM couple_members WHERE space_id = ?').bind(row.id).first();return {state:wireState(JSON.parse(row.state_json)),revision:row.revision,spaceId:row.id,role:device.role,zone:row.zone,partnerJoined:count.count===2,serverNow:now,deviceId:device.id};}
async function rateLimit(request,db,path,now){
  const ip=request.headers.get('cf-connecting-ip')||'unknown',key=await hash(`rate:${path}:${ip}`),window=Math.floor(now/3600000)*3600000,max=path==='/join'?60:20;
  const row=await db.prepare('INSERT INTO couple_rate_limits (key,window_start,hits) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET hits = CASE WHEN window_start = excluded.window_start THEN hits + 1 ELSE 1 END, window_start = excluded.window_start RETURNING hits').bind(key,window).first();
  if(row.hits>max)throw new ApiError(429,'rate_limited','Too many pairing attempts. Wait before trying again.');
  await db.prepare('DELETE FROM couple_rate_limits WHERE window_start < ?').bind(window-86400000).run();
}
async function existingDeviceResponse(db,token,now){const device=await deviceForToken(db,token);if(!device)return null;usable(device);return envelope(db,await spaceRow(db,device.space_id),device,now);}
async function createSpace(db,payload,now){
  const token=credential(payload.deviceToken,'Device token');const existing=await existingDeviceResponse(db,token,now);if(existing)return existing;
  const role=roleValue(payload.role),zone=canonicalZone(payload.zone),recovery=credential(payload.recoveryKey,'Recovery key'),name=deviceName(payload.deviceName);
  requireThat(token!==recovery,400,'invalid_request','Use different device and recovery capabilities.');
  const state=normalizeState(pausedCopy(normalizeState(payload.state),now,zone)),id=uuid(),deviceId=uuid(),tokenHash=await hash(`device:${token}`),recoveryHash=await hash(`recovery:${id}:${role}:${recovery}`);
  const writeId=uuid();
  await db.batch([
    db.prepare('INSERT INTO couple_spaces (id,state_json,revision,zone,write_id,created_at,updated_at) SELECT ?,?,0,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM couple_devices WHERE token_hash = ?)').bind(id,JSON.stringify(state),zone,writeId,now,now,tokenHash),
    db.prepare('INSERT INTO couple_members (space_id,role,recovery_hash,created_at) SELECT ?,?,?,? FROM couple_spaces WHERE id = ?').bind(id,role,recoveryHash,now,id),
    db.prepare('INSERT INTO couple_devices (id,space_id,role,token_hash,name,created_at,last_seen,revoked_at) SELECT ?,?,?,?,?,?,?,NULL FROM couple_spaces WHERE id = ?').bind(deviceId,id,role,tokenHash,name,now,now,id),
  ]);
  return existingDeviceResponse(db,token,now);
}
async function joinSpace(db,payload,now){
  const token=credential(payload.deviceToken,'Device token');const existing=await existingDeviceResponse(db,token,now);if(existing)return existing;
  const invite=credential(payload.invite,'Invitation'),recovery=credential(payload.recoveryKey,'Recovery key'),name=deviceName(payload.deviceName);
  requireThat(token!==recovery,400,'invalid_request','Use different device and recovery capabilities.');
  const inviteHash=await hash(`invite:${invite}`),row=await db.prepare('SELECT * FROM couple_invites WHERE invite_hash = ?').bind(inviteHash).first();
  requireThat(row&&row.used_at===null&&row.revoked_at===null&&row.expires_at>now,400,'invalid_invite','This invitation is invalid, expired, or already used.');
  const tokenHash=await hash(`device:${token}`),recoveryHash=await hash(`recovery:${row.space_id}:${row.role}:${recovery}`),deviceId=uuid();
  await db.batch([
    db.prepare('UPDATE couple_invites SET used_at = ?, claimed_by = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ? AND NOT EXISTS (SELECT 1 FROM couple_members WHERE space_id = ? AND role = ?) AND NOT EXISTS (SELECT 1 FROM couple_devices WHERE token_hash = ?)').bind(now,tokenHash,row.id,now,row.space_id,row.role,tokenHash),
    db.prepare('INSERT OR IGNORE INTO couple_members (space_id,role,recovery_hash,created_at) SELECT space_id,role,?,? FROM couple_invites WHERE id = ? AND claimed_by = ?').bind(recoveryHash,now,row.id,tokenHash),
    db.prepare('INSERT OR IGNORE INTO couple_devices (id,space_id,role,token_hash,name,created_at,last_seen,revoked_at) SELECT ?,space_id,role,?,?,?,?,NULL FROM couple_invites WHERE id = ? AND claimed_by = ?').bind(deviceId,tokenHash,name,now,now,row.id,tokenHash),
  ]);
  const result=await existingDeviceResponse(db,token,now);requireThat(result,409,'space_full','This invitation was just claimed. Ask your partner for the current space details.');return result;
}
async function recoverSpace(db,payload,now){
  const token=credential(payload.deviceToken,'Device token'),recovery=credential(payload.recoveryKey,'Recovery key'),role=roleValue(payload.role),name=deviceName(payload.deviceName);
  requireThat(typeof payload.spaceId==='string'&&payload.spaceId.length<=160,400,'invalid_request','Enter the space ID from your recovery details.');
  const recoveryHash=await hash(`recovery:${payload.spaceId}:${role}:${recovery}`);
  const member=await db.prepare('SELECT * FROM couple_members WHERE space_id = ? AND role = ? AND recovery_hash = ?').bind(payload.spaceId,role,recoveryHash).first();
  requireThat(member,401,'invalid_recovery','Those recovery details do not match this member.');
  const existing=await deviceForToken(db,token);
  if(existing){usable(existing);requireThat(existing.space_id===payload.spaceId&&existing.role===role,409,'token_in_use','This device token belongs to another connection.');return envelope(db,await spaceRow(db,existing.space_id),existing,now);}
  const id=uuid(),tokenHash=await hash(`device:${token}`);
  await db.prepare('INSERT OR IGNORE INTO couple_devices (id,space_id,role,token_hash,name,created_at,last_seen,revoked_at) SELECT ?,?,?,?,?,?,?,NULL WHERE (SELECT COUNT(*) FROM couple_devices WHERE space_id = ? AND role = ? AND revoked_at IS NULL) < ?').bind(id,payload.spaceId,role,tokenHash,name,now,now,payload.spaceId,role,LIMITS.devices).run();
  const device=await deviceForToken(db,token);requireThat(device,409,'device_limit','This member has ten active devices. Revoke an old device before adding another.');
  requireThat(device.space_id===payload.spaceId&&device.role===role,409,'token_in_use','This token was connected elsewhere.');return envelope(db,await spaceRow(db,device.space_id),device,now);
}
async function operation(db,device,mutationId){return db.prepare('SELECT * FROM couple_operations WHERE space_id = ? AND device_id = ? AND mutation_id = ?').bind(device.space_id,device.id,mutationId).first();}
async function duplicate(db,device,mutationId,payloadHash,now){const old=await operation(db,device,mutationId);if(!old)return null;requireThat(old.payload_hash===payloadHash,409,'mutation_reused','This operation ID was already used for a different change.');return envelope(db,await spaceRow(db,device.space_id),device,now);}
async function conflict(db,device,now){return new ApiError(409,'conflict','The shared space changed. Merge your pending change with its current version.',{current:await envelope(db,await spaceRow(db,device.space_id),device,now)});}
async function commit(db,device,row,next,reason,now,op=null){
  next=normalizeState(next);const stateJson=JSON.stringify(wireState(next)),writeId=uuid(),snapshotId=uuid(),snapshot=pausedCopy(JSON.parse(row.state_json),now,row.zone),revision=row.revision+1;
  const mutations=op?' AND NOT EXISTS (SELECT 1 FROM couple_operations WHERE space_id = ? AND device_id = ? AND mutation_id = ?)':'';
  const update=db.prepare(`UPDATE couple_spaces SET state_json = ?, revision = ?, write_id = ?, updated_at = ? WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM couple_devices WHERE id = ? AND revoked_at IS NULL)${mutations}`).bind(stateJson,revision,writeId,now,row.id,row.revision,device.id,...(op?[row.id,device.id,op.id]:[]));
  const statements=[update,
    db.prepare('INSERT INTO couple_snapshots (id,space_id,revision,state_json,reason,task_count,created_at) SELECT ?,?,?,?,?,?,? FROM couple_spaces WHERE id = ? AND write_id = ?').bind(snapshotId,row.id,row.revision,JSON.stringify(snapshot),reason,taskCount(snapshot),now,row.id,writeId),
  ];
  if(op)statements.push(db.prepare('INSERT INTO couple_operations (space_id,device_id,mutation_id,payload_hash,response_json,created_at) SELECT ?,?,?,?,?,? FROM couple_spaces WHERE id = ? AND write_id = ?').bind(row.id,device.id,op.id,op.hash,JSON.stringify({revision}),now,row.id,writeId));
  statements.push(db.prepare('DELETE FROM couple_snapshots WHERE space_id = ? AND id NOT IN (SELECT id FROM couple_snapshots WHERE space_id = ? ORDER BY created_at DESC,revision DESC,id DESC LIMIT 50) AND EXISTS (SELECT 1 FROM couple_spaces WHERE id = ? AND write_id = ?)').bind(row.id,row.id,row.id,writeId));
  const result=await db.batch(statements);
  if(result[0].meta.changes!==1){
    const active=await db.prepare('SELECT revoked_at FROM couple_devices WHERE id = ?').bind(device.id).first();requireThat(active&&active.revoked_at===null,401,'revoked','This device was revoked.');
    if(op){const already=await duplicate(db,device,op.id,op.hash,now);if(already)return already;}
    throw await conflict(db,device,now);
  }
  return envelope(db,{...row,state_json:stateJson,revision,write_id:writeId,updated_at:now},device,now);
}
async function maintain(db,device,now){
  for(let attempt=0;attempt<4;attempt++){
    const row=await spaceRow(db,device.space_id),state=JSON.parse(row.state_json);
    const expired=expireTimers(state,now,row.zone),generated=generateRoutines(state,now,row.zone);
    if(!expired&&!generated)return envelope(db,row,device,now);
    try{return await commit(db,device,row,state,expired?'timer-expired':'daily-routines',now);}catch(error){if(error.code!=='conflict'||attempt===3)throw error;}
  }
}
async function taskHistory(db,device,current,proposed){
  const existing=taskMap(current),wanted=new Set(allTasks(proposed).filter(x=>!existing.has(x.task.id)).map(x=>x.task.id)),found=new Map();
  if(!wanted.size)return found;
  const rows=await db.prepare("SELECT state_json FROM couple_snapshots WHERE space_id = ? AND EXISTS (SELECT 1 FROM json_tree(state_json) AS entry WHERE entry.key = 'id' AND entry.value IN (SELECT value FROM json_each(?))) ORDER BY created_at DESC,revision DESC LIMIT 50").bind(device.space_id,JSON.stringify([...wanted])).all();
  for(const row of rows.results){for(const item of allTasks(JSON.parse(row.state_json)))if(wanted.has(item.task.id)&&!found.has(item.task.id))found.set(item.task.id,item);if(found.size===wanted.size)break;}
  return found;
}
async function mutate(db,device,path,payload,now){
  requireThat(Number.isSafeInteger(payload.revision)&&payload.revision>=0,400,'invalid_request','A nonnegative revision is required.');
  requireThat(typeof payload.mutationId==='string'&&mutationPattern.test(payload.mutationId),400,'invalid_request','Use a unique operation ID of 8–128 letters, numbers, dashes, or underscores.');
  const op={id:payload.mutationId,hash:await hash(stable({path,...payload}))};
  const already=await duplicate(db,device,op.id,op.hash,now);if(already)return already;
  const row=await spaceRow(db,device.space_id);if(row.revision!==payload.revision)throw await conflict(db,device,now);
  const current=JSON.parse(row.state_json);let next;
  if(path==='/state'){
    const proposed=normalizeState(payload.state);expireTimers(current,now,row.zone);
    next=authorizeAndApply(current,proposed,device.role,now,row.zone,await taskHistory(db,device,current,proposed));
  }else if(path==='/focus')next=focusCommand(current,device.role,payload,now,row.zone);
  else{
    requireThat(!!payload.snapshotId!==!!payload.state,400,'invalid_request','Restore either a saved snapshot or an uploaded state.');
    let source=payload.state;
    if(payload.snapshotId){const snapshot=await db.prepare('SELECT state_json FROM couple_snapshots WHERE id = ? AND space_id = ?').bind(payload.snapshotId,device.space_id).first();requireThat(snapshot,404,'not_found','That snapshot does not belong to this space.');source=JSON.parse(snapshot.state_json);}
    next=normalizeState(pausedCopy(normalizeState(source),now,row.zone));
  }
  return commit(db,device,row,next,path==='/restore'?'before-restore':path==='/focus'?`focus-${payload.action}`:'before-edit',now,op);
}

export async function handleApi(request,env){
  let headers=new Headers({'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','Vary':'Origin','X-Content-Type-Options':'nosniff'});
  try{
    headers=cors(request,env);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    const url=new URL(request.url),path=url.pathname.replace(/^\/api/,'').replace(/\/$/,'')||'/',method=request.method,db=env.DB,now=clock(env);
    requireThat(db,503,'database_unavailable','The shared space is temporarily unavailable. Try again shortly.');
    if(path==='/health'&&method==='GET'){await db.prepare('SELECT id FROM couple_spaces LIMIT 1').first();return reply({ok:true,serverNow:now},200,headers);}
    if(['/spaces','/join','/recover'].includes(path)&&method==='POST'){
      const payload=await body(request);
      // Replaying a successfully connected provisional token is not another
      // pairing attempt. Allow exact recovery after a lost response even if
      // this network's hourly IP limit has since been exhausted. The token is
      // a 256-bit secret; a valid one already grants full device access.
      if(typeof payload.deviceToken==='string'&&tokenPattern.test(payload.deviceToken)){
        const connected=await existingDeviceResponse(db,payload.deviceToken,now);
        if(connected)return reply(connected,200,headers);
      }
      await rateLimit(request,db,path,now);
      const result=path==='/spaces'?await createSpace(db,payload,now):path==='/join'?await joinSpace(db,payload,now):await recoverSpace(db,payload,now);
      return reply(result,200,headers);
    }
    const device=await authenticate(request,db,now);
    if(path==='/state'&&method==='GET')return reply(await maintain(db,device,now),200,headers);
    if((path==='/state'&&method==='PUT')||(['/focus','/restore'].includes(path)&&method==='POST'))return reply(await mutate(db,device,path,await body(request),now),200,headers);
    if(path==='/invite'&&method==='POST'){
      const invite=secret(),id=uuid(),role=1-device.role,expiresAt=now+86400000;
      const result=await db.batch([
        db.prepare('INSERT INTO couple_invites (id,space_id,role,invite_hash,created_at,expires_at,used_at,revoked_at,claimed_by) SELECT ?,?,?,?,?,?,NULL,NULL,NULL WHERE NOT EXISTS (SELECT 1 FROM couple_members WHERE space_id = ? AND role = ?) AND EXISTS (SELECT 1 FROM couple_devices WHERE id = ? AND revoked_at IS NULL)').bind(id,device.space_id,role,await hash(`invite:${invite}`),now,expiresAt,device.space_id,role,device.id),
        db.prepare('UPDATE couple_invites SET revoked_at = ? WHERE space_id = ? AND id <> ? AND used_at IS NULL AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM couple_invites WHERE id = ?)').bind(now,device.space_id,id,id),
      ]);
      requireThat(result[0].meta.changes===1,409,'space_full','Both member slots are already connected. Use your own recovery details to add another device.');return reply({invite,expiresAt},200,headers);
    }
    if(path==='/history'&&method==='GET'){
      const result=await db.prepare('SELECT id,revision,created_at,reason,task_count FROM couple_snapshots WHERE space_id = ? ORDER BY created_at DESC,revision DESC,id DESC LIMIT 50').bind(device.space_id).all();
      return reply({snapshots:result.results.map(x=>({id:x.id,revision:x.revision,createdAt:x.created_at,reason:x.reason,taskCount:x.task_count}))},200,headers);
    }
    if(path.startsWith('/history/')&&method==='GET'){
      const id=decodeURIComponent(path.slice('/history/'.length)),snapshot=await db.prepare('SELECT * FROM couple_snapshots WHERE id = ? AND space_id = ?').bind(id,device.space_id).first();requireThat(snapshot,404,'not_found','This snapshot is not available in your space.');
      return reply({snapshot:{id:snapshot.id,revision:snapshot.revision,createdAt:snapshot.created_at,state:wireState(JSON.parse(snapshot.state_json))}},200,headers);
    }
    if(path==='/devices'&&method==='GET'){
      const result=await db.prepare('SELECT id,name,created_at,last_seen FROM couple_devices WHERE space_id = ? AND role = ? AND revoked_at IS NULL ORDER BY created_at DESC').bind(device.space_id,device.role).all();return reply({devices:result.results.map(x=>({id:x.id,name:x.name,createdAt:x.created_at,lastSeen:x.last_seen,current:x.id===device.id}))},200,headers);
    }
    if(path.startsWith('/devices/')&&method==='DELETE'){
      const id=decodeURIComponent(path.slice('/devices/'.length));const result=await db.prepare('UPDATE couple_devices SET revoked_at = ? WHERE id = ? AND space_id = ? AND role = ? AND revoked_at IS NULL').bind(now,id,device.space_id,device.role).run();requireThat(result.meta.changes===1,404,'not_found','That active device does not belong to your member account.');return reply({ok:true},200,headers);
    }
    throw new ApiError(404,'not_found','This API endpoint is not available.');
  }catch(error){
    if(error instanceof ApiError)return reply({error:error.message,code:error.code,...error.extra},error.status,headers);
    return reply({error:'The shared space could not complete this request. Try again; your operation ID prevents duplicate changes.',code:'server_error'},500,headers);
  }
}
