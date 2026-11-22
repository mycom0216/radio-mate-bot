// 큰 후원이 들어오면 등록된 모든 청취자에게 복권을 지급하는 기능을 검사하는 테스트입니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Engine, Store, validateSettings } from '../core.mjs';

// 방 'a'에 청취자 3명(u1, u2, u3)을 등록하고, 설정을 고칠 수 있게 돌려줍니다.
function setup() {
  const store = new Store();
  let time = Date.parse('2026-11-16T00:00:00Z'), counter = 0;
  const engine = new Engine(store, { now: () => time, int: (a) => a });
  store.create('a', 'A'); store.create('b', 'B');
  const say = (id, name, message) => {
    time += 21000;
    return engine.handle('a', { id: `event-${++counter}`, user: { id, nickname: name }, message });
  };
  for (const [id, name] of [['u1', '가'], ['u2', '나'], ['u3', '다']]) say(id, name, '!내정보 생성');
  // 설정을 켭니다: 100스푼 이상이면 1명당 2장.
  const enable = (patch = {}) => store.transaction('a', r => Object.assign(r.settings, { donationTicketEnabled: true, donationTicketMin: 100, donationTicketCount: 2 }, patch));
  const tickets = () => Object.fromEntries(Object.entries(store.load('a').users).map(([id, u]) => [id, u.tickets]));
  return { store, engine, enable, tickets };
}

test('기본값은 꺼져 있어서 큰 후원이 와도 지급하지 않습니다', () => {
  const f = setup();
  assert.equal(f.store.load('a').settings.donationTicketEnabled, false);
  assert.equal(f.engine.donationTicketsToAll('a', { id: 'd1', amount: 5000, user: { nickname: '후원자' } }).text, null);
  assert.deepEqual(f.tickets(), { u1: 0, u2: 0, u3: 0 });
});

test('기준 미만 후원은 지급하지 않고, 기준 이상이면 모든 청취자에게 지급합니다', () => {
  const f = setup(); f.enable();
  assert.equal(f.engine.donationTicketsToAll('a', { id: 'd1', amount: 99, user: { nickname: '후원자' } }).text, null);
  assert.deepEqual(f.tickets(), { u1: 0, u2: 0, u3: 0 });
  // 기준과 정확히 같은 100스푼도 지급 대상입니다.
  const out = f.engine.donationTicketsToAll('a', { id: 'd2', amount: 100, user: { nickname: '큰손' } });
  assert.match(out.text, /큰손님의 100스푼 후원! 모든 청취자 3명에게 복권 2장씩 지급/);
  assert.deepEqual(f.tickets(), { u1: 2, u2: 2, u3: 2 });
  // 지급 기록: 사람마다 한 건, 후원으로 인한 전체 지급 표시가 붙습니다.
  const logs = f.store.logs('a').filter(l => l.type === 'ticket-grant' && l.data.source === 'donation');
  assert.equal(logs.length, 3);
  assert.ok(logs.every(l => l.data.all === true && l.data.count === 2 && l.data.amount === 100));
});

test('같은 후원이 다시 들어와도 한 번만 지급합니다', () => {
  const f = setup(); f.enable();
  const gift = { id: 'same-gift', amount: 300, user: { nickname: '후원자' } };
  assert.ok(f.engine.donationTicketsToAll('a', gift).text);
  assert.equal(f.engine.donationTicketsToAll('a', gift).text, null);
  assert.deepEqual(f.tickets(), { u1: 2, u2: 2, u3: 2 });
  // 다른 후원은 다시 지급합니다.
  assert.ok(f.engine.donationTicketsToAll('a', { ...gift, id: 'next-gift' }).text);
  assert.deepEqual(f.tickets(), { u1: 4, u2: 4, u3: 4 });
});

test('한 명이라도 보유 한도를 넘으면 아무에게도 지급하지 않고 기록만 남깁니다', () => {
  const f = setup(); f.enable();
  f.store.transaction('a', r => { r.users.u2.tickets = Number.MAX_SAFE_INTEGER - 1; });
  const out = f.engine.donationTicketsToAll('a', { id: 'd1', amount: 500, user: { nickname: '후원자' } });
  assert.equal(out.text, null);
  assert.equal(f.store.load('a').users.u1.tickets, 0);
  assert.equal(f.store.logs('a').filter(l => l.type === 'donation-tickets-failed').length, 1);
});

test('청취자가 없는 방, 다른 방에는 지급하지 않습니다', () => {
  const f = setup(); f.enable();
  f.store.transaction('b', r => Object.assign(r.settings, { donationTicketEnabled: true, donationTicketMin: 1, donationTicketCount: 1 }));
  assert.equal(f.engine.donationTicketsToAll('b', { id: 'd1', amount: 10, user: { nickname: '후원자' } }).text, null);
  assert.deepEqual(Object.keys(f.store.load('b').users), []);
  assert.deepEqual(f.tickets(), { u1: 0, u2: 0, u3: 0 });
});

test('잘못된 후원 정보는 무시합니다', () => {
  const f = setup(); f.enable();
  for (const bad of [{ amount: 500 }, { id: 'x', amount: 'abc' }, { id: 'x', amount: 1.5 }, { id: 'x' }])
    assert.equal(f.engine.donationTicketsToAll('a', bad).text, null);
  assert.deepEqual(f.tickets(), { u1: 0, u2: 0, u3: 0 });
});

test('설정 값 검사: 켜기/끄기·기준 스푼·복권 수', () => {
  const f = setup();
  const base = () => structuredClone(f.store.load('a').settings);
  const ok = Object.assign(base(), { donationTicketEnabled: true, donationTicketMin: 100, donationTicketCount: 1000 });
  assert.equal(validateSettings(ok).donationTicketCount, 1000);
  for (const patch of [{ donationTicketEnabled: 'yes' }, { donationTicketMin: 0 }, { donationTicketMin: 1.5 }, { donationTicketMin: 100000001 }, { donationTicketCount: 0 }, { donationTicketCount: 1001 }, { donationTicketCount: 'a' }])
    assert.throws(() => validateSettings(Object.assign(base(), patch)), /큰 후원 복권 지급/);
  // 이 기능이 생기기 전에 저장한 설정은 꺼진 상태로 불러옵니다.
  const old = base(); delete old.donationTicketEnabled; delete old.donationTicketMin; delete old.donationTicketCount;
  const loaded = validateSettings(old);
  assert.equal(loaded.donationTicketEnabled, false);
  assert.equal(loaded.donationTicketCount, 1);
});

test('웹 관리 화면의 설정 카드가 현재 설정을 보여 줍니다', () => {
  // public/app.js 안의 donationTicketPanel 함수만 잘라 가짜 화면 도구와 함께 실행합니다.
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function donationTicketPanel(){');
  const end = source.indexOf('\n}\n', start) + 3;
  assert.ok(start >= 0 && end > start, 'app.js에서 donationTicketPanel을 찾을 수 없습니다.');
  const render = settings => {
    const context = {
      room: { settings },
      card: (title, body) => `${title}|${body}`,
      toggle: key => `[toggle:${key}]`,
      field: (label, key) => `[field:${key}]`,
      saveButton: () => '[save]',
      num: value => Number(value).toLocaleString('ko-KR'),
    };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.html=donationTicketPanel();`, context);
    return context.html;
  };
  const off = render({ donationTicketEnabled: false, donationTicketMin: 100, donationTicketCount: 1 });
  assert.ok(off.includes('큰 후원 · 복권 전체 지급') && off.includes('[toggle:donationTicketEnabled]') && off.includes('[field:donationTicketMin]') && off.includes('[field:donationTicketCount]') && off.includes('[save]'));
  assert.ok(off.includes('지금 설정: 꺼짐'));
  assert.ok(render({ donationTicketEnabled: true, donationTicketMin: 1500, donationTicketCount: 3 }).includes('1,500스푼 이상 → 1명당 3장'));
});
