// 후원 영상 녹화를 맡는 숨은 문서(offscreen.mjs)를 가짜 브라우저 API(탭 스트림·MediaRecorder·오디오·fetch)로 검사합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ORIGIN } from '../extensions/donation-capture/policy.mjs';

test('녹화 시작·연장·종료, 소리 이어 듣기, 이 PC 저장 주소와 서버 업로드 결과 전달', { timeout: 60000 }, async () => {
  // 3초 이상 걸리는 녹화 시간을 시험에서는 10배 빨리 흘려 보냅니다. (타이머 길이만 줄이고 코드의 계산은 그대로)
  const realSetTimeout = globalThis.setTimeout; globalThis.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, ms > 500 ? ms / 10 : ms, ...args);
  const saved = { chrome: globalThis.chrome, fetch: globalThis.fetch, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'), MediaRecorder: globalThis.MediaRecorder, AudioContext: globalThis.AudioContext, createObjectURL: URL.createObjectURL };
  const sent = [], uploads = [], constraintsSeen = [], recorders = [], audioContexts = [], stoppedTracks = [];
  let listener, supported = ['video/webm;codecs=vp8,opus', 'video/webm'], rejectMedia = null, hasAudio = true, uploadStatus = 200, uploadThrows = null, emptyRecording = false;
  const track = kind => ({ kind, stop() { stoppedTracks.push(kind); } });
  const makeStream = () => ({ getTracks: () => [track('video'), ...(hasAudio ? [track('audio')] : [])], getAudioTracks: () => hasAudio ? [track('audio')] : [] });
  class FakeRecorder {
    static isTypeSupported(type) { return supported.includes(type); }
    constructor(stream, options) { this.stream = stream; this.options = options; this.state = 'inactive'; this.stopCalls = 0; recorders.push(this); }
    start(slice) { this.state = 'recording'; this.slice = slice; if (!emptyRecording) setTimeout(() => this.ondataavailable?.({ data: new Blob([Buffer.alloc(40000, 5)]) }), 10); }
    stop() { this.stopCalls++; this.state = 'inactive'; setTimeout(() => this.onstop?.(), 5); }
  }
  class FakeAudioContext { constructor() { audioContexts.push(this); this.destination = { name: 'speakers' }; this.closed = false; } createMediaStreamSource(stream) { return { connect: target => { this.connected = [stream, target]; } }; } async close() { this.closed = true; } }
  globalThis.chrome = { runtime: { id: 'test-extension', onMessage: { addListener: handler => { listener = handler; } }, sendMessage: async message => { sent.push(message); } } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async constraints => { constraintsSeen.push(constraints); if (rejectMedia) throw rejectMedia; return makeStream(); } } } });
  globalThis.MediaRecorder = FakeRecorder; globalThis.AudioContext = FakeAudioContext;
  URL.createObjectURL = blob => 'blob:chrome-extension://test-extension/' + blob.size;
  globalThis.fetch = async (url, options) => { if (uploadThrows) throw uploadThrows; uploads.push({ url, options }); return { ok: uploadStatus < 300, status: uploadStatus }; };
  try {
    await import('../extensions/donation-capture/offscreen.mjs');
    const call = (message, sender = { id: 'test-extension' }) => new Promise(resolve => { const result = listener(message, sender, resolve); if (result !== true) resolve({ ignored: true, result }); });
    const start = (extra = {}) => call({ target: 'offscreen', type: 'record-start', streamId: 'STREAM-1', seconds: 3, audio: true, event: { id: 'evt-1', amount: 350, time: 1795000000000, nickname: '후원자★' }, filename: 'RadioMate-Captures/2026-11-23/x_video.webm', local: true, upload: { origin: ORIGIN, token: 'T'.repeat(43) }, ...extra });
    const waitResult = async (count) => { for (let i = 0; i < 120 && sent.length < count; i++) await new Promise(resolve => setTimeout(resolve, 100)); return sent[count - 1]; };

    // 0) 다른 확장·대상 아닌 메시지·모르는 요청은 처리하지 않음
    assert.deepEqual(await call({ target: 'offscreen', type: 'record-start' }, { id: 'someone-else' }), { ignored: true, result: undefined });
    assert.deepEqual(await call({ type: 'record-start' }), { ignored: true, result: undefined });
    assert.deepEqual(await call({ target: 'offscreen', type: 'nope' }), { ok: false, error: '요청을 확인해주세요.' });

    // 1) 녹화: 탭 스트림 조건, 코덱 고르기(vp9 미지원 → vp8), 소리 이어 듣기, 비트레이트
    const begin = Date.now();
    assert.deepEqual(await start(), { ok: true });
    assert.deepEqual(constraintsSeen[0], { audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: 'STREAM-1' } }, video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: 'STREAM-1', maxWidth: 1280, maxHeight: 720, maxFrameRate: 30 } } });
    assert.equal(recorders.length, 1); assert.deepEqual(recorders[0].options, { mimeType: 'video/webm;codecs=vp8,opus', videoBitsPerSecond: 1500000, audioBitsPerSecond: 64000 }); assert.equal(recorders[0].slice, 1000);
    assert.equal(audioContexts.length, 1); assert.deepEqual(audioContexts[0].connected[1], { name: 'speakers' }, '탭 소리를 다시 스피커로 내보냄');
    // 녹화 중 다른 후원: 새 녹화 없이 끝나는 시각만 늘어남
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.deepEqual(await start({ event: { id: 'evt-2', amount: 500, time: 1795000001000, nickname: '둘째' } }), { ok: true, extended: true });
    assert.equal(constraintsSeen.length, 1, '스트림을 다시 열지 않음'); assert.equal(recorders.length, 1);
    const result = await waitResult(1);
    const elapsed = Date.now() - begin;
    assert.ok(elapsed >= 380 && elapsed < 3000, `연장된 길이만큼 녹화(시험에서는 1/10 속도): ${elapsed}ms`);
    assert.equal(recorders[0].stopCalls, 1);
    assert.deepEqual([result.type, result.ok, result.count, result.local, result.filename, result.uploaded], ['record-result', true, 2, true, 'RadioMate-Captures/2026-11-23/x_video.webm', { ok: true }]);
    assert.equal(result.bytes, 40000); assert.match(result.blobUrl, /^blob:chrome-extension:\/\/test-extension\/40000$/); assert.ok(result.seconds >= 0);
    assert.deepEqual(stoppedTracks.sort(), ['audio', 'video'], '녹화가 끝나면 화면·소리 스트림을 모두 멈춤'); assert.equal(audioContexts[0].closed, true);
    // 2) 서버 업로드: 주소·인증·형식·후원 정보(첫 후원 기준)
    assert.equal(uploads.length, 1);
    const { url, options } = uploads[0];
    assert.equal(url, ORIGIN + '/api/screen-capture/video'); assert.equal(options.method, 'POST'); assert.equal(options.credentials, 'omit');
    assert.deepEqual(options.headers, { Authorization: 'Bearer ' + 'T'.repeat(43), 'Content-Type': 'video/webm', 'X-Capture-Event': 'evt-1', 'X-Capture-Amount': '350', 'X-Capture-Time': '1795000000000', 'X-Capture-Nick': encodeURIComponent('후원자★') });
    assert.equal(options.body.type, 'video/webm'); assert.equal(options.body.size, 40000);

    // 3) 소리 없이·이 PC 저장 없이·서버 업로드 없이
    hasAudio = false; sent.length = 0; uploads.length = 0; stoppedTracks.length = 0;
    assert.deepEqual(await start({ audio: false, local: false, upload: null }), { ok: true });
    assert.equal(constraintsSeen[1].audio, false); assert.equal(audioContexts.length, 1, '소리가 없으면 오디오 장치를 만들지 않음');
    const quiet = await waitResult(1);
    assert.deepEqual([quiet.ok, quiet.blobUrl, quiet.local, quiet.uploaded], [true, null, false, { skipped: true }]); assert.equal(uploads.length, 0);
    // 4) 서버 업로드 실패 이유 안내
    for (const [status, text] of [[401, /만료·해제/], [413, /허용 크기/], [429, /너무 많아/], [503, /보관 폴더/], [500, /서버 응답 오류 500/]]) {
      uploadStatus = status; sent.length = 0;
      assert.equal((await start()).ok, true); const failed = await waitResult(1);
      assert.equal(failed.ok, true, '업로드가 실패해도 이 PC 저장용 영상은 돌려줌'); assert.equal(failed.uploaded.ok, false); assert.match(failed.uploaded.error, text); assert.ok(failed.blobUrl);
    }
    uploadStatus = 200; uploadThrows = Error('offline'); sent.length = 0;
    await start(); assert.match((await waitResult(1)).uploaded.error, /서버에 연결하지 못했습니다/);
    uploadThrows = Object.assign(Error('t'), { name: 'TimeoutError' }); sent.length = 0;
    await start(); assert.match((await waitResult(1)).uploaded.error, /시간이 초과/);
    uploadThrows = null;
    // 5) 오류: 브라우저가 스트림을 못 주면 시작 단계에서 바로 알리고, 녹화된 내용이 없으면 실패로 알림
    rejectMedia = Error('Extension has not been invoked for the current page'); const before = recorders.length;
    assert.deepEqual(await start(), { ok: false, error: 'Extension has not been invoked for the current page' }); assert.equal(recorders.length, before);
    rejectMedia = null; emptyRecording = true; sent.length = 0;
    await start(); const empty = await waitResult(1);
    assert.deepEqual([empty.ok, empty.error], [false, '녹화된 영상이 없습니다.']);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.chrome = saved.chrome; globalThis.fetch = saved.fetch; if (saved.navigator) Object.defineProperty(globalThis, 'navigator', saved.navigator); globalThis.MediaRecorder = saved.MediaRecorder; globalThis.AudioContext = saved.AudioContext; URL.createObjectURL = saved.createObjectURL;
  }
});
