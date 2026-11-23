// 복권 지급 대상을 @·고유 ID 없이 닉네임 일부만으로 찾는지 검사합니다. (이모지·기호가 달라도, 프로필이 없고 채팅만 한 청취자도)
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, Store } from '../core.mjs';
import { resolveTarget, coreKey, parseTicketGrant } from '../targets.mjs';

const users = {
  a1: { id: 'a1', name: '🔒푼스따까리개발자코나N9ღ ★ₒ°🔒' },
  b2: { id: 'b2', name: '별빛소녀' },
  c3: { id: 'c3', name: '별빛 라디오' },
};

test('닉네임의 이모지·기호·공백이 달라도 글자만으로 찾습니다', () => {
  assert.equal(coreKey('🔒코나 N9ღ ★'), '코나n9ღ', '이모지·별·공백은 빠지고 글자(ღ 포함)와 숫자만 남음');
  assert.equal(coreKey('✨별 빛☆소녀!!'), '별빛소녀');
  assert.equal(resolveTarget(users, '코나'), 'a1');
  assert.equal(resolveTarget(users, '코나N9'), 'a1');
  assert.equal(resolveTarget(users, '코나 N9'), 'a1', '띄어쓰기가 달라도');
  assert.equal(resolveTarget(users, '개발자 코나'), 'a1', '꾸밈 글자를 빼고 이어 붙여도');
  assert.equal(resolveTarget(users, '푼스따까리'), 'a1');
  assert.equal(resolveTarget(users, '별빛소녀'), 'b2');
  assert.equal(resolveTarget(users, '별빛 라디오'), 'c3');
  assert.equal(resolveTarget(users, '@코나'), 'a1', '@를 붙여도 됩니다');
  // 겹치면 후보를 보여 주고, 한 글자나 없는 이름은 찾지 못합니다.
  assert.throws(() => resolveTarget(users, '별빛'), /여러 명과 일치합니다/);
  assert.throws(() => resolveTarget(users, '☆'), /일치하는 청취자가 없습니다. 닉네임 일부만 입력해도 돼요/, '기호만 입력하면 찾지 않음');
  assert.throws(() => resolveTarget(users, '없는사람'), /일치하는 청취자가 없습니다/);
});

test('!복권지급 사용법과 입력 분리: 닉네임에 띄어쓰기가 있어도 마지막 숫자를 수량으로 봅니다', () => {
  assert.deepEqual(parseTicketGrant('코나 N9 3'), { target: '코나 N9', countText: '3' });
  assert.deepEqual(parseTicketGrant('코나'), { target: '코나', countText: '1' });
  assert.throws(() => parseTicketGrant(''), /사용법: !복권지급 닉네임 수량 \(@·고유 ID 없이/);
});

function setup() {
  const store = new Store();
  let time = Date.parse('2026-11-23T12:00:00Z'), counter = 0;
  const engine = new Engine(store, { now: () => time, int: a => a });
  store.create('room', '방송');
  const say = (message, { id = 'dj1', name = 'DJ', dj = true } = {}) => { time += 21000; return engine.handle('room', { id: `e${++counter}`, user: { id, nickname: name }, message, isDj: dj }).text; };
  const room = () => store.load('room');
  return { store, engine, say, room, advance: ms => { time += ms; }, time: () => time };
}

test('프로필이 없어도 채팅·후원으로 본 청취자는 닉네임 일부로 복권을 받습니다 (프로필 자동 생성)', () => {
  const f = setup();
  // 본 적 없는 사람은 찾을 수 없습니다.
  assert.match(f.say('!복권지급 코나 3'), /일치하는 청취자가 없습니다. 닉네임 일부만 입력해도 돼요/);
  f.engine.noteSeen('room', { id: 'sp-77', nickname: '🔒코나N9ღ ★' });
  assert.equal(f.room().users['sp-77'], undefined, '기록만 하고 프로필은 만들지 않음');
  assert.match(f.say('!복권지급 코나 2'), /🔒코나N9ღ ★님 복권 2장 지급 · 보유 2장/);
  assert.equal(f.room().users['sp-77'].tickets, 2);
  assert.equal(f.room().users['sp-77'].name, '🔒코나N9ღ ★');
  // 이미 프로필이 있으면 그 프로필에 더해 줍니다.
  assert.match(f.say('!복권지급 코나 1'), /보유 3장/);
  assert.equal(Object.keys(f.room().users).length, 1);
});

test('@고유 ID로도, 같은 이름이 여러 명이면 후보 안내로 이어집니다', () => {
  const f = setup();
  f.engine.noteSeen('room', { id: 'sp-1', nickname: '별빛소녀' });
  f.engine.noteSeen('room', { id: 'sp-2', nickname: '별빛라디오' });
  assert.match(f.say('!복권지급 별빛 1'), /여러 명과 일치합니다. @닉네임을 더 길게 입력하세요. 후보: @별빛소녀 \/ @별빛라디오/);
  assert.equal(Object.keys(f.room().users).length, 0, '실패하면 프로필을 만들지 않음');
  assert.match(f.say('!복권지급 @sp-2 4'), /별빛라디오님 복권 4장 지급/);
  assert.match(f.say('!복권지급 별빛소 1'), /별빛소녀님 복권 1장 지급/);
});

test('최근 본 청취자 기록: 10분에 한 번만, DJ 본인 제외, 최근 300명까지', () => {
  const f = setup();
  f.engine.noteSeen('room', { id: 'u1', nickname: '처음이름' });
  f.engine.noteSeen('room', { id: 'u1', nickname: '바뀐이름' });
  assert.equal(f.room().seen.u1.name, '처음이름', '10분 안에는 다시 기록하지 않음');
  f.advance(10 * 60000 + 1);
  f.engine.noteSeen('room', { id: 'u1', nickname: '바뀐이름' });
  assert.equal(f.room().seen.u1.name, '바뀐이름');
  f.engine.noteSeen('room', { id: 'room', nickname: '방주인' });
  for (const bad of [{}, { id: 'x' }, { nickname: 'y' }, { id: '', nickname: 'z' }, null, undefined]) f.engine.noteSeen('room', bad);
  assert.deepEqual(Object.keys(f.room().seen), ['u1']);
  for (let i = 0; i < 310; i++) { f.advance(1000); f.engine.noteSeen('room', { id: 'm' + i, nickname: '청취자' + i }); }
  const ids = Object.keys(f.room().seen);
  assert.equal(ids.length, 300);
  assert.ok(!ids.includes('u1') && !ids.includes('m0') && ids.includes('m309'), '가장 오래된 기록부터 지워짐');
});
