// 한 번에 기준 스푼(기본 10스푼) 이상 후원하면 후원자 본인에게 복권을 주는 기능을 검사하는 테스트입니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Engine, Store, defaults, validateSettings } from '../core.mjs';

// 방 'a'에 청취자 u1(닉네임 '가', 복권 0장)을 만들어 두고 시작합니다.
function setup() {
  const store = new Store();
  let time = Date.parse('2026-11-16T00:00:00Z');
  const engine = new Engine(store, { now: () => time, int: (a) => a });
  store.create('a', 'A'); store.create('b', 'B');
  time += 21000;
  engine.handle('a', { id: 'first', user: { id: 'u1', nickname: '가' }, message: '!내정보 생성' });
  time += 21000; // 봇의 응답 간격이 지나야 두 번째 프로필도 만들어집니다.
  engine.handle('a', { id: 'second', user: { id: 'u2', nickname: '나' }, message: '!내정보 생성' });
  const user = id => store.load('a').users[id];
  const setSettings = patch => store.transaction('a', r => Object.assign(r.settings, patch));
  return { store, engine, user, setSettings };
}
const gift = (id, amount, user = { id: 'u1', nickname: '가' }) => ({ id, amount, user });

test('기본값: 켜짐, 10스푼 이상, 복권 1장', () => {
  const s = defaults();
  assert.deepEqual([s.donationDonorTicketEnabled, s.donationDonorTicketMin, s.donationDonorTicketCount], [true, 10, 1]);
});

test('10스푼 미만은 지급하지 않고, 10스푼 이상이면 후원자 본인에게만 복권 1장을 줍니다', () => {
  const f = setup();
  assert.equal(f.engine.donationDonorTickets('a', gift('d1', 9)).text, null);
  assert.equal(f.user('u1').tickets, 0);
  // 정확히 10스푼도 대상입니다.
  const out = f.engine.donationDonorTickets('a', gift('d2', 10));
  assert.equal(out.text, '🎟️ 가님 10스푼 후원! 복권 1장 지급 (보유 1장)');
  assert.equal(f.user('u1').tickets, 1);
  assert.equal(f.user('u2').tickets, 0, '다른 청취자에게는 지급하지 않습니다');
  // 20스푼처럼 더 큰 후원도 같은 규칙으로 지급합니다. (장수는 설정값)
  assert.match(f.engine.donationDonorTickets('a', gift('d3', 20)).text, /복권 1장 지급 \(보유 2장\)/);
  // 지급 기록: 후원으로 인한 후원자 지급 표시가 붙습니다.
  const logs = f.store.logs('a').filter(l => l.type === 'ticket-grant' && l.data.source === 'donation');
  assert.equal(logs.length, 2);
  assert.ok(logs.every(l => l.user === 'u1' && l.data.donor === true && l.data.count === 1));
});

test('같은 후원 알림이 다시 들어와도 한 번만 지급합니다', () => {
  const f = setup();
  assert.ok(f.engine.donationDonorTickets('a', gift('same', 10)).text);
  assert.equal(f.engine.donationDonorTickets('a', gift('same', 10)).text, null);
  assert.equal(f.user('u1').tickets, 1);
  assert.ok(f.engine.donationDonorTickets('a', gift('other', 10)).text);
  assert.equal(f.user('u1').tickets, 2);
});

test('프로필이 없는 후원자는 프로필을 만들어 복권을 줍니다', () => {
  const f = setup();
  const out = f.engine.donationDonorTickets('a', gift('d1', 15, { id: 'new-donor', nickname: '새후원자' }));
  assert.match(out.text, /^🎟️ 새후원자님 15스푼 후원! 복권 1장 지급/);
  assert.equal(f.user('new-donor').tickets, 1);
  assert.equal(f.store.load('b').users['new-donor'], undefined);
});

test('설정을 바꾸면 기준과 복권 수가 바뀌고, 끄면 지급하지 않습니다', () => {
  const f = setup();
  f.setSettings({ donationDonorTicketMin: 100, donationDonorTicketCount: 3 });
  assert.equal(f.engine.donationDonorTickets('a', gift('d1', 99)).text, null);
  assert.match(f.engine.donationDonorTickets('a', gift('d2', 100)).text, /복권 3장 지급 \(보유 3장\)/);
  f.setSettings({ donationDonorTicketEnabled: false });
  assert.equal(f.engine.donationDonorTickets('a', gift('d3', 500)).text, null);
  assert.equal(f.user('u1').tickets, 3);
});

test('잘못된 후원 정보는 무시합니다', () => {
  const f = setup();
  for (const bad of [{ amount: 50, user: { id: 'u1' } }, { id: 'x', amount: 50 }, { id: 'x', amount: 50, user: {} }, { id: 'x', amount: 'abc', user: { id: 'u1' } }, { id: 'x', amount: 12.5, user: { id: 'u1' } }, { id: 'x', user: { id: 'u1' } }])
    assert.equal(f.engine.donationDonorTickets('a', bad).text, null);
  assert.equal(f.user('u1').tickets, 0);
});

test('복권 보유량이 정수 범위를 넘으면 지급하지 않고 기록만 남깁니다', () => {
  const f = setup();
  f.store.transaction('a', r => { r.users.u1.tickets = Number.MAX_SAFE_INTEGER; });
  assert.equal(f.engine.donationDonorTickets('a', gift('d1', 50)).text, null);
  assert.equal(f.user('u1').tickets, Number.MAX_SAFE_INTEGER);
  assert.equal(f.store.logs('a').filter(l => l.type === 'donation-donor-ticket-failed').length, 1);
});

test('설정 값 검사와 이전 설정 불러오기', () => {
  const base = () => structuredClone(defaults());
  assert.equal(validateSettings(Object.assign(base(), { donationDonorTicketMin: 1, donationDonorTicketCount: 1000 })).donationDonorTicketCount, 1000);
  for (const patch of [{ donationDonorTicketEnabled: 'yes' }, { donationDonorTicketMin: 0 }, { donationDonorTicketMin: 1.5 }, { donationDonorTicketMin: 100000001 }, { donationDonorTicketCount: 0 }, { donationDonorTicketCount: 1001 }, { donationDonorTicketCount: null }])
    assert.throws(() => validateSettings(Object.assign(base(), patch)), /후원자 복권 지급/);
  const old = base(); delete old.donationDonorTicketEnabled; delete old.donationDonorTicketMin; delete old.donationDonorTicketCount;
  const loaded = validateSettings(old);
  assert.deepEqual([loaded.donationDonorTicketEnabled, loaded.donationDonorTicketMin, loaded.donationDonorTicketCount], [true, 10, 1]);
});

test('웹 관리 화면의 후원자 복권 카드가 현재 설정을 보여 줍니다', () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function donationDonorTicketPanel(){');
  const end = source.indexOf('\n}\n', start) + 3;
  assert.ok(start >= 0 && end > start);
  const render = settings => {
    const context = { room: { settings }, card: (title, body) => `${title}|${body}`, toggle: key => `[toggle:${key}]`, field: (label, key) => `[field:${key}]`, saveButton: () => '[save]', num: value => Number(value).toLocaleString('ko-KR') };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.html=donationDonorTicketPanel();`, context);
    return context.html;
  };
  const on = render({ donationDonorTicketEnabled: true, donationDonorTicketMin: 10, donationDonorTicketCount: 1 });
  assert.ok(on.includes('후원 시 복권 · 후원자') && on.includes('[toggle:donationDonorTicketEnabled]') && on.includes('[field:donationDonorTicketMin]') && on.includes('[field:donationDonorTicketCount]') && on.includes('[save]'));
  assert.ok(on.includes('10스푼 이상 → 1장'));
  assert.ok(render({ donationDonorTicketEnabled: false, donationDonorTicketMin: 10, donationDonorTicketCount: 1 }).includes('지금 설정: 꺼짐'));
});
