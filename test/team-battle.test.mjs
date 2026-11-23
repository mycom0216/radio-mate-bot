// 청팀·백팀 후원 대결: 팀을 고르고, 목표 스푼(기본 100)을 먼저 모은 팀이 이기는지 검사하는 테스트입니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, Store, defaults, validateSettings } from '../core.mjs';

function setup() {
  const store = new Store();
  let time = Date.parse('2026-11-23T12:00:00Z'), counter = 0;
  const engine = new Engine(store, { now: () => time, int: a => a });
  store.create('room1', '방송');
  const say = (message, { id = 'u1', name = '가', dj = false } = {}) => {
    time += 21000;
    return engine.handle('room1', { id: `chat-${++counter}`, user: { id, nickname: name }, message, isDj: dj });
  };
  const dj = message => say(message, { id: 'dj1', name: 'DJ', dj: true });
  // 모의 후원: 실제 방송과 같은 처리(processDonation)를 거칩니다. 받은 메시지 목록을 돌려줍니다.
  const donate = (id, amount, eventId = `gift-${++counter}`) => engine.processDonation('room1', { id: eventId, data: { amount, user: { id, nickname: id } } });
  const room = () => store.load('room1');
  const user = id => room().users[id];
  const setSettings = patch => store.transaction('room1', r => Object.assign(r.settings, patch));
  const advance = ms => { time += ms; };
  const tick = () => store.transaction('room1', r => engine.battleTick(r, time));
  // 청팀 2명(b1·b2), 백팀 2명(w1·w2)이 참가한 상태를 만듭니다.
  const startFour = () => {
    dj('!대결 시작 5');
    say('!대결 청', { id: 'b1', name: 'b1' }); say('!대결 청팀', { id: 'b2', name: 'b2' });
    say('!대결 백', { id: 'w1', name: 'w1' }); say('!대결 백팀', { id: 'w2', name: 'w2' });
  };
  return { store, engine, say, dj, donate, room, user, setSettings, advance, tick, startFour };
}
const texts = result => result.messages.map(m => m.text);

test('기본 설정: 목표 100스푼, 선물 약속 100스푼', () => {
  const s = defaults();
  assert.deepEqual([s.battleTargetSpoons, s.battleTeamGiftSpoons], [100, 100]);
});

test('!대결 시작으로 팀 대결을 열고, 청·백 중 팀을 골라 참가합니다', () => {
  const f = setup();
  assert.match(f.say('!대결 시작 5', { id: 'u9', name: '아무개' }).text, /DJ 전용/);
  const start = f.dj('!대결 시작 5').text;
  assert.match(start, /^⚔️ 청팀 vs 백팀 대결 시작! 100스푼을 먼저 모으는 팀이 승리 · 5분 · 팀 선택: !대결 청 \/ !대결 백$/);
  assert.equal(f.room().battle.mode, 'team');
  // 팀을 고르지 않으면 안내하고, 모르는 글자는 사용법을 보여 줍니다.
  assert.match(f.say('!대결', { id: 'b1', name: 'b1' }).text, /!대결 청 또는 !대결 백으로 팀을 골라/);
  assert.match(f.say('!대결 노랑', { id: 'b1', name: 'b1' }).text, /사용법: !대결 청 \/ !대결 백/);
  assert.match(f.say('!대결 청', { id: 'b1', name: 'b1' }).text, /b1님 청팀 참가! 청팀 1명 · 백팀 0명 · 100스푼 먼저 모으는 팀 승리/);
  assert.match(f.say('!대결 백', { id: 'w1', name: 'w1' }).text, /w1님 백팀 참가! 청팀 1명 · 백팀 1명/);
  // 같은 사람이 같은 팀을 다시 고르면 이미 참가 안내, 후원 전이면 팀을 바꿀 수 있습니다.
  assert.match(f.say('!대결 청', { id: 'b1', name: 'b1' }).text, /b1님은 이미 청팀이에요 · 현재 0스푼/);
  assert.match(f.say('!대결 백', { id: 'b1', name: 'b1' }).text, /b1님 백팀 참가! 청팀 0명 · 백팀 2명/);
  // DJ는 참가할 수 없고, 다른 말 없이 !대결만 입력하면 현황을 봅니다.
  assert.match(f.dj('!대결 청').text, /DJ는 대결에 참가할 수 없어요/);
  assert.match(f.dj('!대결').text, /팀 대결 진행 중 · 청팀 0\/100스푼\(0명\) vs 백팀 0\/100스푼\(2명\)/);
});

test('목표 스푼을 먼저 모은 팀이 바로 이기고, 이긴 팀 후원자에게 보상이 갑니다', () => {
  const f = setup(); f.startFour();
  assert.equal(f.donate('b1', 40).battleEnded, false, '아직 승부가 나지 않았습니다');
  f.donate('w1', 70);
  f.donate('b2', 30); // 청팀 70
  const last = f.donate('w2', 40); // 백팀 110 → 백팀 승리
  assert.equal(last.battleEnded, true);
  const result = texts(last).at(-1);
  assert.match(result, /^🏆 백팀 승리! 먼저 100스푼 달성 \(청팀 70 · 백팀 110\)\n승리 팀 후원자 2명 \+300PT\+300EXP\n🎁 선물 약속: 진 팀이 이긴 팀에 100스푼 \(직접 전달·이긴 팀끼리 나눠 가져요\)$/);
  // 이긴 팀 후원자(w1·w2)만 PT·EXP를 받고, 진 팀과 대결로는 아무것도 받지 못합니다. (후원 레벨 EXP는 별도)
  const prize = id => [f.user(id).pt, f.user(id).exp];
  assert.deepEqual([f.user('w1').pt, f.user('w2').pt, f.user('b1').pt, f.user('b2').pt], [300, 300, 0, 0]);
  assert.equal(prize('w1')[1] - 70 * 20, 300, '후원 레벨 EXP(스푼×20)에 대결 보상 300이 더해짐');
  assert.equal(f.room().battle, undefined);
  assert.equal(f.room().lastBattle.winner, 'white');
  // 승부가 난 뒤의 후원은 합산하지 않습니다.
  assert.equal(f.engine.battleDonation('room1', { id: 'late', amount: 500, user: { id: 'b1' } }), false);
  // 기록과 현황
  assert.equal(f.store.logs('room1').filter(l => l.type === 'battle' && l.data.mode === 'team').length, 2);
  assert.match(f.say('!대결 현황', { id: 'b1', name: 'b1' }).text, /지난 팀 대결 백팀 승리 \(청팀 70 · 백팀 110 \/ 목표 100스푼\)/);
});

test('한 번에 100스푼 이상을 후원해도 그 팀이 바로 이깁니다 (100 이상 포함)', () => {
  const f = setup(); f.startFour();
  const result = f.donate('b1', 100);
  assert.equal(result.battleEnded, true);
  assert.match(texts(result).at(-1), /^🏆 청팀 승리! 먼저 100스푼 달성 \(청팀 100 · 백팀 0\)/);
  assert.equal(f.user('b1').pt, 300);
});

test('같은 후원 알림이 다시 와도 한 번만 합산합니다', () => {
  const f = setup(); f.startFour();
  f.donate('b1', 60, 'same'); f.donate('b1', 60, 'same');
  assert.equal(f.room().battle.participants.b1.total, 60);
});

test('양 팀에 1명씩 없으면 승부가 나지 않고, 상대 팀 첫 참가자가 생기면 바로 승부가 납니다', () => {
  const f = setup();
  f.dj('!대결 시작 5');
  f.say('!대결 청', { id: 'b1', name: 'b1' });
  const alone = f.donate('b1', 150);
  assert.equal(alone.battleEnded, false);
  assert.equal(f.room().battle.participants.b1.total, 150);
  // 백팀에 첫 참가자가 들어오면 이미 목표를 넘긴 청팀이 바로 승리합니다.
  const joined = f.say('!대결 백', { id: 'w1', name: 'w1' }).text;
  assert.match(joined, /^🏆 청팀 승리! 먼저 100스푼 달성 \(청팀 150 · 백팀 0\)/);
  assert.equal(f.room().battle, undefined);
});

test('후원한 뒤에는 팀을 바꿀 수 없습니다', () => {
  const f = setup(); f.startFour();
  f.donate('b1', 10);
  assert.match(f.say('!대결 백', { id: 'b1', name: 'b1' }).text, /이미 후원한 뒤에는 팀을 바꿀 수 없어요/);
});

test('시간이 끝났는데 목표에 닿은 팀이 없으면 승부 없음으로 끝납니다', () => {
  const f = setup(); f.startFour();
  f.donate('b1', 60); f.donate('w1', 30);
  assert.equal(f.tick(), null);
  f.advance(5 * 60000);
  const ended = f.tick();
  assert.equal(ended.text, '⚔️ 팀 대결 종료 · 100스푼에 먼저 닿은 팀이 없어요 (청팀 60 · 백팀 30) · 보상 없음');
  assert.equal(f.user('b1').pt, 0);
  assert.equal(f.tick(), null);
});

test('DJ가 직접 종료·취소할 수 있습니다', () => {
  const f = setup(); f.startFour();
  f.donate('w1', 20);
  assert.match(f.dj('!대결 종료').text, /팀 대결 종료 · 100스푼에 먼저 닿은 팀이 없어요 \(청팀 0 · 백팀 20\)/);
  f.dj('!대결 시작 5');
  assert.match(f.dj('!대결 취소').text, /후원 대결을 취소했어요/);
  assert.equal(f.room().battle, undefined);
});

test('목표 스푼과 시간을 시작할 때 정하거나 설정으로 바꿉니다', () => {
  const f = setup();
  assert.match(f.dj('!대결 시작 3 300').text, /300스푼을 먼저 모으는 팀이 승리 · 3분/);
  assert.equal(f.room().battle.target, 300);
  f.dj('!대결 취소');
  for (const bad of ['0', '121', 'abc']) assert.match(f.dj(`!대결 시작 ${bad}`).text, /사용법: !대결 시작 5/);
  for (const bad of ['0', 'x', '1000001']) assert.match(f.dj(`!대결 시작 5 ${bad}`).text, /목표 스푼은 1~1,000,000/);
  f.setSettings({ battleTargetSpoons: 50, battleTeamGiftSpoons: 0 });
  f.dj('!대결 시작 5');
  assert.equal(f.room().battle.target, 50);
  f.say('!대결 청', { id: 'b1', name: 'b1' }); f.say('!대결 백', { id: 'w1', name: 'w1' });
  const result = texts(f.donate('b1', 50)).at(-1);
  assert.ok(!result.includes('선물 약속'), '선물 약속을 0으로 두면 안내 줄이 없습니다');
});

test('개인 대결은 !대결 개인 시작으로 그대로 쓸 수 있습니다', () => {
  const f = setup();
  assert.match(f.dj('!대결 개인 시작 5').text, /후원 대결 시작! 5분 · 참가는 !대결/);
  assert.equal(f.room().battle.mode, 'solo');
  assert.match(f.say('!대결', { id: 'a1', name: 'a1' }).text, /a1님 대결 참가!/);
  // 개인전 중에 팀 이름을 쓰면 안내합니다.
  assert.match(f.say('!대결 청', { id: 'a2', name: 'a2' }).text, /이번 대결은 개인전이에요/);
  f.dj('!대결 취소');
  // 팀전 중에 '개인'으로 참가하려 하면 안내합니다.
  f.dj('!대결 시작 5');
  assert.match(f.say('!대결 개인', { id: 'a3', name: 'a3' }).text, /이번 대결은 팀전이에요/);
});

test('설정 값 검사와 이전 설정 불러오기', () => {
  const base = () => structuredClone(defaults());
  assert.equal(validateSettings(Object.assign(base(), { battleTargetSpoons: 1000000, battleTeamGiftSpoons: 0 })).battleTargetSpoons, 1000000);
  for (const patch of [{ battleTargetSpoons: 0 }, { battleTargetSpoons: 1000001 }, { battleTargetSpoons: 1.5 }, { battleTeamGiftSpoons: -1 }, { battleTeamGiftSpoons: 100001 }, { battleTeamGiftSpoons: 'a' }])
    assert.throws(() => validateSettings(Object.assign(base(), patch)), /팀 대결/);
  const old = base(); delete old.battleTargetSpoons; delete old.battleTeamGiftSpoons;
  const loaded = validateSettings(old);
  assert.deepEqual([loaded.battleTargetSpoons, loaded.battleTeamGiftSpoons], [100, 100]);
});
