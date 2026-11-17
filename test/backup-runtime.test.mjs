import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {restoreBackup,fullBackup} from '../backup.mjs';
import {Store} from '../core.mjs';
test('running server rejects duplicate data owner and produces restorable encrypted full backup automatically',{timeout:50000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'radio-backup-runtime-')),data=join(dir,'data'),key='ab'.repeat(32);
 const env={...process.env,PORT:'0',HOST:'127.0.0.1',NODE_ENV:'development',DATA_DIR:data,TOKEN_KEY:key,SPOON_CLIENT_ID:'',SPOON_CLIENT_SECRET:''};
 const proc=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env,stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('server timeout')),10000);proc.stdout.on('data',c=>{text+=c;if(text.includes('Spoon Studio:')){clearTimeout(timer);resolve();}});});
  assert.throws(()=>fullBackup(data,join(dir,'manual.rmbak'),key),/종료/);
  const second=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env,stdio:['ignore','ignore','pipe']});let error='';second.stderr.on('data',c=>error+=c);
  const code=await new Promise(r=>second.on('exit',r));assert.notEqual(code,0);assert.match(error,/이미 실행/);
  let file;for(let i=0;i<180;i++){const backups=join(data,'backups');if(existsSync(backups)){file=readdirSync(backups).find(f=>/^full-.*\.rmbak$/.test(f));if(file)break;}await new Promise(r=>setTimeout(r,200));}
  assert.ok(file,'automatic full backup should be created after 30 seconds');
  const restored=join(dir,'restored');restoreBackup(join(data,'backups',file),restored,key);const s=new Store(join(restored,'studio.sqlite'));try{assert.ok(s.load('demo'));}finally{s.db.close();}
 }finally{const exited=new Promise(r=>proc.once('exit',r));proc.kill();await exited;rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});
