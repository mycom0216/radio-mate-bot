import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiBase, spoonRegion } from '../spoon.mjs';
import {AndroidAuth} from '../android-auth.mjs';

test('region selects the matching Spoon API host and rejects unknown regions', () => {
  assert.equal(apiBase({}), 'https://kr-openapi.spooncast.net');
  assert.equal(apiBase({ SPOON_REGION: 'JP' }), 'https://jp-openapi.spooncast.net');
  assert.equal(apiBase({ SPOON_REGION: 'jp', SPOON_API_BASE: 'http://x/', NODE_ENV: 'production' }), 'https://jp-openapi.spooncast.net');
  assert.equal(apiBase({ SPOON_API_BASE: 'http://127.0.0.1:1/' }), 'http://127.0.0.1:1');
  assert.throws(() => spoonRegion({ SPOON_REGION: 'us' }), /kr 또는 jp/);
});

test('OAuth login, SSE chat event and chat reply work end to end against a mock Spoon API', { timeout: 110000 }, async () => {
  const seen = { token: [], chat: [], me: 0, events: 0, revoked: [] };
  // 실제 방송 대신 가짜 스푼 서버에서 채팅과 후원 알림을 보내 봇의 응답을 확인합니다.
  let stream;
  const emit = (id, event, data) => stream.write(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const chat = (id, user, message) => emit(id, 'chat', {user, message, sentTime:Date.now()});
  async function expectReply(index, pattern) {
    // 봇이 답을 보낼 때까지 잠깐씩 기다린 뒤, 원하는 순서에 원하는 문구가 왔는지 확인합니다.
    for(let i=0;i<60&&seen.chat.length<=index;i++)await new Promise(r=>setTimeout(r,100));
    assert.match(seen.chat[index]??'',pattern);
  }
  // 봇은 채팅을 너무 자주 보내지 않도록 기본 3초를 기다립니다. 테스트도 그 간격을 지킵니다.
  const waitForSendGap = () => new Promise(resolve => setTimeout(resolve,3100));
  const mock = createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      if (req.url === '/v1/oauth/token') {
        seen.token.push({ auth: req.headers.authorization, body });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: 'AT', token_type: 'Bearer', expires_in: 3600, refresh_token: 'RT', scope: 'me.read events.chat chat.send' }));
      } else if(req.url==='/v1/oauth/revoke'){seen.revoked.push(body);res.writeHead(200);res.end('{}');
      } else if (req.url === '/v1/me') {
        seen.me++;
        assert.equal(req.headers.authorization, 'Bearer AT');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ userId: 'dj-e2e-12345' }));
      } else if (req.url === '/v1/live/events') {
        seen.events++;
        stream=res;
        seen.stream=res;
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(': hello\n\n');
        setTimeout(() => res.write(`id: e1\nevent: chat\ndata: ${JSON.stringify({ user: { id: 'u1', nickname: '청취자' }, message: '!내정보 생성', sentTime: Date.now() })}\n\n`), 500);
      } else if (req.url === '/v1/live/chat') {
        seen.chat.push(JSON.parse(body).message);
        res.writeHead(204); res.end();
      } else { res.writeHead(404); res.end(); }
    });
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const data = mkdtempSync(join(tmpdir(), 'spoon-e2e-'));
  const proc = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DATA_DIR: data, NODE_ENV: 'development', PUBLIC_URL: 'http://localhost:4310', SPOON_REGION: 'jp', SPOON_CLIENT_ID: 'cid', SPOON_CLIENT_SECRET: 'secret', TOKEN_KEY: 'ab'.repeat(32), SPOON_API_BASE: `http://127.0.0.1:${mock.address().port}` },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    const address = await new Promise((resolve, reject) => {
      let text = ''; const timer = setTimeout(() => reject(Error('server start timeout')), 10000);
      proc.stdout.on('data', c => { text += c; const m = text.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(timer); resolve(m[0]); } });
      proc.on('exit', code => reject(Error('server exited ' + code)));
    });
    let res = await fetch(address + '/oauth/start', { redirect: 'manual' });
    assert.equal(res.status, 302);
    const location = new URL(res.headers.get('location'));
    assert.equal(location.pathname, '/jp/oauth/authorize');
    assert.equal(location.searchParams.get('client_id'), 'cid');
    assert.equal(location.searchParams.get('redirect_uri'), 'http://localhost:4310/oauth/callback');
    assert.match(location.searchParams.get('scope'), /chat\.send/);
    const state = location.searchParams.get('state');
    const oauthCookie = res.headers.get('set-cookie').split(';')[0];
    const parallel=await fetch(address+'/oauth/start',{redirect:'manual'}),parallelCookie=parallel.headers.get('set-cookie').split(';')[0],parallelState=new URL(parallel.headers.get('location')).searchParams.get('state');
    assert.notEqual(oauthCookie.split('=')[0],parallelCookie.split('=')[0],'opening a second login tab must not overwrite the first login cookie');
    const browserCookies=oauthCookie+'; '+parallelCookie;
    res = await fetch(`${address}/oauth/callback?code=abc&state=${state}`, { redirect: 'manual', headers: { Cookie: browserCookies } });
    assert.equal(res.status, 302);
    const session = res.headers.get('set-cookie').split(';')[0];
    assert.equal(seen.token.length, 1);
    assert.equal(seen.token[0].auth, 'Basic ' + Buffer.from('cid:secret').toString('base64'));
    assert.match(seen.token[0].body, /grant_type=authorization_code/);
    assert.match(seen.token[0].body, /code=abc/);
    for (let i = 0; i < 60 && !seen.chat.length; i++) await new Promise(r => setTimeout(r, 250));
    assert.equal(seen.events, 1);
    assert.equal(seen.chat.length, 1, 'bot should answer the chat command through /v1/live/chat');
    res = await fetch(address + '/api/room', { headers: { Cookie: session } });
    const room = await res.json();
    assert.equal(res.status, 200);
    assert.equal(room.users.u1.name, '청취자');
    assert.equal(room.connection, '방송 연결됨');
    const dj={id:'dj-e2e-12345',nickname:'DJ'};
    const listener={id:'u2',nickname:'후원자'};
    // 이 시험의 앞부분은 메뉴판·감사 인사만 확인하므로, 후원자 복권 지급은 잠시 꺼 둡니다. (뒤에서 다시 켜서 확인합니다)
    const csrfToken=(await (await fetch(address+'/api/session',{headers:{Cookie:session}})).json()).csrf;
    res=await fetch(address+'/api/settings',{method:'POST',headers:{Cookie:session,'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify({settings:{...room.settings,donationDonorTicketEnabled:false},expectedRevision:room.settingsRevision||0,name:room.name})});
    assert.equal(res.status,200);
    // 청취자는 메뉴판을 바꿀 수 없고, DJ가 등록하면 청취자도 목록을 볼 수 있어야 합니다.
    await waitForSendGap();
    chat('menu-denied',listener,'!메뉴판 추가 10 잘못된 문구');
    await expectReply(1,/DJ 전용/);
    await waitForSendGap();
    chat('menu-add',dj,'!메뉴판 추가 10 하트 💖 {name}님 {amount}스푼');
    await expectReply(2,/10스푼 리액션을 등록/);
    await waitForSendGap();
    chat('menu-list',listener,'!메뉴판');
    await expectReply(3,/10스푼 · 하트 💖/);
    // 10스푼을 보내면 등록된 문구가 나오고, 항목을 지운 뒤에는 기본 감사 인사가 나와야 합니다.
    await waitForSendGap();
    emit('gift-10','donation',{user:listener,amount:10});
    await expectReply(4,/^하트 💖 후원자님 10스푼$/);
    await waitForSendGap();
    chat('menu-delete',dj,'!메뉴판 삭제 10');
    await expectReply(5,/10스푼 리액션을 삭제/);
    await waitForSendGap();
    emit('gift-after-delete','donation',{user:listener,amount:10});
    await expectReply(6,/^후원자님, 10 스푼 감사합니다!$/);
    // 큰 후원 복권 전체 지급: 설정에서 켠 뒤 기준(50스푼) 미만은 지급하지 않고, 기준 이상이면 모든 청취자에게 2장씩 지급해야 합니다.
    const roomBeforeBonus=await (await fetch(address+'/api/room',{headers:{Cookie:session}})).json();
    res=await fetch(address+'/api/settings',{method:'POST',headers:{Cookie:session,'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify({settings:{...roomBeforeBonus.settings,donationTicketEnabled:true,donationTicketMin:50,donationTicketCount:2,donationExpEnabled:false},expectedRevision:roomBeforeBonus.settingsRevision||0,name:roomBeforeBonus.name})});
    assert.equal(res.status,200);
    const usersNow=async()=>(await (await fetch(address+'/api/room',{headers:{Cookie:session}})).json()).users;
    await waitForSendGap();
    emit('gift-small','donation',{user:listener,amount:30});
    await expectReply(7,/^후원자님, 30 스푼 감사합니다!$/);
    assert.equal((await usersNow()).u1.tickets,0,'기준 미만 후원은 복권을 지급하면 안 됩니다');
    await waitForSendGap();
    emit('gift-big','donation',{user:listener,amount:60});
    await expectReply(8,/^후원자님, 60 스푼 감사합니다!$/);
    // 복권 지급 안내는 감사 인사 다음 순서로 대기열에 들어가며, 봇의 전송 간격(몇 초) 때문에 잠시 뒤에 전송됩니다.
    for(let i=0;i<200&&seen.chat.length<=9;i++)await new Promise(resolve=>setTimeout(resolve,100));
    await expectReply(9,/모든 청취자 1명에게 복권 2장씩 지급/);
    let grantedUsers=await usersNow();
    assert.equal(grantedUsers.u1.tickets,2);
    // 같은 후원 알림이 다시 들어와도 한 번만 지급합니다.
    emit('gift-big','donation',{user:listener,amount:60});
    await new Promise(resolve=>setTimeout(resolve,700));
    grantedUsers=await usersNow();
    assert.equal(grantedUsers.u1.tickets,2);
    // 후원 레벨 보상: 켠 뒤 기준(20스푼) 이상 후원하면 후원자에게 EXP가 지급되고 레벨 안내가 와야 합니다. (복권 전체 지급은 끕니다)
    const roomForExp=await (await fetch(address+'/api/room',{headers:{Cookie:session}})).json();
    res=await fetch(address+'/api/settings',{method:'POST',headers:{Cookie:session,'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify({settings:{...roomForExp.settings,donationExpEnabled:true,donationExpMin:20,donationExpPerSpoon:20,donationDonorTicketEnabled:true,donationDonorTicketMin:10,donationDonorTicketCount:3,donationTicketEnabled:false},expectedRevision:roomForExp.settingsRevision||0,name:roomForExp.name})});
    assert.equal(res.status,200);
    await waitForSendGap();
    emit('gift-exp','donation',{user:listener,amount:25});
    await expectReply(10,/^후원자님, 25 스푼 감사합니다!$/);
    for(let i=0;i<200&&seen.chat.length<=11;i++)await new Promise(resolve=>setTimeout(resolve,100));
    await expectReply(11,/후원자님 25스푼 후원! \+500 EXP · Lv\.1 \(다음 레벨까지 9,500 EXP\)/);
    assert.equal((await usersNow()).u2.exp,500);
    // 후원자 복권(3장)은 같은 메시지의 둘째 줄로 오고, 후원자 본인에게만 지급됩니다.
    assert.match(seen.chat[11],/\n🎟️ 후원자님 25스푼 후원! 복권 3장 지급 \(보유 3장\)/);
    assert.equal((await usersNow()).u2.tickets,3);
    assert.equal((await usersNow()).u1.tickets,2,'다른 청취자에게는 지급되지 않아야 합니다');
    // 후원 대결: DJ가 시작하고 청취자가 참가한 뒤 후원하면 합산되어 현황에 보여야 합니다. (후원 보상 안내는 꺼서 답장 순서를 단순하게 합니다)
    const roomForBattle=await (await fetch(address+'/api/room',{headers:{Cookie:session}})).json();
    res=await fetch(address+'/api/settings',{method:'POST',headers:{Cookie:session,'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify({settings:{...roomForBattle.settings,donationExpEnabled:false,donationDonorTicketEnabled:false},expectedRevision:roomForBattle.settingsRevision||0,name:roomForBattle.name})});
    assert.equal(res.status,200);
    await waitForSendGap();
    chat('battle-start',dj,'!대결 시작 2');
    await expectReply(12,/후원 대결 시작! 2분/);
    await waitForSendGap();
    chat('battle-join',listener,'!대결');
    await expectReply(13,/후원자님 대결 참가/);
    await waitForSendGap();
    emit('gift-battle','donation',{user:listener,amount:30});
    await expectReply(14,/^후원자님, 30 스푼 감사합니다!$/);
    await waitForSendGap();
    chat('battle-status',listener,'!대결 현황');
    await expectReply(15,/대결 진행 중 .*1위 후원자 30스푼/);
    // 방송에 연결된 실제 방에서는 모의 후원을 보낼 수 없어야 하고, 청취자 정보도 바뀌면 안 됩니다.
    const ticketsBeforeMock=(await usersNow()).u2.tickets;
    res=await fetch(address+'/api/test-donation',{method:'POST',headers:{Cookie:session,'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify({amount:10,user:'u2',name:'후원자'})});
    assert.equal(res.status,400);
    assert.equal((await usersNow()).u2.tickets,ticketsBeforeMock);
    const joinedAt=Date.now();
    for(const [index,value] of [36.5,38.75].entries()){
      seen.stream.write(`id: temperature-${index}\nevent: presence\ndata: ${JSON.stringify({user:{id:'u1',nickname:'청취자'},type:'JOIN',favoriteTemperature:value,time:new Date(joinedAt+index*1000).toISOString()})}\n\n`);
      let snapshot;for(let i=0;i<40;i++){snapshot=await(await fetch(address+'/api/room',{headers:{Cookie:session}})).json();if(snapshot.users.u1.spoonTemperature?.value===value)break;await new Promise(resolve=>setTimeout(resolve,25));}
      assert.equal(snapshot.users.u1.spoonTemperature.value,value,'every reentry must refresh official temperature even when welcome greeting is deduplicated');
    }
    res=await fetch(`${address}/oauth/callback?error=invalid_scope&state=${parallelState}`,{redirect:'manual',headers:{Cookie:browserCookies}});
    assert.equal(res.status,400);assert.match(res.headers.get('content-type'),/text\/html/);assert.match(await res.text(),/승인된 권한/);
    // a replayed OAuth state must be refused
    res = await fetch(`${address}/oauth/callback?code=abc&state=${state}`, { redirect: 'manual', headers: { Cookie: oauthCookie } });
    assert.equal(res.status, 400);
    // Native app login: external-browser OAuth -> short-lived code -> WebView cookie.
    const verifier='v'.repeat(43),challenge=AndroidAuth.challenge(verifier);
    res=await fetch(address+'/oauth/start?app_challenge=bad',{redirect:'manual'});assert.equal(res.status,400);
    res=await fetch(address+'/oauth/start?app_challenge='+challenge,{redirect:'manual'});
    const appLocation=new URL(res.headers.get('location')),appState=appLocation.searchParams.get('state'),appCookie=res.headers.get('set-cookie').split(';')[0];
    res=await fetch(`${address}/oauth/callback?code=app-code&state=${appState}`,{redirect:'manual',headers:{Cookie:appCookie}});
    assert.equal(res.status,200);assert.equal(res.headers.get('referrer-policy'),'no-referrer');
    assert.equal(res.headers.get('set-cookie'),null,'browser must not receive the native session');
    const appCode=(await res.text()).match(/radiomate:\/\/auth\?code=([A-Za-z0-9_-]{43})/)[1];
    const exchange=(v,extra={})=>fetch(address+'/api/android/exchange',{method:'POST',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify({code:appCode,verifier:v})});
    assert.equal((await exchange(verifier,{Origin:'https://untrusted.example'})).status,403);
    assert.equal((await exchange('x'.repeat(43))).status,400);
    res=await exchange(verifier);assert.equal(res.status,200);
    const appSession=res.headers.get('set-cookie');assert.match(appSession,/HttpOnly/);assert.match(appSession,/SameSite=Lax/);
    res=await fetch(address+'/api/room',{headers:{Cookie:appSession.split(';')[0]}});assert.equal(res.status,200);assert.equal((await res.json()).id,room.id);
    assert.equal((await exchange(verifier)).status,400,'one-time code cannot be replayed');
    const headers={Cookie:session,'Content-Type':'application/json','X-CSRF-Token':(await (await fetch(address+'/api/session',{headers:{Cookie:session}})).json()).csrf};
    res=await fetch(address+'/api/account-delete',{method:'POST',headers,body:JSON.stringify({confirm:'wrong'})});assert.equal(res.status,400);
    res=await fetch(address+'/api/account-delete',{method:'POST',headers,body:JSON.stringify({confirm:'방송 데이터 영구 삭제'})});assert.equal(res.status,200);assert.equal((await res.json()).revoked,true);assert.match(seen.revoked[0],/token=RT/);
    res=await fetch(address+'/api/room',{headers:{Cookie:session}});assert.equal(res.status,401);
  } finally {
    const exited = new Promise(r => proc.once('exit', r));
    proc.kill();
    await Promise.race([exited, new Promise(r => setTimeout(r, 3000))]);
    mock.close();
    mock.closeAllConnections?.();
    try { rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }
});
