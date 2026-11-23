// 새 기능이 생기기 전에 저장된 방(새 설정 값이 없는 방)에서도 기능이 정상 동작하는지 검사하는 테스트입니다.
// 방금까지의 시험은 새로 만든 방(기본 설정이 모두 있음)만 썼기 때문에, 이미 운영 중인 방에서 생기는 문제를 놓쳤습니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, Store, defaults } from '../core.mjs';

// 이 기능들이 생기기 전에는 없던 설정 키 전부
const NEW_KEYS = ['fishingWho', 'fishingLuck', 'donationTicketEnabled', 'donationTicketMin', 'donationTicketCount', 'donationExpEnabled', 'donationExpMin', 'donationExpPerSpoon', 'donationDonorTicketEnabled', 'donationDonorTicketMin', 'donationDonorTicketCount', 'lotteryFirstExp', 'lotteryFirstPt', 'lotterySecondExp', 'lotterySecondPt', 'lotteryThirdExp', 'lotteryThirdPt', 'battleEnabled', 'battleMinutes', 'battleGiftSpoons', 'battleFirstPt', 'battleFirstExp', 'battleSecondPt', 'battleSecondExp', 'battleThirdPt', 'battleThirdExp'];

// 저장된 방 데이터에서 새 설정 키를 직접 지워, 예전 버전에서 저장한 방처럼 만듭니다.
function setup() {
  const store = new Store();
  let time = Date.parse('2026-11-16T00:00:00Z'), counter = 0;
  const engine = new Engine(store, { now: () => time, int: (a) => a });
  store.create('room1', '방송');
  const say = (message, { id = 'u1', name = '가', dj = false } = {}) => {
    time += 21000;
    return engine.handle('room1', { id: `chat-${++counter}`, user: { id, nickname: name }, message, isDj: dj });
  };
  say('!내정보 생성');
  store.transaction('room1', r => { r.users.u1.tickets = 10; r.settings.fishing = true; });
  const row = store.db.prepare('SELECT data FROM rooms WHERE id=?').get('room1');
  const raw = JSON.parse(row.data);
  for (const key of NEW_KEYS) delete raw.settings[key];
  store.db.prepare('UPDATE rooms SET data=? WHERE id=?').run(JSON.stringify(raw), 'room1');
  // 정말로 지워졌는지 저장된 원본을 확인합니다.
  const check = JSON.parse(store.db.prepare('SELECT data FROM rooms WHERE id=?').get('room1').data);
  assert.ok(NEW_KEYS.every(key => check.settings[key] === undefined), '시험 준비: 새 설정 키가 지워져 있어야 합니다');
  return { store, engine, say, time: () => time };
}

test('예전에 저장된 방을 불러오면 새 설정이 기본값으로 채워집니다', () => {
  const f = setup();
  const loaded = f.store.load('room1').settings, base = defaults();
  for (const key of NEW_KEYS) assert.deepEqual(loaded[key], base[key], key);
});

test('예전 방에서도 !복권이 오류 없이 등수 보상을 지급합니다', () => {
  const f = setup();
  // 숫자를 1 2 3으로 고르면 당첨 숫자도 1 2 3 이라(난수가 항상 최소값) 3개 일치 = 1등입니다.
  const out = f.say('!복권 1 2 3').text;
  assert.match(out, /3개 일치 · 1등! \+300 EXP \+300 PT/);
  const u = f.store.load('room1').users.u1;
  assert.deepEqual([u.exp, u.pt, u.tickets], [300, 300, 9]);
  // 자동 여러 장도 정수 범위 오류 없이 처리됩니다.
  assert.match(f.say('!복권 자동').text, /자동 복권 9장 사용 · 1등\(3개 일치\)/);
});

test('예전 방에서도 낚시가 정상 동작합니다 (행운 보너스·표시 방식 기본값)', () => {
  const f = setup();
  const out = f.say('!낚시').text;
  assert.match(out, /^🎣 가\(@u1\) · .+ \(.+\) \d+cm/);
});

test('예전 방에서도 후원 보상(EXP·후원자 복권)이 기본값으로 동작합니다', () => {
  const f = setup();
  const exp = f.engine.donationLevelUp('room1', { id: 'g1', amount: 20, user: { id: 'u1', nickname: '가' } });
  assert.match(exp.text, /\+400 EXP/);
  const ticket = f.engine.donationDonorTickets('room1', { id: 'g1', amount: 10, user: { id: 'u1', nickname: '가' } });
  assert.match(ticket.text, /복권 1장 지급/);
  // 큰 후원 복권 전체 지급은 기본 꺼짐이라 지급하지 않습니다.
  assert.equal(f.engine.donationTicketsToAll('room1', { id: 'g1', amount: 100000, user: { id: 'u1' } }).text, null);
});

test('예전 방에서도 후원 대결을 시작하고 참가할 수 있습니다', () => {
  const f = setup();
  assert.match(f.say('!대결 개인 시작 5', { id: 'dj1', name: 'DJ', dj: true }).text, /후원 대결 시작! 5분/);
  assert.match(f.say('!대결').text, /가님 대결 참가/);
});
