import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 실제 server.mjs를 가짜 스푼 API로 로그인시킨 뒤, DJ 화면이 쓰는 방 정보의 systemAutomation(자동 운영 상태)이
// deploy가 아니라 RADIOMATE_STATE_DIR의 automation-status.json에서 읽히는지 확인합니다.
test('server reads the system automation status from RADIOMATE_STATE_DIR', { timeout: 40000 }, async () => {
  const mock = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (req.url === '/v1/oauth/token') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ access_token: 'AT', token_type: 'Bearer', expires_in: 3600, refresh_token: 'RT', scope: 'me.read events.chat chat.send' })); }
      else if (req.url === '/v1/me') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ userId: 'dj-state-1' })); }
      else if (req.url === '/v1/live/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': hello\n\n'); }
      else { res.writeHead(404); res.end(); }
    });
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const data = mkdtempSync(join(tmpdir(), 'state-dir-data-'));
  const state = mkdtempSync(join(tmpdir(), 'state-dir-state-'));
  const statusFile = join(state, 'automation-status.json');
  writeFileSync(statusFile, JSON.stringify({ enabled: true, localHealthy: true, tunnelHealthy: true, gatewayHealthy: false, checkedAt: 1234, lastError: 'connection-recovery-pending' }));
  const proc = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DATA_DIR: data, RADIOMATE_STATE_DIR: state, NODE_ENV: 'development', PUBLIC_URL: 'http://localhost:4310', SPOON_REGION: 'jp', SPOON_CLIENT_ID: 'cid', SPOON_CLIENT_SECRET: 'secret', TOKEN_KEY: 'ef'.repeat(32), SPOON_API_BASE: `http://127.0.0.1:${mock.address().port}`, OPENAI_API_KEY: '', NAVER_CLIENT_ID: '', NAVER_CLIENT_SECRET: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    const address = await new Promise((resolve, reject) => {
      let text = ''; const timer = setTimeout(() => reject(Error('server start timeout')), 10000);
      proc.stdout.on('data', c => { text += c; const m = text.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(timer); resolve(m[0]); } });
      proc.on('exit', code => { clearTimeout(timer); reject(Error('server exited ' + code)); });
    });
    let res = await fetch(address + '/oauth/start', { redirect: 'manual' });
    const oauthState = new URL(res.headers.get('location')).searchParams.get('state'), oauthCookie = res.headers.get('set-cookie').split(';')[0];
    res = await fetch(`${address}/oauth/callback?code=abc&state=${oauthState}`, { redirect: 'manual', headers: { Cookie: oauthCookie } });
    assert.equal(res.status, 302);
    const cookie = res.headers.getSetCookie().filter(c => !/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c)).map(c => c.split(';')[0]).join('; ');
    const room = async () => { const r = await fetch(address + '/api/room', { headers: { Cookie: cookie } }); assert.equal(r.status, 200); return r.json(); };
    assert.deepEqual((await room()).systemAutomation, { enabled: true, localHealthy: true, tunnelHealthy: true, gatewayHealthy: false, checkedAt: 1234, lastError: '복구 또는 연결 확인 중' });
    // 상태 파일이 없으면(관리자가 꺼져 있으면) 꺼진 것으로 보여 줍니다.
    rmSync(statusFile);
    assert.deepEqual((await room()).systemAutomation, { enabled: false });
  } finally {
    const exited = new Promise(r => proc.once('exit', r));
    proc.kill();
    await Promise.race([exited, new Promise(r => setTimeout(r, 3000))]);
    mock.close();
    mock.closeAllConnections?.();
    for (const dir of [data, state]) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {} }
  }
});
