// 복권 "전체 지급"(!복권지급 전체 수량)을 검사하는 테스트입니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, Store } from '../core.mjs';

// 방 'a'에 청취자 3명(u1, u2, u3)을 등록해 두고 시작하는 준비 함수입니다.
function setup() {
  const store = new Store();
  let time = Date.parse('2026-11-16T00:00:00Z'), counter = 0;
  const engine = new Engine(store, { now: () => time, int: (a) => a });
  store.create('a', 'A'); store.create('b', 'B');
  // 채팅 한 줄을 보냅니다. 같은 사람이 너무 빨리 보내지 않도록 시간을 21초씩 흘려 보냅니다.
  const say = (message, { id = 'u1', name = '청취자', dj = false, room = 'a' } = {}) => {
    time += 21000;
    return engine.handle(room, { id: `event-${++counter}`, user: { id, nickname: name }, message, isDj: dj });
  };
  for (const [id, name] of [['u1', '가'], ['u2', '나'], ['u3', '다']]) say('!내정보 생성', { id, name });
  const tickets = (room = 'a') => Object.fromEntries(Object.entries(store.load(room).users).map(([id, u]) => [id, u.tickets]));
  return { store, engine, say, tickets };
}

test('DJ가 !복권지급 전체 3을 입력하면 등록된 모든 청취자에게 3장씩 지급합니다', () => {
  const f = setup();
  f.say('!복권지급 @u1 5', { dj: true });
  const out = f.say('!복권지급 전체 3', { dj: true });
  assert.match(out.text, /전체 3명에게 복권 3장씩 지급 · 총 9장/);
  assert.deepEqual(f.tickets(), { u1: 8, u2: 3, u3: 3 });
  // 사람마다 지급 기록이 남고, 전체 지급 표시(all)가 붙습니다.
  const logs = f.store.logs('a').filter(l => l.type === 'ticket-grant' && l.data.all);
  assert.equal(logs.length, 3);
  assert.ok(logs.every(l => l.data.count === 3));
  // 다른 방에는 영향이 없습니다.
  assert.deepEqual(Object.values(f.tickets('b')), []);
});

test('전체 지급은 DJ만 할 수 있습니다', () => {
  const f = setup();
  assert.match(f.say('!복권지급 전체 3', { id: 'u2' }).text, /DJ 전용/);
  assert.deepEqual(f.tickets(), { u1: 0, u2: 0, u3: 0 });
});

test('수량이 없거나 범위를 벗어나면 아무에게도 지급하지 않습니다', () => {
  const f = setup();
  assert.match(f.say('!복권지급 전체', { dj: true }).text, /사용법: !복권지급 전체 수량/);
  assert.match(f.say('!복권지급 전체 0', { dj: true }).text, /1~1,000장/);
  assert.match(f.say('!복권지급 전체 -2', { dj: true }).text, /1~1,000장/);
  assert.match(f.say('!복권지급 전체 1001', { dj: true }).text, /1~1,000장/);
  assert.deepEqual(f.tickets(), { u1: 0, u2: 0, u3: 0 });
  // 상한인 1,000장은 지급됩니다.
  assert.match(f.say('!복권지급 전체 1000', { dj: true }).text, /1,000장씩/);
  assert.deepEqual(f.tickets(), { u1: 1000, u2: 1000, u3: 1000 });
});

test('한 명이라도 보유 한도를 넘으면 모두 지급하지 않습니다', () => {
  const f = setup();
  f.store.transaction('a', r => { r.users.u2.tickets = Number.MAX_SAFE_INTEGER - 1; });
  assert.match(f.say('!복권지급 전체 5', { dj: true }).text, /아무에게도 지급하지 않았습니다/);
  assert.equal(f.store.load('a').users.u1.tickets, 0);
  assert.equal(f.store.load('a').users.u3.tickets, 0);
});

test('청취자가 없으면 지급하지 않고 안내합니다', () => {
  const f = setup();
  assert.match(f.say('!복권지급 전체 2', { dj: true, room: 'b' }).text, /지급할 청취자가 없습니다/);
});

test('닉네임이 전체인 청취자는 @전체로 한 명에게만 지급할 수 있습니다', () => {
  const f = setup();
  f.say('!내정보 생성', { id: 'u9', name: '전체' });
  f.say('!복권지급 @전체 2', { dj: true });
  assert.deepEqual(f.tickets(), { u1: 0, u2: 0, u3: 0, u9: 2 });
});
