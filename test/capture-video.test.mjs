// 후원 순간 영상: 서버 보관(WebM 검사·중복·한도·ZIP), 영상 재생용 부분 요청(Range), 관리 화면 표시, 실제 서버 업로드→재생→삭제 흐름을 검사합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { Store } from '../core.mjs';
import { ScreenCapture, inspectVideo } from '../screen-capture.mjs';
import { parseRange } from '../http-utils.mjs';
import { captureExtensionZip } from '../capture-extension-zip.mjs';
import { crc32 } from '../zip-store.mjs';

// 시험용 WebM: EBML 머리표(1A 45 DF A3) + DocType "webm" + 무작위 내용
const webm = (size = 12000) => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84]), Buffer.from('webm'), randomBytes(size)]);
const NOW = Date.parse('2026-11-23T12:00:00+09:00');

// 시험용 진짜 PNG (서명·IHDR·IDAT·IEND와 CRC까지 맞춤)
function png(width = 120, height = 120) {
  const crcOf = buffer => { const out = Buffer.alloc(4); out.writeUInt32BE(crc32(buffer)); return out; };
  const chunk = (type, data) => { const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type, 'latin1'), data]); return Buffer.concat([length, body, crcOf(body)]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const rows = []; for (let y = 0; y < height; y++) rows.push(Buffer.concat([Buffer.from([0]), randomBytes(width * 3)]));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
function setup() {
  const store = new Store(), dir = mkdtempSync(join(tmpdir(), 'capture-video-'));
  let clock = NOW;
  const captures = new ScreenCapture(store, { now: () => clock });
  captures.configure({ dir });
  store.create('a', 'A'); store.create('b', 'B');
  const meta = (eventId = 'v'.repeat(64), extra = {}) => ({ eventId, amount: 350, time: NOW - 1000, nickname: '후원자', ...extra });
  return { store, dir, captures, meta, advance: ms => { clock += ms; }, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('WebM 검사: 머리표·문서 종류·크기가 맞는 영상만 통과합니다', () => {
  assert.deepEqual(inspectVideo(webm()), {});
  assert.throws(() => inspectVideo(Buffer.from('작은 파일')), /영상 크기/);
  assert.throws(() => inspectVideo(Buffer.alloc(20000, 7)), error => error.status === 415);
  const noDocType = webm(); noDocType.fill(0x20, 24, 28);
  assert.throws(() => inspectVideo(noDocType), error => error.status === 415, 'DocType이 webm이 아니면 거절');
  assert.throws(() => inspectVideo(Buffer.concat([webm(), Buffer.alloc(51 * 1024 * 1024)])), error => error.status === 413);
  assert.throws(() => inspectVideo('문자열'), /영상 크기/);
});

test('영상 보관: 사진과 같은 후원에 묶이고(frame 0), 종류가 video로 나오며, 같은 후원에는 한 개만 받습니다', () => {
  const f = setup();
  try {
    const bytes = webm();
    const saved = f.captures.saveVideo('a', f.meta('evVid'), bytes);
    assert.equal(saved.duplicate, false);
    const again = f.captures.saveVideo('a', f.meta('evVid'), webm());
    assert.deepEqual([again.duplicate, again.id], [true, saved.id]);
    const files = f.captures.files('a');
    assert.deepEqual(files.map(file => [file.eventId, file.frame, file.kind, file.nickname, file.amount]), [['evVid', 0, 'video', '후원자', 350]]);
    assert.ok(!('path' in files[0]), '서버 내부 경로는 목록에 내보내지 않음');
    const read = f.captures.file('a', saved.id);
    assert.equal(read.kind, 'video'); assert.equal(read.mime, 'video/webm'); assert.deepEqual(read.data, bytes);
    // 같은 후원의 사진 2장이 함께 있어도 영상(frame 0)이 먼저 오고, 사진은 image로 구분됩니다.
    f.captures.save('a', { ...f.meta('evVid'), frame: 2 }, png());
    f.captures.save('a', { ...f.meta('evVid'), frame: 1 }, png());
    assert.deepEqual(f.captures.files('a').map(file => [file.frame, file.kind]), [[0, 'video'], [1, 'image'], [2, 'image']]);
    // ZIP에는 영상과 사진이 함께 들어갑니다.
    const { data, name } = f.captures.zip('a', 'evVid');
    assert.equal(name, 'RadioMate-2026-11-23-350spoon.zip');
    const text = data.toString('latin1');
    assert.ok(text.includes('2026-11-23_350spoon_video.webm') && text.includes('_frame01.png') && text.includes('_frame02.png'));
    assert.ok(data.includes(bytes), '영상 내용이 그대로 들어감');
  } finally { f.cleanup(); }
});

test('영상 입력 검사: 잘못된 정보·형식, 분당 6개 한도, 보관 폴더 없음, 다른 방 격리', () => {
  const f = setup();
  try {
    for (const bad of [{ eventId: '' }, { eventId: '../x' }, { amount: -1 }, { amount: 'abc' }, { time: 'x' }]) assert.throws(() => f.captures.saveVideo('a', f.meta('e1', bad), webm()), /영상 정보/, JSON.stringify(bad));
    assert.throws(() => f.captures.saveVideo('a', f.meta('e2'), Buffer.alloc(20000, 1)), error => error.status === 415);
    assert.equal(f.captures.usage('a').count, 0);
    for (let i = 0; i < 6; i++) f.captures.saveVideo('a', f.meta('ev' + i), webm(9000));
    assert.throws(() => f.captures.saveVideo('a', f.meta('ev99'), webm(9000)), error => error.status === 429);
    f.captures.saveVideo('b', f.meta('evB'), webm(9000)); // 다른 방은 영향 없음
    f.advance(61000); f.captures.saveVideo('a', f.meta('ev100'), webm(9000));
    assert.throws(() => new ScreenCapture(f.store).saveVideo('a', f.meta('ev101'), webm()), error => error.status === 503);
    const id = f.captures.files('b')[0].id;
    assert.throws(() => f.captures.file('a', id), error => error.status === 404);
  } finally { f.cleanup(); }
});

test('Range 해석: 영상 재생·건너뛰기에 쓰는 부분 요청', () => {
  assert.equal(parseRange(undefined, 1000), null); assert.equal(parseRange('', 1000), null);
  assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=500-', 1000), { start: 500, end: 999 });
  assert.deepEqual(parseRange('bytes=-200', 1000), { start: 800, end: 999 });
  assert.deepEqual(parseRange('bytes=900-5000', 1000), { start: 900, end: 999 }, '끝이 크기를 넘으면 끝까지');
  assert.deepEqual(parseRange('bytes=-5000', 1000), { start: 0, end: 999 });
  for (const bad of ['bytes=1000-', 'bytes=50-10', 'bytes=-', 'bytes=-0', 'items=0-5', 'bytes=0-5,10-20', 'bytes=a-b', 'bytes=9007199254740993-']) assert.deepEqual(parseRange(bad, 1000), { invalid: true }, bad);
});

test('확장 ZIP에 영상 녹화용 파일이 들어 있고 버전·권한이 맞습니다', () => {
  const zip = captureExtensionZip(fileURLToPath(new URL('..', import.meta.url))), names = []; // (윈도우에서 URL.pathname은 '/C:/...'가 되어 경로가 깨지므로 fileURLToPath 사용)
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])), count = zip.readUInt16LE(end + 10);
  for (let at = zip.readUInt32LE(end + 16), i = 0; i < count; i++) { const length = zip.readUInt16LE(at + 28); names.push(zip.toString('utf8', at + 46, at + 46 + length)); at += 46 + length; }
  assert.deepEqual(names.sort(), ['README.md', 'manifest.json', 'offscreen.html', 'offscreen.mjs', 'policy.mjs', 'popup.css', 'popup.html', 'popup.mjs', 'worker.mjs']);
  const manifest = JSON.parse(readFileSync(new URL('../extensions/donation-capture/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.version, '1.3.0'); assert.ok(manifest.permissions.includes('tabCapture') && manifest.permissions.includes('offscreen'));
  assert.ok(readFileSync(new URL('../extensions/donation-capture/offscreen.html', import.meta.url), 'utf8').includes('offscreen.mjs'));
});

test('관리 화면 갤러리: 영상은 재생기로, 사진은 그림으로 보여 주고 ZIP 이름이 영상 포함을 알려 줍니다', () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function captureFilesHtml(data){'), end = source.indexOf('async function loadCaptureFiles()');
  const context = { esc: value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]), num: value => Number(value).toLocaleString('en-US') };
  vm.createContext(context); vm.runInContext(`${source.slice(start, end)}\nthis.render=captureFilesHtml;`, context);
  const base = { eventId: 'evA', nickname: '후원자', amount: 350, time: NOW, width: 0, height: 0 }, id = c => c.repeat(24);
  const html = context.render({ files: [{ ...base, id: id('a'), frame: 0, kind: 'video', size: 3 * 1048576 }, { ...base, id: id('b'), frame: 1, kind: 'image', size: 1048576 }, { ...base, id: id('c'), frame: 2, kind: 'image', size: 1048576 }], usage: { count: 3, bytes: 5 * 1048576 } });
  assert.ok(html.includes(`<video controls preload="metadata" playsinline src="/api/screen-capture/files/${id('a')}"></video>`));
  assert.ok(html.includes('영상 · 3.0MB') && html.includes('영상 1개 · 사진 2장'));
  assert.equal((html.match(/<img /g) || []).length, 2, '사진 2장만 그림으로');
  assert.ok(html.includes('영상+사진 2장 ZIP으로 저장'));
  assert.ok(html.includes(`href="/api/screen-capture/files/${id('a')}?download=1" download>저장</a>`));
  assert.equal((html.match(/data-action="capture-file-delete"/g) || []).length, 3);
  const onlyVideo = context.render({ files: [{ ...base, id: id('a'), frame: 0, kind: 'video', size: 1048576 }], usage: null });
  assert.ok(onlyVideo.includes('영상 ZIP으로 저장') && !onlyVideo.includes('<img '));
  assert.ok(readFileSync(new URL('../public/style.css', import.meta.url), 'utf8').includes('.capture-video video'));
});

test('실제 서버: 영상 업로드 → 목록 → 재생(Range 206) → 내려받기 → 삭제, 권한과 형식 검사', { timeout: 60000 }, async () => {
  let stream;
  const mock = createServer(async (req, res) => { let body = ''; for await (const part of req) body += part; if (req.url === '/v1/oauth/token') res.end(JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 })); else if (req.url === '/v1/me') res.end(JSON.stringify({ userId: 'video-dj' })); else if (req.url === '/v1/live/events') { stream = res; res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': connected\n\n'); } else { res.writeHead(204); res.end(); } });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  const data = mkdtempSync(join(tmpdir(), 'capture-video-http-'));
  const proc = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DATA_DIR: data, NODE_ENV: 'development', PUBLIC_URL: 'http://localhost:4310', SPOON_CLIENT_ID: 'test', SPOON_CLIENT_SECRET: 'test', TOKEN_KEY: 'ab'.repeat(32), SPOON_API_BASE: `http://127.0.0.1:${mock.address().port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const origin = await new Promise((resolve, reject) => { let out = ''; const timer = setTimeout(() => reject(Error('서버 시작 시간 초과')), 15000); proc.stdout.on('data', c => { out += c; const m = out.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(timer); resolve(m[0]); } }); proc.once('exit', code => reject(Error('서버가 종료됨 ' + code))); });
    let response = await fetch(origin + '/oauth/start', { redirect: 'manual' });
    const state = new URL(response.headers.get('location')).searchParams.get('state'), oauthCookie = response.headers.get('set-cookie').split(';')[0];
    response = await fetch(`${origin}/oauth/callback?state=${state}&code=test`, { redirect: 'manual', headers: { Cookie: oauthCookie } });
    const Cookie = response.headers.get('set-cookie').split(';')[0], session = await (await fetch(origin + '/api/session', { headers: { Cookie } })).json();
    const headers = { Cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf };
    const grant = await (await fetch(origin + '/api/screen-capture', { method: 'POST', headers, body: '{"action":"issue"}' })).json();
    const eventTime = Date.now() - 500, upload = (body, extra = {}, token = grant.token) => fetch(origin + '/api/screen-capture/video', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'video/webm', 'X-Capture-Event': 'w'.repeat(64), 'X-Capture-Amount': '350', 'X-Capture-Time': String(eventTime), 'X-Capture-Nick': encodeURIComponent('후원자★'), ...extra }, body });
    const video = webm(200000);
    // 업로드 권한·형식
    assert.equal((await fetch(origin + '/api/screen-capture/video', { method: 'POST', headers: { 'Content-Type': 'video/webm' }, body: video })).status, 401);
    assert.equal((await upload(video, {}, 'x'.repeat(43))).status, 401);
    assert.equal((await fetch(origin + '/api/screen-capture/video', { headers: { Authorization: 'Bearer ' + grant.token } })).status, 405);
    assert.equal((await upload(video, { 'Content-Type': 'image/png' })).status, 415);
    assert.equal((await upload(Buffer.alloc(20000, 3))).status, 415, 'WebM이 아닌 내용');
    assert.equal((await upload(video, { 'X-Capture-Event': '../x' })).status, 400);
    assert.deepEqual(readdirSync(join(data, 'captures')), [], '거절된 업로드는 파일을 만들지 않음');
    // 정상 업로드 + 중복
    response = await upload(video); assert.equal(response.status, 201); const saved = await response.json(); assert.equal(saved.duplicate, false);
    response = await upload(video); assert.equal((await response.json()).duplicate, true);
    // 목록
    const list = await (await fetch(origin + '/api/screen-capture/files', { headers })).json();
    assert.equal(list.files.length, 1); assert.deepEqual([list.files[0].kind, list.files[0].frame, list.files[0].nickname], ['video', 0, '후원자★']);
    // 보기·재생(Range)·내려받기
    response = await fetch(`${origin}/api/screen-capture/files/${saved.id}`, { headers: { Cookie } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'video/webm'); assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), video);
    response = await fetch(`${origin}/api/screen-capture/files/${saved.id}`, { headers: { Cookie, Range: 'bytes=100-199' } });
    assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), `bytes 100-199/${video.length}`); assert.equal(response.headers.get('content-length'), '100');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), video.subarray(100, 200));
    response = await fetch(`${origin}/api/screen-capture/files/${saved.id}`, { headers: { Cookie, Range: 'bytes=-50' } });
    assert.equal(response.status, 206); assert.deepEqual(Buffer.from(await response.arrayBuffer()), video.subarray(video.length - 50));
    response = await fetch(`${origin}/api/screen-capture/files/${saved.id}`, { headers: { Cookie, Range: `bytes=${video.length + 10}-` } });
    assert.equal(response.status, 416); assert.equal(response.headers.get('content-range'), `bytes */${video.length}`);
    assert.equal((await fetch(`${origin}/api/screen-capture/files/${saved.id}`, { headers: { Range: 'bytes=0-9' } })).status, 401, '로그인 없이는 부분 요청도 불가');
    response = await fetch(`${origin}/api/screen-capture/files/${saved.id}?download=1`, { headers: { Cookie } });
    assert.match(response.headers.get('content-disposition'), /^attachment; filename="RadioMate_350spoon_video_\d{14}\.webm"$/);
    // ZIP과 삭제
    response = await fetch(`${origin}/api/screen-capture/zip/${'w'.repeat(64)}`, { headers: { Cookie } });
    assert.equal(response.status, 200); const zip = Buffer.from(await response.arrayBuffer()); assert.ok(zip.includes(Buffer.from('_350spoon_video.webm')) && zip.includes(video));
    assert.equal((await (await fetch(origin + '/api/screen-capture/files/delete', { method: 'POST', headers, body: JSON.stringify({ ids: [saved.id] }) })).json()).removed, 1);
    assert.deepEqual((await (await fetch(origin + '/api/screen-capture/files', { headers })).json()).files, []);
    // 사진 업로드 경로와 구분: 영상 토큰 경로에 PNG를 보내면 거절
    assert.equal((await upload(Buffer.from([0x89, 0x50, 0x4e, 0x47, ...randomBytes(20000)]), { 'Content-Type': 'video/webm' })).status, 415);
  } finally { const exited = new Promise(resolve => proc.once('exit', resolve)); proc.kill(); await exited; stream?.destroy(); mock.closeAllConnections(); await new Promise(resolve => mock.close(resolve)); rmSync(data, { recursive: true, force: true }); }
});
