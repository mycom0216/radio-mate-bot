// 실제 서버를 띄워 확장 기능의 업로드 → DJ 관리 화면에서 목록·이미지·ZIP·삭제까지의 전체 흐름과 권한을 검사합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { crc32 } from '../zip-store.mjs';

function png(width = 140, height = 140) {
  const crcOf = buffer => { const out = Buffer.alloc(4); out.writeUInt32BE(crc32(buffer)); return out; };
  const chunk = (type, data) => { const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type, 'latin1'), data]); return Buffer.concat([length, body, crcOf(body)]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const rows = []; for (let y = 0; y < height; y++) rows.push(Buffer.concat([Buffer.from([0]), randomBytes(width * 3)]));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

test('확장 기능이 올린 캡처가 서버 폴더에 보관되고, 로그인한 DJ만 목록·이미지·ZIP·삭제를 할 수 있습니다', { timeout: 60000 }, async () => {
  let stream;
  const mock = createServer(async (req, res) => { let body = ''; for await (const part of req) body += part; if (req.url === '/v1/oauth/token') res.end(JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 })); else if (req.url === '/v1/me') res.end(JSON.stringify({ userId: 'upload-dj' })); else if (req.url === '/v1/live/events') { stream = res; res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': connected\n\n'); } else { res.writeHead(204); res.end(); } });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  const data = mkdtempSync(join(tmpdir(), 'capture-upload-'));
  const proc = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DATA_DIR: data, NODE_ENV: 'development', PUBLIC_URL: 'http://localhost:4310', SPOON_CLIENT_ID: 'test', SPOON_CLIENT_SECRET: 'test', TOKEN_KEY: 'ab'.repeat(32), SPOON_API_BASE: `http://127.0.0.1:${mock.address().port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const origin = await new Promise((resolve, reject) => { let out = ''; const timer = setTimeout(() => reject(Error('서버 시작 시간 초과')), 15000); proc.stdout.on('data', c => { out += c; const m = out.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(timer); resolve(m[0]); } }); proc.once('exit', code => reject(Error('서버가 종료됨 ' + code))); });
    let response = await fetch(origin + '/oauth/start', { redirect: 'manual' });
    const state = new URL(response.headers.get('location')).searchParams.get('state'), oauthCookie = response.headers.get('set-cookie').split(';')[0];
    response = await fetch(`${origin}/oauth/callback?state=${state}&code=test`, { redirect: 'manual', headers: { Cookie: oauthCookie } });
    const Cookie = response.headers.get('set-cookie').split(';')[0], session = await (await fetch(origin + '/api/session', { headers: { Cookie } })).json();
    const headers = { Cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf };
    const grant = await (await fetch(origin + '/api/screen-capture', { method: 'POST', headers, body: '{"action":"issue"}' })).json();
    const eventTime = Date.now() - 500; // 같은 후원의 여러 장은 후원 시각이 같습니다.
    const upload = (body, extra = {}, token = grant.token) => fetch(origin + '/api/screen-capture/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'image/png', 'X-Capture-Event': 'e'.repeat(64), 'X-Capture-Frame': '1', 'X-Capture-Amount': '350', 'X-Capture-Time': String(eventTime), 'X-Capture-Nick': encodeURIComponent('후원자★'), ...extra }, body });

    // 1) 업로드 권한과 입력 검사
    const first = png();
    assert.equal((await fetch(origin + '/api/screen-capture/upload', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: first })).status, 401, '토큰 없이는 못 올림');
    assert.equal((await upload(first, {}, 'x'.repeat(43))).status, 401, '틀린 토큰');
    assert.equal((await fetch(origin + '/api/screen-capture/upload', { method: 'POST', headers: { Cookie, 'X-CSRF-Token': session.csrf, 'Content-Type': 'image/png', 'X-Capture-Event': 'ee', 'X-Capture-Frame': '1', 'X-Capture-Amount': '1', 'X-Capture-Time': String(Date.now()) }, body: first })).status, 401, '로그인 쿠키만으로는 올릴 수 없고 캡처 토큰이 필요');
    assert.equal((await fetch(origin + '/api/screen-capture/upload', { headers: { Authorization: 'Bearer ' + grant.token } })).status, 405);
    assert.equal((await upload(first, { 'Content-Type': 'application/json' })).status, 415);
    assert.equal((await upload(Buffer.alloc(5000, 3))).status, 415, 'PNG가 아닌 내용');
    assert.equal((await upload(first, { 'X-Capture-Frame': '0' })).status, 400);
    assert.equal((await upload(first, { 'X-Capture-Event': '../../x' })).status, 400);
    // 8MB를 넘으면 413으로 거절합니다. (서버가 본문을 다 받기 전에 연결을 닫으면 클라이언트가 오류로 볼 수 있어 둘 다 허용)
    assert.ok([413, 'closed'].includes(await upload(Buffer.alloc(9 * 1024 * 1024, 1)).then(result => result.status, () => 'closed')), '8MB 초과');
    assert.deepEqual(readdirSync(join(data, 'captures')), [], '거절된 업로드는 파일을 만들지 않음');

    // 2) 정상 업로드 5장 + 중복
    const frames = [1, 2, 3, 4, 5].map(frame => ({ frame, bytes: frame === 1 ? first : png() }));
    const ids = [];
    for (const { frame, bytes } of frames) { response = await upload(bytes, { 'X-Capture-Frame': String(frame) }); assert.equal(response.status, 201); const body = await response.json(); assert.equal(body.duplicate, false); ids.push(body.id); }
    response = await upload(first, { 'X-Capture-Frame': '1' }); assert.equal(response.status, 201); assert.equal((await response.json()).duplicate, true);

    // 3) DJ 화면: 목록·이미지·내려받기·ZIP
    response = await fetch(origin + '/api/screen-capture/files', { headers }); assert.equal(response.status, 200);
    const list = await response.json();
    assert.equal(list.files.length, 5); assert.equal(list.usage.count, 5); assert.equal(list.files[0].nickname, '후원자★'); assert.equal(list.files[0].amount, 350);
    assert.deepEqual(list.files.map(file => file.frame), [1, 2, 3, 4, 5]);
    assert.equal((await fetch(origin + '/api/screen-capture/files')).status, 401, '로그인 없이 목록 불가');
    assert.equal((await fetch(origin + '/api/screen-capture/files', { headers: { Authorization: 'Bearer ' + grant.token } })).status, 401, '캡처 토큰으로 목록 불가');
    response = await fetch(`${origin}/api/screen-capture/files/${ids[0]}`, { headers: { Cookie } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png'); assert.match(response.headers.get('content-disposition'), /^inline;/); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), first);
    response = await fetch(`${origin}/api/screen-capture/files/${ids[0]}?download=1`, { headers: { Cookie } });
    assert.match(response.headers.get('content-disposition'), /^attachment; filename="RadioMate_350spoon_frame01_\d{14}\.png"$/);
    assert.equal((await fetch(`${origin}/api/screen-capture/files/${ids[0]}`)).status, 401);
    assert.equal((await fetch(`${origin}/api/screen-capture/files/${'f'.repeat(24)}`, { headers: { Cookie } })).status, 404);
    response = await fetch(`${origin}/api/screen-capture/zip/${'e'.repeat(64)}`, { headers: { Cookie } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/zip'); assert.match(response.headers.get('content-disposition'), /^attachment; filename="RadioMate-\d{4}-\d{2}-\d{2}-350spoon\.zip"$/);
    const zip = Buffer.from(await response.arrayBuffer()); assert.equal(zip.readUInt32LE(0), 0x04034b50); assert.equal(zip.readUInt16LE(zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) + 10), 5);
    assert.equal((await fetch(`${origin}/api/screen-capture/zip/nothing`, { headers: { Cookie } })).status, 404);

    // 4) 삭제는 로그인 + CSRF가 있어야 합니다
    assert.equal((await fetch(origin + '/api/screen-capture/files/delete', { method: 'POST', headers: { Cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [ids[1]] }) })).status, 403, 'CSRF 없음');
    assert.equal((await fetch(origin + '/api/screen-capture/files/delete', { method: 'POST', headers: { Authorization: 'Bearer ' + grant.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) })).status, 401, '캡처 토큰으로 삭제 불가');
    assert.equal((await fetch(origin + '/api/screen-capture/files/delete', { method: 'POST', headers, body: JSON.stringify({}) })).status, 400);
    assert.equal((await (await fetch(origin + '/api/screen-capture/files/delete', { method: 'POST', headers, body: JSON.stringify({ ids: [ids[1], 'zz'] }) })).json()).removed, 1);
    assert.equal((await (await fetch(origin + '/api/screen-capture/files', { headers })).json()).files.length, 4);

    // 5) 연결을 다시 발급하면 예전 토큰으로는 더 올릴 수 없지만, 이미 보관된 캡처는 그대로입니다.
    const rotated = await (await fetch(origin + '/api/screen-capture', { method: 'POST', headers, body: '{"action":"issue"}' })).json();
    assert.equal((await upload(png(), { 'X-Capture-Frame': '2' })).status, 401, '예전 토큰은 만료');
    assert.equal((await upload(png(), { 'X-Capture-Frame': '2' }, rotated.token)).status, 201);
    assert.equal((await (await fetch(origin + '/api/screen-capture/files', { headers })).json()).files.length, 5);
    assert.equal((await (await fetch(origin + '/api/screen-capture/files/delete', { method: 'POST', headers, body: JSON.stringify({ all: true }) })).json()).removed, 5);
    assert.deepEqual((await (await fetch(origin + '/api/screen-capture/files', { headers })).json()).files, []);

    // 6) 방송 계정을 삭제하면 서버에 보관된 캡처 파일도 함께 지워집니다.
    assert.equal((await upload(png(), { 'X-Capture-Frame': '3', 'X-Capture-Event': 'f'.repeat(64) }, rotated.token)).status, 201);
    const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
    assert.equal(walk(join(data, 'captures')).length, 1);
    assert.equal((await fetch(origin + '/api/account-delete', { method: 'POST', headers, body: JSON.stringify({ confirm: '방송 데이터 영구 삭제' }) })).status, 200);
    assert.equal(walk(join(data, 'captures')).length, 0, '계정 삭제 뒤에는 PNG 파일이 남지 않음');
  } finally {
    const exited = new Promise(resolve => proc.once('exit', resolve)); proc.kill(); await exited; stream?.destroy(); mock.closeAllConnections(); await new Promise(resolve => mock.close(resolve)); rmSync(data, { recursive: true, force: true });
  }
});
