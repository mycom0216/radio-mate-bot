// 화면 캡처 기준 스푼(기본 300)을 검사하는 테스트입니다. 기준 미만의 후원은 캡처 대상으로 기록되지 않아야 합니다.
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

test('기본 기준은 300스푼입니다', () => {
  assert.equal(defaults().screenCaptureMin, 300);
});

test('300스푼 미만은 캡처 대상으로 기록하지 않고, 300스푼 이상은 기록합니다', () => {
  const f = setup();
  for (const amount of [1, 10, 20, 100, 299]) assert.equal(f.captures.record('a', f.gift(amount)), false, `${amount}스푼`);
  assert.equal(f.captures.list('a').events.length, 0);
  assert.equal(f.captures.record('a', f.gift(300)), true, '정확히 300스푼도 대상');
  assert.equal(f.captures.record('a', f.gift(1000)), true);
  assert.deepEqual(f.captures.list('a').events.map(e => e.amount), [300, 1000]);
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

test('이전에 저장된 방(기준 설정이 없음)도 기본 300스푼으로 동작합니다', () => {
  const f = setup();
  const row = f.store.db.prepare('SELECT data FROM rooms WHERE id=?').get('a'), raw = JSON.parse(row.data);
  delete raw.settings.screenCaptureMin;
  f.store.db.prepare('UPDATE rooms SET data=? WHERE id=?').run(JSON.stringify(raw), 'a');
  assert.equal(f.captures.record('a', f.gift(299)), false);
  assert.equal(f.captures.record('a', f.gift(300)), true);
});

test('설정 값 검사', () => {
  const base = () => structuredClone(defaults());
  assert.equal(validateSettings(Object.assign(base(), { screenCaptureMin: 1 })).screenCaptureMin, 1);
  for (const bad of [0, -5, 1.5, 100000001, 'abc', null]) assert.throws(() => validateSettings(Object.assign(base(), { screenCaptureMin: bad })), /화면 캡처 기준/, String(bad));
  const old = base(); delete old.screenCaptureMin;
  assert.equal(validateSettings(old).screenCaptureMin, 300);
});

test('웹 관리 화면의 캡처 카드가 기준 입력칸과 300스푼 안내를 보여 줍니다', () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function screenCapturePanel(){');
  const end = source.indexOf('\n', start);
  const context = { room: { id: 'r', name: '콰앙', screenCapture: null, settings: { screenCaptureMin: 300 } }, card: (title, body) => `${title}|${body}`, field: (label, key) => `[${label}:${key}]`, saveButton: () => '[save]', esc: value => String(value), captureStatusHtml: () => '[status]' };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}\nthis.html=screenCapturePanel();`, context);
  assert.ok(context.html.includes('[status]'), '연결 상태 표시 자리');
  assert.ok(context.html.includes(':screenCaptureMin]') && context.html.includes('기준 스푼(기본 300스푼) 이상') && context.html.includes('[save]'));
  assert.ok(!context.html.includes('20스푼'));
});
