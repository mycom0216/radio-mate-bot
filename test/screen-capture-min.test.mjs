// 화면 캡처 기준 스푼(기본 200, 예전 기본값은 300)을 검사하는 테스트입니다. 기준 미만의 후원은 캡처 대상으로 기록되지 않아야 합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Store, defaults, validateSettings } from '../core.mjs';
import { ScreenCapture } from '../screen-capture.mjs';

function setup() {
  const store = new Store();
  let clock = Date.parse('2026-11-23T03:00:00Z');
  const captures = new ScreenCapture(store, { now: () => clock });
  store.create('a', 'A');
  // 실제 DJ 계정이 연결된 것처럼 토큰 행을 넣고 연결 정보를 발급합니다.
  store.db.prepare('INSERT INTO tokens(room,data) VALUES(?,?)').run('a', 'x');
  captures.issue('a');
  const gift = (amount, id = `g${amount}`) => ({ id, data: { user: { id: 'u1', nickname: '후원자' }, amount, time: new Date(clock).toISOString() } });
  return { store, captures, gift, setMin: value => store.transaction('a', r => { r.settings.screenCaptureMin = value; }) };
}

test('기본 기준은 200스푼입니다', () => {
  assert.equal(defaults().screenCaptureMin, 200); assert.equal(defaults().screenCaptureMinApplied, true);
});

test('200스푼 미만은 캡처 대상으로 기록하지 않고, 200스푼 이상은 기록합니다', () => {
  const f = setup();
  for (const amount of [1, 10, 20, 100, 199]) assert.equal(f.captures.record('a', f.gift(amount)), false, `${amount}스푼`);
  assert.equal(f.captures.list('a').events.length, 0);
  assert.equal(f.captures.record('a', f.gift(200)), true, '정확히 200스푼도 대상');
  assert.equal(f.captures.record('a', f.gift(300)), true, '예전 기준(300)이던 후원도 당연히 대상');
  assert.equal(f.captures.record('a', f.gift(1000)), true);
  assert.deepEqual(f.captures.list('a').events.map(e => e.amount), [200, 300, 1000]);
});

test('기준을 바꾸면 바로 적용됩니다', () => {
  const f = setup();
  f.setMin(1000);
  assert.equal(f.captures.record('a', f.gift(500)), false);
  assert.equal(f.captures.record('a', f.gift(1000)), true);
  f.setMin(20);
  assert.equal(f.captures.record('a', f.gift(20)), true);
  assert.equal(f.captures.record('a', f.gift(19)), false);
});

test('이전에 저장된 방(기준 설정이 없음)도 기본 200스푼으로 동작합니다', () => {
  const f = setup();
  const row = f.store.db.prepare('SELECT data FROM rooms WHERE id=?').get('a'), raw = JSON.parse(row.data);
  delete raw.settings.screenCaptureMin;
  f.store.db.prepare('UPDATE rooms SET data=? WHERE id=?').run(JSON.stringify(raw), 'a');
  assert.equal(f.captures.record('a', f.gift(199)), false);
  assert.equal(f.captures.record('a', f.gift(200)), true);
});

test('설정 값 검사', () => {
  const base = () => structuredClone(defaults());
  assert.equal(validateSettings(Object.assign(base(), { screenCaptureMin: 1 })).screenCaptureMin, 1);
  for (const bad of [0, -5, 1.5, 100000001, 'abc', null]) assert.throws(() => validateSettings(Object.assign(base(), { screenCaptureMin: bad })), /화면 캡처 기준/, String(bad));
  const old = base(); delete old.screenCaptureMin;
  assert.equal(validateSettings(old).screenCaptureMin, 200);
  assert.equal(validateSettings(old).screenCaptureMinApplied, true, '저장 시점부터는 DJ가 정한 값을 유지');
});

test('웹 관리 화면의 캡처 카드가 기준 입력칸과 200스푼 안내를 보여 줍니다', () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function screenCapturePanel(){');
  const end = source.indexOf('\n', start);
  const context = { room: { id: 'r', name: '콰앙', screenCapture: null, settings: { screenCaptureMin: 200 } }, card: (title, body) => `${title}|${body}`, field: (label, key) => `[${label}:${key}]`, saveButton: () => '[save]', esc: value => String(value), captureStatusHtml: () => '[status]' };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}\nthis.html=screenCapturePanel();`, context);
  assert.ok(context.html.includes('[status]'), '연결 상태 표시 자리');
  assert.ok(context.html.includes(':screenCaptureMin]') && context.html.includes('기준 스푼(기본 200스푼) 이상') && context.html.includes('[save]'));
  assert.ok(!context.html.includes('20스푼'));
});

// ───── 기본값을 300에서 200으로 낮춘 변경: 예전 방 이전 ─────
test('예전 기본값(300)이 그대로 저장된 방은 불러올 때 한 번만 200으로 바뀌고, DJ가 정한 다른 값과 이후의 선택은 유지됩니다', () => {
  const rawRoom = (value, marker) => { const f = setup(); const row = f.store.db.prepare('SELECT data FROM rooms WHERE id=?').get('a'), raw = JSON.parse(row.data);
    if (value === undefined) delete raw.settings.screenCaptureMin; else raw.settings.screenCaptureMin = value;
    if (marker === undefined) delete raw.settings.screenCaptureMinApplied; else raw.settings.screenCaptureMinApplied = marker;
    f.store.db.prepare('UPDATE rooms SET data=? WHERE id=?').run(JSON.stringify(raw), 'a'); return f; };
  // 1) 예전 기본값 300 + 표시 없음 → 200
  let f = rawRoom(300, undefined);
  assert.equal(f.store.load('a').settings.screenCaptureMin, 200); assert.equal(f.captures.record('a', f.gift(200)), true); assert.equal(f.captures.record('a', f.gift(199)), false);
  // 저장되면 표시가 남고, 그 뒤 DJ가 다시 300으로 정하면 그대로 300을 유지합니다.
  f.store.transaction('a', r => { r.settings.screenCaptureMin = 300; });
  assert.equal(f.store.load('a').settings.screenCaptureMinApplied, true); assert.equal(f.store.load('a').settings.screenCaptureMin, 300, 'DJ가 직접 고른 300은 유지');
  // 2) DJ가 직접 정한 값(500, 100)은 바뀌지 않음
  for (const own of [500, 100, 1000]) { f = rawRoom(own, undefined); assert.equal(f.store.load('a').settings.screenCaptureMin, own, `${own}`); }
  // 3) 이미 표시가 있는 방의 300은 건드리지 않음
  f = rawRoom(300, true); assert.equal(f.store.load('a').settings.screenCaptureMin, 300);
  // 4) 새 방은 처음부터 200
  const fresh = setup(); assert.equal(fresh.store.load('a').settings.screenCaptureMin, 200);
  // 5) 설정을 저장(검사)하면 표시가 생겨, 이후 불러올 때 300이 200으로 바뀌지 않음
  const posted = structuredClone(defaults()); delete posted.screenCaptureMinApplied; posted.screenCaptureMin = 300;
  const validated = validateSettings(posted); assert.equal(validated.screenCaptureMin, 300); assert.equal(validated.screenCaptureMinApplied, true);
});
