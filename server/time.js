import {ApiError} from './errors.js';

const formatters=new Map();
function formatter(zone){
  if(!formatters.has(zone))formatters.set(zone,new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}));
  return formatters.get(zone);
}
export function canonicalZone(zone){
  if(typeof zone!=='string'||zone.length>80)throw new ApiError(400,'invalid_zone','Choose a valid IANA time zone.');
  try{return new Intl.DateTimeFormat('en',{timeZone:zone}).resolvedOptions().timeZone;}catch{throw new ApiError(400,'invalid_zone','Choose a valid IANA time zone.');}
}
export function zonedParts(timestamp,zone){
  const p=Object.fromEntries(formatter(zone).formatToParts(new Date(timestamp)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return {year:+p.year,month:+p.month,day:+p.day,hour:+p.hour,minute:+p.minute,second:+p.second};
}
export function zoneDay(timestamp,zone){const p=zonedParts(timestamp,zone);return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;}
export function addCivilDays(date,days){const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export const civilWeekday=date=>new Date(`${date}T12:00:00Z`).getUTCDay();
export const civilDifference=(a,b)=>Math.round((Date.parse(`${a}T12:00:00Z`)-Date.parse(`${b}T12:00:00Z`))/86400000);
const wallValue=p=>Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);

// Deterministic DST handling: first matching instant in an overlap; move
// forward across a nonexistent wall-clock time. No process-global zone state.
export function zonedAt(date,time,zone){
  const [year,month,day]=date.split('-').map(Number),[hour,minute]=time.split(':').map(Number);
  const desired=Date.UTC(year,month-1,day,hour,minute,0),offsets=new Set();
  for(const hours of [-36,-12,0,12,36]){const point=desired+hours*3600000;offsets.add(wallValue(zonedParts(point,zone))-point);}
  const candidates=[...offsets].map(offset=>desired-offset).sort((a,b)=>a-b);
  const exact=candidates.find(x=>wallValue(zonedParts(x,zone))===desired);
  if(exact!==undefined)return exact;
  return candidates.filter(x=>wallValue(zonedParts(x,zone))>desired).sort((a,b)=>a-b)[0]??candidates.at(-1);
}
export function nextMidnight(timestamp,zone){return zonedAt(addCivilDays(zoneDay(timestamp,zone),1),'00:00',zone);}
