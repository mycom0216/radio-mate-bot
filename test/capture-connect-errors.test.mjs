// 확장 연결 실패 원인 안내: 붙여넣은 내용이 잘못된 경우와, 확장이 전용으로 쓰는 서버 주소가 연결 정보의 스튜디오 주소와 다른 경우를 구분해 알려 줍니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ORIGIN } from '../extensions/donation-capture/policy.mjs';

test('연결 정보가 잘못되었거나 서버 주소가 다르면 원인을 구분해 알려 줍니다', async () => {
  const originalChrome = globalThis.chrome, originalFetch = globalThis.fetch; let listener;
  const eventSource = () => ({ addListener() {} });
  globalThis.chrome = {
    tabs: { onActivated: eventSource(), onUpdated: eventSource(), onRemoved: eventSource(), query: async () => [], get: async () => ({}), captureVisibleTab: async () => '' },
    windows: { get: async () => ({ state: 'normal' }) },
    storage: { local: { setAccessLevel: async () => {}, get: async () => ({}), set: async () => {}, remove: async () => {} } },
    scripting: { executeScript: async () => [] }, downloads: { download: async () => 1, search: async () => [], onChanged: eventSource() },
    runtime: { id: 'test-extension', getURL: path => 'chrome-extension://test-extension/' + path, onMessage: { addListener: handler => { listener = handler; } } },
  };
  let fetched = 0; globalThis.fetch = async () => { fetched++; return { ok: false, status: 500 }; };
  try {
    await import('../extensions/donation-capture/worker.mjs');
    const connect = config => new Promise(resolve => listener({ type: 'connect', confirmed: true, config }, { id: 'test-extension', url: chrome.runtime.getURL('popup.html') }, resolve));
    const token = 'A'.repeat(43);
    for (const bad of [null, undefined, 'text', 42, {}, { origin: ORIGIN }, { origin: ORIGIN, token: 'short' }, { origin: ORIGIN, token: 'A'.repeat(44) }, { origin: ORIGIN, token: 5 }]) {
      const out = await connect(bad); assert.equal(out.ok, false); assert.match(out.error, /연결 정보가 올바르지 않습니다.*글자 전체/, JSON.stringify(bad));
    }
    for (const other of ['http://localhost:4310', 'https://another.example.com', undefined, 'x'.repeat(200)]) {
      const out = await connect({ origin: other, token }); assert.equal(out.ok, false);
      assert.ok(out.error.includes(`${ORIGIN} 서버 전용입니다`) && out.error.includes('연결 정보를 다시 발급'), out.error);
      if (typeof other === 'string' && other.length < 80) assert.ok(out.error.includes(other), '발급한 스튜디오 주소를 보여 줌');
      assert.ok(!out.error.includes('x'.repeat(100)), '긴 주소는 잘라서 보여 줌');
    }
    if (true) assert.equal(fetched, 0, '잘못된 연결 정보로는 서버에 접속을 시도하지 않음');
    // 팝업: 붙여넣은 글자가 JSON이 아니면 영어 구문 오류 대신 안내 문구
    const popup = readFileSync(new URL('../extensions/donation-capture/popup.mjs', import.meta.url), 'utf8');
    assert.ok(popup.includes('연결 정보를 읽을 수 없습니다') && popup.includes('try{config=JSON.parse'));
  } finally { globalThis.chrome = originalChrome; globalThis.fetch = originalFetch; }
});
