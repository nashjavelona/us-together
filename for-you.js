/**
 * For You: paired messages and letters built on the existing, authorized notes
 * collection. We deliberately do NOT add unrecognized fields to the D1 state:
 * older database deployments validate note shape strictly. Both partners must
 * update their frontend to see this inbox rather than the marker text.
 *
 * Metadata (seen/reaction) is its own note authored by the recipient. That
 * respects the server rule that only a note's author may modify that note.
 */
import {uid} from './core.js';

const PREFIX='\u2063UT-FOR-YOU/1/';
export const BODY_LIMIT=440;
export const NOTE_LIMIT=1000;
export const REACTIONS=Object.freeze({heart:'♥',hug:'🫶',sparkle:'✦'});
const modes=Object.freeze({message:'m',letter:'l'});
const isActor=role=>role===0||role===1;

export function isForYouNote(note){return typeof note?.text==='string'&&note.text.startsWith(PREFIX);}
export function decodeForYou(note){
 if(!isForYouNote(note)||!isActor(note.from)||typeof note.id!=='string'||!Number.isFinite(Date.parse(note.date)))return null;
 const content=note.text.slice(PREFIX.length),type=content.slice(0,1);
 if(content[1]!=='|')return null;
 const body=content.slice(2);
 if((type==='m'||type==='l')&&body.trim()&&body.length<=BODY_LIMIT)return {kind:type==='m'?'message':'letter',id:note.id,from:note.from,to:1-note.from,text:body,date:note.date};
 if(type==='s'&&/^[\w-]{1,160}$/.test(body))return {kind:'seen',target:body,from:note.from,date:note.date,id:note.id};
 if(type==='r'){
  const split=body.lastIndexOf('|'),target=body.slice(0,split),reaction=body.slice(split+1);
  if(split>0&&/^[\w-]{1,160}$/.test(target)&&Object.hasOwn(REACTIONS,reaction))return {kind:'reaction',target,from:note.from,date:note.date,id:note.id,reaction};
 }
 return null;
}
export const wallNotes=state=>(state.notes||[]).filter(note=>!isForYouNote(note));

/**
 * A sender can remove their own message, but may not remove the recipient's
 * read/reaction notes. Once that message disappears, those old receipts are
 * invisible. Clean up only receipts belonging to this actor when they next
 * open their inbox or send something; this is also safe under the backend's
 * author-only edit rule. Duplicate receipts from parallel devices are folded
 * into a single meaningful seen/reaction record.
 * @returns {number} The number of own metadata records removed.
 */
export function pruneOrphanForYouMetadata(state,role){
 if(!isActor(role)||!Array.isArray(state?.notes))return 0;
 const messages=new Map();
 for(const note of state.notes){
  const record=decodeForYou(note);
  if(record&&(record.kind==='message'||record.kind==='letter'))messages.set(record.id,record.to);
 }
 const seen=new Set(),bestReaction=new Map();
 for(const note of state.notes){
  if(note.from!==role)continue;
  const record=decodeForYou(note);
  if(record?.kind!=='reaction'||messages.get(record.target)!==role)continue;
  const prior=bestReaction.get(record.target);
  if(!prior||record.date>prior.date||(record.date===prior.date&&record.id>prior.id))bestReaction.set(record.target,record);
 }
 const before=state.notes.length;
 state.notes=state.notes.filter(note=>{
  if(note.from!==role)return true;
  const record=decodeForYou(note);
  if(!record||!['seen','reaction'].includes(record.kind))return true;
  if(messages.get(record.target)!==role)return false;
  if(record.kind==='reaction')return bestReaction.get(record.target)?.id===record.id;
  if(seen.has(record.target))return false;
  seen.add(record.target);
  return true;
 });
 return before-state.notes.length;
}

export function mailItems(state){
 const raw=(state.notes||[]).map(decodeForYou).filter(Boolean);
 const seen=new Set(raw.filter(row=>row.kind==='seen').map(row=>row.from+':'+row.target));
 const reactions=new Map();
 for(const row of raw.filter(row=>row.kind==='reaction').sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)))reactions.set(row.from+':'+row.target,row.reaction);
 return raw.filter(row=>row.kind==='message'||row.kind==='letter').map(row=>({
  ...row,seen:seen.has(row.to+':'+row.id),reaction:reactions.get(row.to+':'+row.id)||null,
 })).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
}
export function unreadFor(state,role){return isActor(role)?mailItems(state).filter(row=>row.to===role&&!row.seen).length:0;}
function capacity(state,add=1){if(!Array.isArray(state?.notes)||state.notes.length+add>NOTE_LIMIT)throw Error('Your note collection is full. Export a backup and remove older notes before sending more.');}
function add(state,from,text,date){
 if(!isActor(from))throw Error('Choose your own profile to send a message.');
 pruneOrphanForYouMetadata(state,from);
 capacity(state);
 const note={id:uid(),from,text,date};state.notes.push(note);return note;
}
export function sendForYou(state,from,kind,body,date=new Date().toISOString()){
 if(!Object.hasOwn(modes,kind))throw Error('Choose a message or a letter.');
 if(typeof body!=='string')throw Error('Write something for your person.');
 const content=body.replace(/\r\n?/g,'\n').trim();
 if(!content)throw Error('Write something for your person before sending.');
 if(content.length>BODY_LIMIT)throw Error(`Keep your ${kind} to ${BODY_LIMIT} characters or fewer.`);
 if(!Number.isFinite(Date.parse(date)))throw Error('Could not determine the message date.');
 const text=PREFIX+modes[kind]+'|'+content;
 if(text.length>500)throw Error('This message is too long to save.');
 return add(state,from,text,date);
}
function incoming(state,role,id){return mailItems(state).find(row=>row.id===id&&row.to===role)||null;}
export function markForYouRead(state,role,id,date=new Date().toISOString()){
 const message=incoming(state,role,id);if(!message||message.seen)return false;
 add(state,role,PREFIX+'s|'+id,date);return true;
}
export function reactForYou(state,role,id,reaction,date=new Date().toISOString()){
 if(!Object.hasOwn(REACTIONS,reaction))throw Error('Choose one of the little reactions.');
 const message=incoming(state,role,id);if(!message)throw Error('You can react to messages and letters sent to you.');
 const existing=(state.notes||[]).find(n=>n.from===role&&decodeForYou(n)?.kind==='reaction'&&decodeForYou(n).target===id);
 if(existing){
  // Toggle the same reaction off; preserve the authored note's timestamp otherwise.
  if(decodeForYou(existing).reaction===reaction){state.notes=state.notes.filter(n=>n.id!==existing.id);return null;}
  existing.text=PREFIX+'r|'+id+'|'+reaction;return existing;
 }
 return add(state,role,PREFIX+'r|'+id+'|'+reaction,date);
}
export function removeForYou(state,role,id){
 const note=(state.notes||[]).find(n=>n.id===id),record=decodeForYou(note);
 if(!record||!['letter','message'].includes(record.kind)||record.from!==role)return false;
 state.notes=state.notes.filter(n=>n.id!==id);
 // The other person's receipts remain theirs. They are ignored when the
 // message is gone and never displayed or deleted without their permission.
 return true;
}
