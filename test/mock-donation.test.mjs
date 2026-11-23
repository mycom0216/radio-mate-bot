// 결제 없이 하는 모의 후원 전체 시험입니다. 로컬 테스트 서버(방송에 연결되지 않은 데모)를 실제로 띄우고,
// 웹 화면이 쓰는 것과 같은 API(/api/test, /api/test-donation, /api/settings)로 후원·복권·대결·지급을 한 번에 시험합니다.
// 환경변수 MOCK_REPORT=1 로 실행하면 봇이 채팅으로 보낼 문구를 순서대로 출력합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {Engine,Store} from '../core.mjs';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('모의 후원으로 후원 보상·메뉴판·큰 후원·지급·후원 대결을 결제 없이 끝까지 시험합니다',{timeout:90000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'radio-mock-donation-'));
 const proc=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:dir,SPOON_CLIENT_ID:'',SPOON_CLIENT_SECRET:'',OPENAI_API_KEY:'',AUTO_OPERATIONS:'0'},stdio:['ignore','pipe','pipe']});
 const report=[];const log=(title,text)=>{report.push(`■ ${title}\n${String(text).split('\n').map(line=>'   '+line).join('\n')}`);};
 try{
  const address=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('서버 시작 시간 초과')),15000);proc.stdout.on('data',chunk=>{out+=chunk;const m=out.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});proc.once('exit',code=>reject(Error('서버가 종료됨 '+code)));});
  const login=await fetch(address+'/api/demo',{method:'POST'});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0],{csrf}=await login.json();
  const headers={Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'};
  const post=async(path,body)=>{const res=await fetch(address+path,{method:'POST',headers,body:JSON.stringify(body)});return {status:res.status,body:await res.json()};};
  const room=async()=>(await(await fetch(address+'/api/room',{headers})).json());
  // 청취자 명령은 대기시간(최소 1초)을 지켜야 하므로 설정을 최소값으로 낮추고 매번 조금 기다립니다.
  const before=await room();
  let r=await post('/api/settings',{settings:{...before.settings,cooldown:1,responseGap:1,fishing:true,donationTicketEnabled:true,donationTicketMin:100,donationTicketCount:2},expectedRevision:before.settingsRevision||0,name:before.name});assert.equal(r.status,200,JSON.stringify(r.body));
  const A={user:'user-A',name:'시험청취자'},B={user:'user-B',name:'시험청취자2'},DJ={user:'dj-owner',name:'DJ',dj:true};
  const chat=async(who,message)=>{if(!who.dj)await wait(1150);const out=await post('/api/test',{message,...who});assert.equal(out.status,200,JSON.stringify(out.body));return out.body.text;};
  const donate=async(who,amount)=>{const out=await post('/api/test-donation',{amount,user:who.user,name:who.name});assert.equal(out.status,200,JSON.stringify(out.body));return out.body;};

  log('청취자 프로필 생성',await chat(A,'!내정보 생성'));await chat(B,'!내정보 생성');

  // 1) 후원 보상
  // 후원할 때마다 복권을 주므로 9스푼도 감사 인사 + 복권 안내가 나갑니다. (기준 스푼 이상일 때만 주려면 설정에서 「후원할 때마다」를 끕니다)
  let d=await donate(A,9);assert.equal(d.messages.length,2);assert.match(d.messages[0],/시험청취자님, 9 스푼 감사합니다!/);assert.match(d.messages[1],/🎟️ 시험청취자님 9스푼 후원! 복권 1장 지급 \(보유 1장\)/);log('9스푼 모의 후원 (후원할 때마다 복권)',d.messages.join('\n'));
  d=await donate(A,10);assert.equal(d.messages.length,2);assert.match(d.messages[1],/🎟️ 시험청취자님 10스푼 후원! 복권 1장 지급 \(보유 2장\)/);log('10스푼 모의 후원',d.messages.join('\n'));
  d=await donate(A,20);assert.match(d.messages[1],/✨ 시험청취자님 20스푼 후원! \+400 EXP · Lv\.1 \(다음 레벨까지 9,600 EXP\)\n🎟️ .*복권 1장 지급 \(보유 3장\)/);log('20스푼 모의 후원',d.messages.join('\n'));

  // 2) 메뉴판 문구가 감사 인사보다 우선
  assert.match(await chat(DJ,'!메뉴판 추가 50 불꽃 {name}님 {amount}스푼'),/50스푼 리액션을 등록/);
  d=await donate(A,50);assert.equal(d.messages[0],'불꽃 시험청취자님 50스푼');log('50스푼 모의 후원 (메뉴판 문구)',d.messages.join('\n'));

  // 3) 큰 후원(기준 100)이면 모든 청취자에게 복권
  d=await donate(A,100);assert.match(d.messages.at(-1),/🎉 시험청취자님의 100스푼 후원! 모든 청취자 2명에게 복권 2장씩 지급했어요/);log('100스푼 모의 후원 (큰 후원 복권)',d.messages.join('\n'));

  // 4) 복권 지급 도구
  let text=await chat(DJ,'!복권지급 전체 3');assert.match(text,/전체 2명에게 복권 3장씩 지급 · 총 6장/);log('DJ !복권지급 전체 3',text);
  text=await chat(DJ,'!계정연결 시험청취자 @test_id');assert.match(text,/@test_id를 연결했어요/);log('DJ !계정연결 시험청취자 @test_id',text);
  text=await chat(DJ,'!복권지급 @test_id 2');assert.match(text,/시험청취자님 복권 2장 지급/);log('DJ !복권지급 @test_id 2',text);

  // 5) 후원 대결
  assert.match(text=await chat(DJ,'!대결 개인 시작 2'),/후원 대결 시작! 2분/);log('DJ !대결 개인 시작 2',text);
  log('시험청취자 !대결',await chat(A,'!대결'));log('시험청취자2 !대결',await chat(B,'!대결'));
  d=await donate(A,30);assert.equal(d.battleCounted,true);d=await donate(B,50);assert.equal(d.battleCounted,true);d=await donate(A,40);assert.equal(d.battleCounted,true);
  log('모의 후원 3번 (A 30·40, B 50)','후원 대결에 합산됨');
  assert.match(text=await chat(B,'!대결 현황'),/1위 시험청취자 70스푼 \/ 2위 시험청취자2 50스푼/);log('!대결 현황',text);
  text=await chat(DJ,'!대결 종료');assert.match(text,/🏆 대결 결과 1등 시험청취자 70스푼 \+300PT\+300EXP · 2등 시험청취자2 50스푼 \+150PT\+150EXP\n🎁 선물 약속: 1등 외 참가자는 1등에게 10스푼 \(직접 전달\)/);log('DJ !대결 종료',text);

  // 5-2) 팀 대결(청팀·백팀): 팀을 고르고, 목표 100스푼을 먼저 모은 팀이 승리
  assert.match(text=await chat(DJ,'!대결 시작 5'),/청팀 vs 백팀 대결 시작! 100스푼을 먼저 모으는 팀이 승리/);log('DJ !대결 시작 5 (팀 대결)',text);
  assert.match(text=await chat(A,'!대결 청'),/청팀 참가/);log('시험청취자 !대결 청',text);
  assert.match(text=await chat(B,'!대결 백'),/백팀 참가/);log('시험청취자2 !대결 백',text);
  d=await donate(A,40);assert.equal(d.battleCounted,true);d=await donate(B,60);
  assert.match(text=await chat(B,'!대결 현황'),/청팀 40\/100스푼\(1명\) vs 백팀 60\/100스푼\(1명\)/);log('!대결 현황',text);
  d=await donate(A,70); // 청팀 110 → 청팀 승리
  assert.match(d.messages.at(-1),/🏆 청팀 승리! 먼저 100스푼 달성 \(청팀 110 · 백팀 60\)\n승리 팀 후원자 1명 \+300PT\+300EXP\n🎁 선물 약속: 진 팀이 이긴 팀에 100스푼/);log('청팀이 먼저 100스푼 달성 (모의 후원 70스푼)',d.messages.at(-1));

  // 5-3) DJ 랭킹 · 넥스트초이스 등급 (월라디 순위로 자동 계산) + 이번 달 방송 현황
  log('등록 전 !랭킹조회',await chat(A,'!랭킹조회'));
  await chat(DJ,'!랭킹등록 일 12');await chat(DJ,'!랭킹등록 월 45');
  text=await chat(DJ,'!랭킹등록 지난달 150');log('DJ 랭킹 입력 후 !랭킹조회',text);
  assert.match(text,/일라디 12위 · 월라디 45위\n초이스 이전 Normal Choice → 현재 Star Choice → 다음 Top Choice까지 35등 남음/);
  assert.equal(await chat(B,'!랭크조회'),text);
  assert.match(text=await chat(A,'!초이스'),/^📊 .* 이번 달 방송 0일 · 0시간\nNormal Choice\(15일·30시간\) 15일·30시간 남음\nTop·Star Choice\(20일·45시간\) 20일·45시간 남음/);log('!초이스 (방송 연결 전)',text);

  // 6) 최종 상태: 후원마다 받은 EXP(스푼 × 20)와 대결 보상이 정확히 합산됐는지
  const state=await room();const a=state.users['user-A'],b=state.users['user-B'];
  // A: 20스푼 400 + 50스푼 1,000 + 100스푼 2,000 + 30스푼 600 + 40스푼 800 + 개인 대결 1등 300 = 5,100
  //    + 팀 대결 후원 40스푼 800 + 70스푼 1,400 + 팀 대결 승리 보상 300 = 7,600 (10스푼은 기준 20 미만)
  assert.equal(a.exp,7600);assert.equal(a.pt,600);
  // B: 50스푼 1,000 + 개인 대결 2등 150 + 팀 대결 후원 60스푼 1,200 = 2,350 (진 팀이라 팀 대결 보상 없음)
  assert.equal(b.exp,2350);assert.equal(b.pt,150);
  log('시험 후 상태',`시험청취자: EXP ${a.exp} / PT ${a.pt} / 복권 ${a.tickets}장\n시험청취자2: EXP ${b.exp} / PT ${b.pt} / 복권 ${b.tickets}장`);

  // 7) 같은 후원이 아닌 잘못된 입력은 막고, 방송에 연결된 방에서는 쓸 수 없습니다.
  for(const bad of [0,-5,1.5,'abc',1e12])assert.equal((await post('/api/test-donation',{amount:bad,user:'user-A',name:'x'})).status,400,String(bad));
  assert.equal((await fetch(address+'/api/test-donation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount:10})})).status,401);
  assert.equal((await fetch(address+'/api/test-donation',{method:'POST',headers:{...headers,'X-CSRF-Token':'wrong'},body:JSON.stringify({amount:10})})).status,403);
 }finally{
  const done=proc.exitCode===null?new Promise(resolve=>proc.once('exit',resolve)):Promise.resolve();proc.kill();await done;
  if(process.env.MOCK_REPORT==='1')console.log('\n'+report.join('\n\n')+'\n');
  rmSync(dir,{recursive:true,force:true});
 }
});

test('모의 후원 처리는 중복 알림을 한 번만 보상하고, 방이 없으면 아무것도 하지 않습니다',()=>{
 const store=new Store();let time=Date.parse('2026-11-23T12:00:00Z');
 const engine=new Engine(store,{now:()=>time,int:a=>a});store.create('r',' 방');
 const gift={id:'same-gift',data:{amount:20,user:{id:'u1',nickname:'가'}}};
 const first=engine.processDonation('r',gift),second=engine.processDonation('r',gift);
 assert.deepEqual(first.messages.map(m=>m.key.split(':')[0]),['donation','donation-reward']);
 // 같은 후원이 다시 들어와도 보상(EXP·복권)은 다시 주지 않고 감사 인사만 같은 key로 돌아옵니다. (전송 대기열이 key로 중복을 거릅니다)
 assert.equal(second.messages.length,1);assert.equal(second.messages[0].key,first.messages[0].key);
 const user=store.load('r').users.u1;assert.equal(user.exp,400);assert.equal(user.tickets,1);
 assert.deepEqual(engine.processDonation('없는방',gift),{messages:[],battleCounted:false});
 // id가 없는 후원은 내용으로 구별합니다: 같은 내용이면 같은 key, 다르면 다른 key
 const keyOf=data=>engine.processDonation('r',{id:undefined,data}).messages[0].key;
 assert.equal(keyOf({amount:5,user:{id:'u1',nickname:'가'}}),keyOf({amount:5,user:{id:'u1',nickname:'가'}}));
 assert.notEqual(keyOf({amount:5,user:{id:'u1',nickname:'가'}}),keyOf({amount:6,user:{id:'u1',nickname:'가'}}));
});
