import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {handleApi} from '../server/api.js';
import {initial} from '../couple.js';

class Statement {
  constructor(db,sql,values=[]){this.db=db;this.sql=sql;this.values=values;}
  bind(...values){return new Statement(this.db,this.sql,values);}
  execute(){const statement=this.db.prepare(this.sql);if(statement.columns().length){const results=statement.all(...this.values);return {success:true,results,meta:{changes:Number(this.db.prepare('SELECT changes() AS changes').get().changes)}};}const value=statement.run(...this.values);return {success:true,results:[],meta:{changes:Number(value.changes)}};}
  async first(column){const row=this.db.prepare(this.sql).get(...this.values);return row?(column?row[column]:row):null;}
  async all(){return {success:true,results:this.db.prepare(this.sql).all(...this.values)};}
  async run(){return this.execute();}
}
export function sqliteD1(){
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys = ON');
  const folder=fileURLToPath(new URL('../drizzle/',import.meta.url));for(const file of readdirSync(folder).filter(x=>x.endsWith('.sql')).sort())db.exec(readFileSync(`${folder}/${file}`,'utf8'));
  return {raw:db,prepare:sql=>new Statement(db,sql),async batch(statements){db.exec('BEGIN IMMEDIATE');try{const results=statements.map(statement=>statement.execute());db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}},close(){db.close();}};
}
export const capability=()=>Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
export function sampleTask(id='task-one',title='Plan the weekend'){return {id,title,minutes:25,spent:0,priority:'Medium',due:'',repeat:'',preferred:'',notBefore:'2026-10-18',status:'open',created:'2026-10-18T01:00:00.000Z',steps:[]};}
export function sampleState(){const state=initial();state.setup=true;state.names=['Nash','Love'];return state;}
export function backendFixture(){
  const DB=sqliteD1();let current=Date.parse('2026-10-18T02:00:00Z');
  const env={DB,NOW:()=>current};
  async function request(method,path,payload,token,extraHeaders={}){
    const headers={'Origin':'https://nashjavelona.github.io',...extraHeaders};if(token)headers.Authorization=`Bearer ${token}`;if(payload!==undefined)headers['Content-Type']='application/json';
    const response=await handleApi(new Request(`https://momentum-my-second-brain.void-mag-inv-5623.chatgpt.site/api${path}`,{method,headers,...(payload!==undefined?{body:JSON.stringify(payload)}:{})}),env);
    const value=response.status===204?null:await response.json();return {status:response.status,body:value,headers:response.headers};
  }
  async function create({state=sampleState(),role=0,zone='Asia/Manila',token=capability(),recoveryKey=capability(),deviceName='My laptop'}={}){const response=await request('POST','/spaces',{state,role,zone,deviceToken:token,recoveryKey,deviceName});return {...response,token,recoveryKey};}
  async function pair(options={}){const first=await create(options);const invitation=await request('POST','/invite',{},first.token);const token=capability(),recoveryKey=capability();const second=await request('POST','/join',{invite:invitation.body.invite,deviceToken:token,recoveryKey,deviceName:'Partner phone'});return {first,second:{...second,token,recoveryKey},invite:invitation.body.invite};}
  return {DB,env,request,create,pair,now:()=>current,setNow:value=>{current=typeof value==='string'?Date.parse(value):value;},advance:ms=>{current+=ms;},close:()=>DB.close()};
}
