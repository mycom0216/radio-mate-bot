import {DatabaseSync} from 'node:sqlite';
import {createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {mkdirSync,readFileSync,writeFileSync,existsSync,rmSync,renameSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const HEADER=Buffer.from('RMBACKUP1');
function keyBytes(key){if(!/^[a-f0-9]{64}$/i.test(key||''))throw Error('TOKEN_KEY(64자리 hex)가 필요합니다.');return Buffer.from(key,'hex');}
function assertOffline(dir,allowOwnServer){
  const lock=join(dir,'server.lock');if(!existsSync(lock))return;
  const pid=Number(readFileSync(lock,'utf8'));if(allowOwnServer&&pid===process.pid)return;if(!Number.isSafeInteger(pid)||pid<1)throw Error('server.lock을 확인하세요.');
  try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')return;throw e;}
  throw Error('서버를 종료한 뒤 전체 백업을 실행하세요.');
}
export function fullBackup(dataDir,output,key,{allowOwnServer=false}={}){
  const secret=keyBytes(key),dir=resolve(dataDir);assertOffline(dir,allowOwnServer);
  const tmp=join(dirname(resolve(output)),`.backup-${randomUUID()}.sqlite`);
  const db=new DatabaseSync(join(dir,'studio.sqlite'),{readOnly:true});
  try{
    db.exec(`VACUUM INTO '${tmp.replaceAll("'","''")}'`);
    const files=[{name:'studio.sqlite',data:readFileSync(tmp).toString('base64')}];
    for(const row of db.prepare('SELECT id FROM voice_cards').all()){
      if(!/^[a-f0-9-]{36}$/.test(row.id))throw Error('잘못된 음성 파일 ID입니다.');
      files.push({name:`voice/${row.id}`,data:readFileSync(join(dir,'voice',row.id)).toString('base64')});
    }
    const raw=Buffer.from(JSON.stringify({version:1,created:Date.now(),files}));if(raw.length>512*1024*1024)throw Error('현재 백업 형식의 최대 크기(압축 전 512MB)를 초과했습니다.');const packed=gzipSync(raw);
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,iv);
    const encrypted=Buffer.concat([cipher.update(packed),cipher.final()]);
    writeFileSync(output,Buffer.concat([HEADER,iv,cipher.getAuthTag(),encrypted]),{mode:0o600,flag:'wx'});
    return {files:files.length};
  }finally{db.close();rmSync(tmp,{force:true});}
}
export function restoreBackup(archive,target,key){
  const secret=keyBytes(key),dest=resolve(target);if(existsSync(dest))throw Error('복원 대상은 존재하지 않는 새 폴더여야 합니다.');
  const bytes=readFileSync(archive);if(bytes.length<37||!bytes.subarray(0,9).equals(HEADER))throw Error('백업 형식이 올바르지 않습니다.');
  const cipher=createDecipheriv('aes-256-gcm',secret,bytes.subarray(9,21));cipher.setAuthTag(bytes.subarray(21,37));
  const manifest=JSON.parse(gunzipSync(Buffer.concat([cipher.update(bytes.subarray(37)),cipher.final()]),{maxOutputLength:512*1024*1024}));
  if(manifest.version!==1||!Array.isArray(manifest.files)||!manifest.files.length)throw Error('백업 목록이 잘못되었습니다.');
  const names=new Set();for(const f of manifest.files){
    if(typeof f.name!=='string'||!(f.name==='studio.sqlite'||/^voice\/[a-f0-9-]{36}$/.test(f.name))||names.has(f.name)||typeof f.data!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.data))throw Error('안전하지 않은 백업 항목입니다.');
    names.add(f.name);
  }
  if(!names.has('studio.sqlite'))throw Error('DB가 없는 백업입니다.');
  const stage=join(dirname(dest),`.restore-${randomUUID()}`);mkdirSync(stage,{recursive:true});
  try{
    mkdirSync(join(stage,'voice'));
    for(const f of manifest.files)writeFileSync(join(stage,f.name),Buffer.from(f.data,'base64'),{mode:0o600,flag:'wx'});
    const db=new DatabaseSync(join(stage,'studio.sqlite'),{readOnly:true});
    try{
      if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('DB 무결성 검사에 실패했습니다.');
      db.prepare('SELECT id FROM rooms').all();
      const rows=db.prepare('SELECT id,bytes FROM voice_cards').all();
      if(rows.length!==names.size-1)throw Error('음성 파일 목록이 일치하지 않습니다.');
      for(const r of rows)if(!/^[a-f0-9-]{36}$/.test(r.id)||!names.has(`voice/${r.id}`)||readFileSync(join(stage,'voice',r.id)).length!==r.bytes)throw Error('음성 파일이 누락되거나 손상되었습니다.');
    }finally{db.close();}
    renameSync(stage,dest);return {files:names.size};
  }finally{if(existsSync(stage))rmSync(stage,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [action,source,target]=process.argv.slice(2);if(!source||!target)throw Error('사용법: node --env-file=.env backup.mjs backup DATA_DIR output.rmbak | restore input.rmbak NEW_DATA_DIR');
    const result=action==='backup'?fullBackup(source,target,process.env.TOKEN_KEY):action==='restore'?restoreBackup(source,target,process.env.TOKEN_KEY):null;
    if(!result)throw Error('backup 또는 restore를 선택하세요.');console.log(JSON.stringify(result));
  }catch(e){console.error(e.message);process.exitCode=1;}
}
