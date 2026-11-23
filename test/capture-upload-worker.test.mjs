// 확장 기능 1.2.0: 찍은 화면을 서버에 올리는 동작(헤더·순서·재시도·실패 안내)과 저장 방식 선택(이 PC / 서버)을 가짜 브라우저 API로 검사합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ORIGIN } from '../extensions/donation-capture/policy.mjs';

test('확장 기능이 후원 화면을 이 PC에 저장하고 서버에도 올리며, 저장 방식 선택과 업로드 실패 안내가 동작합니다', { timeout: 90000 }, async () => {
  const originalChrome = globalThis.chrome, originalFetch = globalThis.fetch, state = {}, downloads = [], uploads = [];
  let listener, eventsToServe = [], relayCalls = 0, uploadScript = () => ({ ok: true, status: 201 }), inFlight = 0, maxInFlight = 0;
  const eventSource = () => ({ addListener() {} }), url = 'https://www.spooncast.net/kr/live/@test';
  let frameNumber = 0;
  globalThis.chrome = {
    tabs: { onActivated: eventSource(), onUpdated: eventSource(), onRemoved: eventSource(), query: async () => [{ id: 1, windowId: 2, url }], get: async () => ({ id: 1, windowId: 2, url, active: true }), captureVisibleTab: async () => 'data:image/png;base64,MOCK_FRAME_' + (++frameNumber) },
    windows: { get: async () => ({ state: 'normal' }) },
    storage: { local: { setAccessLevel: async () => {}, get: async () => structuredClone(state), set: async update => Object.assign(state, structuredClone(update)), remove: async key => { delete state[key]; } } },
    scripting: { executeScript: async () => [] },
    downloads: { download: async options => { downloads.push(options); return downloads.length; }, search: async () => [{ state: 'complete' }], onChanged: eventSource() },
    runtime: { id: 'test-extension', getURL: path => 'chrome-extension://test-extension/' + path, onMessage: { addListener: handler => { listener = handler; } } },
  };
  globalThis.fetch = async (request, options = {}) => {
    if (request.startsWith('data:')) return { blob: async () => new Blob([request]) };
    if (request === ORIGIN + '/api/screen-capture/upload') {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise(resolve => setTimeout(resolve, 40));
        const blob = options.body, text = await blob.text();
        const entry = { options, text, index: uploads.length };
        uploads.push(entry);
        const outcome = uploadScript(entry);
        if (outcome instanceof Error) throw outcome;
        return outcome;
      } finally { inFlight--; }
    }
    assert.ok(request.startsWith(ORIGIN + '/api/screen-capture/events?after='));
    relayCalls++;
    const events = eventsToServe; eventsToServe = [];
    return { ok: true, json: async () => ({ dj: 'DJ', expiresAt: Date.now() + 3600000, cursor: relayCalls * 10, events }) };
  };
  try {
    await import('../extensions/donation-capture/worker.mjs');
    const popup = () => ({ url: chrome.runtime.getURL('popup.html') });
    const send = (message, sender = popup()) => new Promise(resolve => listener(message, { id: 'test-extension', ...sender }, resolve));
    const donate = id => { eventsToServe = [{ id, sequence: 1, time: Date.now(), nickname: '후원자★', amount: 350 }]; };
    const settle = async () => { for (let i = 0; i < 80 && (inFlight || state.uploadReport === undefined); i++) await new Promise(resolve => setTimeout(resolve, 50)); await new Promise(resolve => setTimeout(resolve, 150)); };

    // 0) 저장 방식 설정: 기본은 둘 다 켬, 둘 다 끄거나 잘못된 값은 거절, 팝업만 바꿀 수 있음
    assert.deepEqual((await send({ type: 'state' })).options, { local: true, upload: true });
    for (const bad of [{ local: false, upload: false }, { local: 'yes', upload: true }, { local: true }]) assert.equal((await send({ type: 'options', ...bad })).ok, false, JSON.stringify(bad));
    assert.equal((await send({ type: 'options', local: false, upload: true }, { tab: { id: 1 }, url })).ok, false, '웹 페이지는 저장 방식을 바꿀 수 없음');
    assert.equal(state.options, undefined);

    // 연결(이전 후원은 기준선으로 보고 캡처하지 않음)
    assert.equal((await send({ type: 'connect', confirmed: true, config: { origin: ORIGIN, token: 'A'.repeat(43) } })).ok, true);
    assert.equal(uploads.length, 0); assert.equal(downloads.length, 0);

    // 1) 기본(이 PC + 서버): 5장이 저장되고 5장이 서버로 올라가며, 업로드는 한 장씩 차례로 진행
    donate('event-one');
    assert.equal((await send({ type: 'capture-tick' }, { tab: { id: 1 } })).ok, true);
    await settle();
    assert.equal(downloads.length, 5); assert.equal(uploads.length, 5);
    assert.equal(maxInFlight, 1, '업로드는 한 번에 한 장씩');
    uploads.forEach((entry, i) => {
      const headers = entry.options.headers;
      assert.equal(entry.options.method, 'POST'); assert.equal(entry.options.credentials, 'omit');
      assert.equal(headers.Authorization, 'Bearer ' + 'A'.repeat(43)); assert.equal(headers['Content-Type'], 'image/png');
      assert.equal(headers['X-Capture-Event'], 'event-one'); assert.equal(headers['X-Capture-Frame'], String(i + 1)); assert.equal(headers['X-Capture-Amount'], '350');
      assert.ok(Math.abs(Number(headers['X-Capture-Time']) - Date.now()) < 15000);
      assert.equal(decodeURIComponent(headers['X-Capture-Nick']), '후원자★'); assert.doesNotMatch(headers['X-Capture-Nick'], /[^\x20-\x7e]/, '헤더에는 ASCII만');
      assert.equal(entry.text, 'data:image/png;base64,MOCK_FRAME_' + (i + 1), '찍은 화면 그대로 올림');
    });
    assert.deepEqual([state.uploadReport.ok, state.uploadReport.fail], [5, 0]); assert.equal(state.uploadReport.last, '서버에 보관했습니다.');
    assert.match(state.report.text, /PNG 저장 완료/);

    // 2) 서버에만 보관(이 PC 저장 끔): 다운로드 없이 5장 업로드
    assert.equal((await send({ type: 'options', local: false, upload: true })).ok, true);
    const downloadsBefore = downloads.length, uploadsBefore = uploads.length;
    donate('event-two');
    await send({ type: 'capture-tick' }, { tab: { id: 1 } }); await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(downloads.length, downloadsBefore, '이 PC에는 저장하지 않음'); assert.equal(uploads.length - uploadsBefore, 5);
    assert.equal(state.report.kind, 'captured'); assert.match(state.report.text, /캡처 완료.*서버 업로드/);
    await settle();

    // 3) 이 PC에만 저장(서버 업로드 끔)
    assert.equal((await send({ type: 'options', local: true, upload: false })).ok, true);
    const d3 = downloads.length, u3 = uploads.length;
    donate('event-three');
    await send({ type: 'capture-tick' }, { tab: { id: 1 } });
    assert.equal(downloads.length - d3, 5); assert.equal(uploads.length, u3, '서버에는 올리지 않음');
    assert.match((await send({ type: 'state' })).options ? JSON.stringify((await send({ type: 'state' })).options) : '', /"upload":false/);

    // 4) 업로드 실패 안내: 장마다 다른 응답 — 1장 성공, 2장 네트워크 오류(한 번 재시도 후 성공), 3장 보관 폴더 없음, 4장 한도 초과, 5장 만료
    assert.equal((await send({ type: 'options', local: true, upload: true })).ok, true);
    await chrome.storage.local.remove('uploadReport');
    const framesSeen = new Map(); let thrown = false;
    uploadScript = entry => {
      const frame = Number(entry.options.headers['X-Capture-Frame']), n = (framesSeen.get(frame) || 0) + 1; framesSeen.set(frame, n);
      if (frame === 2 && n === 1) { thrown = true; return new Error('network down'); }
      return { 1: { ok: true, status: 201 }, 2: { ok: true, status: 201 }, 3: { ok: false, status: 503 }, 4: { ok: false, status: 429 }, 5: { ok: false, status: 401 } }[frame];
    };
    const d4 = downloads.length, u4 = uploads.length;
    donate('event-four');
    await send({ type: 'capture-tick' }, { tab: { id: 1 } });
    for (let i = 0; i < 80 && (state.uploadReport?.ok || 0) + (state.uploadReport?.fail || 0) < 5; i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(downloads.length - d4, 5, '업로드가 실패해도 이 PC 저장은 그대로');
    assert.ok(thrown); assert.equal(framesSeen.get(2), 2, '네트워크 오류는 한 번 다시 시도');
    assert.equal(framesSeen.get(3), 1); assert.equal(framesSeen.get(4), 1); assert.equal(framesSeen.get(5), 1, '503·429·401은 다시 시도하지 않음');
    assert.equal(uploads.length - u4, 6);
    assert.deepEqual([state.uploadReport.ok, state.uploadReport.fail], [2, 3]);
    assert.match(state.uploadReport.last, /연결이 만료·해제/, '마지막 오류(만료)가 안내로 남음');
  } finally { globalThis.chrome = originalChrome; globalThis.fetch = originalFetch; }
});
