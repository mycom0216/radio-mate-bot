// 확장 워커의 영상 녹화 연결부(1.3.0): 옵션 검사, 후원이 오면 숨은 문서에 녹화 요청, 결과 처리(이 PC 저장·서버 업로드 안내), 5초 영상 테스트, 건너뛰는 경우를 검사합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ORIGIN } from '../extensions/donation-capture/policy.mjs';

test('후원이 오면 영상 녹화를 요청하고, 결과를 이 PC 저장·서버 업로드 안내로 정리합니다', { timeout: 90000 }, async () => {
  const originalChrome = globalThis.chrome, originalFetch = globalThis.fetch, state = {}, downloads = [], sent = [], created = [], streamTargets = [];
  let listener, eventsToServe = [], relayCalls = 0, tabActive = true, docExists = false, offscreenReply = { ok: true }, streamError = null, frameNumber = 0;
  const eventSource = () => ({ addListener() {} }), liveUrl = 'https://www.spooncast.net/kr/live/@test', tab = () => ({ id: 1, windowId: 2, url: liveUrl, active: tabActive });
  globalThis.chrome = {
    tabs: { onActivated: eventSource(), onUpdated: eventSource(), onRemoved: eventSource(), query: async () => [tab()], get: async () => tab(), captureVisibleTab: async () => 'data:image/png;base64,MOCK_FRAME_' + (++frameNumber) },
    windows: { get: async () => ({ state: 'normal' }) },
    storage: { local: { setAccessLevel: async () => {}, get: async () => structuredClone(state), set: async update => Object.assign(state, structuredClone(update)), remove: async key => { delete state[key]; } } },
    scripting: { executeScript: async () => [] },
    downloads: { download: async options => { downloads.push(options); return downloads.length; }, search: async () => [{ state: 'complete' }], onChanged: eventSource() },
    tabCapture: { getMediaStreamId: async ({ targetTabId }) => { if (streamError) throw streamError; streamTargets.push(targetTabId); return 'STREAM-' + streamTargets.length; } },
    offscreen: { hasDocument: async () => docExists, createDocument: async options => { created.push(options); docExists = true; } },
    runtime: { id: 'test-extension', getURL: path => 'chrome-extension://test-extension/' + path, onMessage: { addListener: handler => { listener = handler; } }, sendMessage: async message => { sent.push(message); return offscreenReply; } },
  };
  globalThis.fetch = async (request, options = {}) => {
    if (request.startsWith('data:')) return { blob: async () => new Blob([request]) };
    if (request === ORIGIN + '/api/screen-capture/upload') return { ok: true, status: 201 };
    assert.ok(request.startsWith(ORIGIN + '/api/screen-capture/events?after='));
    relayCalls++; const events = eventsToServe; eventsToServe = [];
    return { ok: true, json: async () => ({ dj: 'DJ', expiresAt: Date.now() + 3600000, cursor: relayCalls * 10, events }) };
  };
  try {
    await import('../extensions/donation-capture/worker.mjs');
    const popup = { url: chrome.runtime.getURL('popup.html') }, offscreen = { url: chrome.runtime.getURL('offscreen.html') };
    const send = (message, sender = popup) => new Promise(resolve => listener(message, { id: 'test-extension', ...sender }, resolve));
    const donate = (...ids) => { eventsToServe = ids.map((id, i) => ({ id, sequence: i + 1, time: Date.now(), nickname: '후원자' + (i + 1), amount: 350 + i })); };

    // 1) 옵션: 기본은 영상 꺼짐·15초·소리 켬, 잘못된 값은 거절
    assert.deepEqual((await send({ type: 'state' })).options, { local: true, upload: true, video: false, videoSeconds: 15, videoAudio: true });
    for (const bad of [{ video: 'yes' }, { videoAudio: 1 }, { videoSeconds: 2 }, { videoSeconds: 46 }, { videoSeconds: 1.5 }, { videoSeconds: '15' }]) assert.equal((await send({ type: 'options', local: true, upload: true, ...bad })).ok, false, JSON.stringify(bad));
    assert.equal((await send({ type: 'options', local: true, upload: true, video: true }, { tab: { id: 1 }, url: liveUrl })).ok, false, '웹 페이지는 바꿀 수 없음');
    assert.equal((await send({ type: 'options', local: true, upload: true, video: true, videoSeconds: 10, videoAudio: false })).ok, true);
    assert.deepEqual((await send({ type: 'state' })).options, { local: true, upload: true, video: true, videoSeconds: 10, videoAudio: false });
    // 옛 버전 팝업처럼 영상 항목 없이 보내도 기본값으로 처리
    assert.equal((await send({ type: 'options', local: true, upload: true })).ok, true);
    assert.deepEqual((await send({ type: 'state' })).options, { local: true, upload: true, video: false, videoSeconds: 15, videoAudio: true });
    assert.equal((await send({ type: 'options', local: true, upload: true, video: true, videoSeconds: 10, videoAudio: false })).ok, true);

    // 2) 연결 후 후원 두 건이 한 번에 오면: 숨은 문서를 한 번 만들고, 마지막 후원 기준으로 녹화를 한 번 요청 (사진 촬영은 그대로)
    assert.equal((await send({ type: 'connect', confirmed: true, config: { origin: ORIGIN, token: 'A'.repeat(43) } })).ok, true);
    donate('event-a', 'event-b');
    assert.equal((await send({ type: 'capture-tick' }, { tab: { id: 1 } })).ok, true);
    assert.equal(downloads.length, 5, '사진 5장은 그대로 저장'); assert.equal(created.length, 1);
    assert.deepEqual(created[0], { url: 'offscreen.html', reasons: ['USER_MEDIA'], justification: '후원 순간의 방송 탭 화면을 영상으로 녹화합니다.' });
    const requests = sent.filter(message => message.target === 'offscreen'); assert.equal(requests.length, 1);
    const [start] = requests;
    assert.deepEqual(streamTargets, [1]); assert.equal(start.type, 'record-start'); assert.equal(start.streamId, 'STREAM-1'); assert.equal(start.seconds, 10); assert.equal(start.audio, false);
    assert.equal(start.event.id, 'event-b'); assert.equal(start.event.amount, 351); assert.equal(start.event.nickname, '후원자2');
    assert.match(start.filename, /^RadioMate-Captures\/\d{4}-\d{2}-\d{2}\/\d{6}_DJ_후원자2_351spoon_event-b_video\.webm$/);
    assert.equal(start.local, true); assert.deepEqual(start.upload, { origin: ORIGIN, token: 'A'.repeat(43) });
    assert.match(state.videoReport.text, /영상 녹화 중 · 약 10초/);

    // 3) 녹화 결과(숨은 문서가 보냄): 이 PC 저장을 요청하고 서버 업로드 결과를 안내
    const downloadsBefore = downloads.length;
    assert.deepEqual(await send({ type: 'record-result', ok: true, seconds: 10, bytes: 3 * 1048576, count: 2, blobUrl: 'blob:chrome-extension://test-extension/abc', filename: 'RadioMate-Captures/2026-11-23/x_video.webm', local: true, uploaded: { ok: true } }, offscreen), { ok: true });
    assert.deepEqual(downloads.at(-1), { url: 'blob:chrome-extension://test-extension/abc', filename: 'RadioMate-Captures/2026-11-23/x_video.webm', saveAs: false, conflictAction: 'uniquify' });
    assert.equal(downloads.length, downloadsBefore + 1);
    assert.equal(state.videoReport.text, '영상 10초 · 3.0MB · 이 PC 저장 요청 · 서버에 보관했습니다 · 후원 2건을 한 영상에 담음');
    // 서버 업로드 실패·이 PC 저장 끔·업로드 안 함
    await send({ type: 'record-result', ok: true, seconds: 5, bytes: 1048576, count: 1, blobUrl: null, local: false, uploaded: { ok: false, error: '연결이 만료·해제되어 서버에 올리지 못했습니다.' } }, offscreen);
    assert.equal(state.videoReport.text, '영상 5초 · 1.0MB · 서버 업로드 실패: 연결이 만료·해제되어 서버에 올리지 못했습니다.'); assert.equal(downloads.length, downloadsBefore + 1, '이 PC 저장을 끄면 내려받지 않음');
    await send({ type: 'record-result', ok: true, seconds: 5, bytes: 2097152, count: 1, blobUrl: 'blob:x', filename: 'y.webm', local: true, uploaded: { skipped: true } }, offscreen);
    assert.equal(state.videoReport.text, '영상 5초 · 2.0MB · 이 PC 저장 요청');
    await send({ type: 'record-result', ok: false, error: '녹화된 영상이 없습니다.' }, offscreen);
    assert.equal(state.videoReport.text, '영상 녹화 실패: 녹화된 영상이 없습니다.');
    // 결과 메시지는 숨은 문서만 보낼 수 있습니다. (웹 페이지·팝업이 가짜 결과로 다운로드를 시키지 못함)
    const before = downloads.length;
    for (const sender of [popup, { tab: { id: 1 }, url: liveUrl }, { url: 'https://evil.example/' }]) assert.equal((await send({ type: 'record-result', ok: true, seconds: 1, bytes: 1, blobUrl: 'blob:evil', filename: 'evil.webm', local: true, uploaded: { skipped: true } }, sender)).ok, false);
    assert.equal(downloads.length, before);
    // 저장 실패는 안내만 하고 오류로 끊기지 않음
    const realDownload = chrome.downloads.download; chrome.downloads.download = async () => { throw Error('Invalid filename'); };
    await send({ type: 'record-result', ok: true, seconds: 5, bytes: 1048576, count: 1, blobUrl: 'blob:x', filename: 'y.webm', local: true, uploaded: { ok: true } }, offscreen);
    assert.match(state.videoReport.text, /이 PC 저장 실패: Invalid filename · 서버에 보관했습니다/); chrome.downloads.download = realDownload;

    // 4) 건너뛰는 경우: 방송 탭이 보이지 않으면 녹화하지 않고 이유를 알림 / 영상 꺼짐이면 아무것도 하지 않음
    const sentBefore = sent.length; tabActive = false; donate('event-c');
    await send({ type: 'capture-tick' }, { tab: { id: 1 } });
    for (let i = 0; i < 20 && !/건너뛰었습니다/.test(state.videoReport?.text || ''); i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.match(state.videoReport.text, /영상 녹화를 건너뛰었습니다: 다른 탭·다른 방송이거나 창이 최소화/); assert.equal(sent.length, sentBefore, '녹화 요청 없음');
    await send({ type: 'options', local: true, upload: true, video: false }); state.videoReport = undefined; donate('event-d');
    await send({ type: 'capture-tick' }, { tab: { id: 1 } }); await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(sent.length, sentBefore); assert.equal(state.videoReport, undefined, '영상 꺼짐: 영상 관련 동작 없음');

    // 5) 5초 영상 테스트(연결 상태): 후원 없이 5초 녹화를 요청
    tabActive = true; sent.length = 0;
    assert.equal((await send({ type: 'video-test' })).ok, true);
    const connected = sent.find(message => message.type === 'record-start');
    assert.equal(connected.seconds, 5); assert.match(connected.event.id, /^TEST-VIDEO-\d+$/); assert.equal(connected.event.amount, 0); assert.equal(connected.event.nickname, '녹화테스트'); assert.deepEqual(connected.upload, { origin: ORIGIN, token: 'A'.repeat(43) });
    assert.equal((await send({ type: 'video-test' }, { tab: { id: 1 } })).ok, false, '웹 페이지는 테스트를 시작할 수 없음');
    // 연결이 없을 때: 지금 탭이 스푼 방송이면 서버 업로드 없이 이 PC에만 저장
    await chrome.storage.local.remove('binding'); sent.length = 0; docExists = true;
    assert.equal((await send({ type: 'video-test' })).ok, true);
    const manual = sent.find(message => message.type === 'record-start');
    assert.equal(manual.upload, null); assert.match(manual.filename, /_수동테스트_녹화테스트_0spoon_TEST-VIDEO_video\.webm$/); assert.equal(manual.seconds, 5);
    const realQuery = chrome.tabs.query; chrome.tabs.query = async () => [{ id: 9, windowId: 2, url: 'https://example.com/', active: true }];
    const wrong = await send({ type: 'video-test' }); assert.equal(wrong.ok, false); assert.match(wrong.error, /PC 스푼 웹의 실제 방송 탭/); chrome.tabs.query = realQuery;

    // 6) 시작 실패는 팝업에 이유를 알림: 탭 스트림을 못 얻을 때, 숨은 문서가 거절할 때
    await send({ type: 'connect', confirmed: true, config: { origin: ORIGIN, token: 'B'.repeat(43) } });
    await send({ type: 'options', local: true, upload: true, video: true, videoSeconds: 15, videoAudio: true });
    streamError = Error('Extension has not been invoked for the current page'); sent.length = 0; donate('event-e');
    await send({ type: 'capture-tick' }, { tab: { id: 1 } });
    for (let i = 0; i < 40 && !/시작하지 못했습니다/.test(state.videoReport?.text || ''); i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.match(state.videoReport.text, /영상 녹화를 시작하지 못했습니다: Extension has not been invoked/); assert.equal(sent.filter(message => message.type === 'record-start').length, 0);
    streamError = null; offscreenReply = { ok: false, error: '녹화 장치를 열 수 없습니다.' }; state.videoReport = undefined; donate('event-f');
    await send({ type: 'capture-tick' }, { tab: { id: 1 } });
    for (let i = 0; i < 40 && !state.videoReport; i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.match(state.videoReport.text, /영상 녹화를 시작하지 못했습니다: 녹화 장치를 열 수 없습니다/);
    offscreenReply = { ok: true, extended: true }; state.videoReport = undefined; donate('event-g');
    await send({ type: 'capture-tick' }, { tab: { id: 1 } });
    for (let i = 0; i < 40 && !state.videoReport; i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.match(state.videoReport.text, /영상 녹화 시간을 늘렸습니다/);
  } finally { globalThis.chrome = originalChrome; globalThis.fetch = originalFetch; }
});
