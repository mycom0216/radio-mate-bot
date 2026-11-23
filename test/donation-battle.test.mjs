// 후원 대결(!대결): 참가자들이 정해진 시간 동안 DJ에게 후원한 스푼 합계로 1·2·3등을 겨루는 기능을 검사하는 테스트입니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Engine, Store, defaults, validateSettings } from '../core.mjs';

// 방 'room1'을 만들고, 시간을 직접 흘려 보낼 수 있게 준비합니다.
function setup() {
  const store = new Store();
  let time = Date.parse('2026-11-16T00:00:00Z'), counter = 0;
  const engine = new Engine(store, { now: () => time, int: (a) => a });
  store.create('room1', '방송');
  // 채팅 한 줄을 보냅니다. 같은 사람의 명령 간격(쿨다운)을 지키도록 시간을 21초 흘립니다.
  const say = (message, { id = 'u1', name = '가', dj = false, delivery = false } = {}) => {
    time += 21000;
    return engine.handle('room1', { id: `chat-${++counter}`, user: { id, nickname: name }, message, isDj: dj, delivery });
  };
  const dj = (message, extra = {}) => say(message, { id: 'dj1', name: 'DJ', dj: true, ...extra });
  const donate = (id, amount, eventId = `gift-${++counter}`) => engine.battleDonation('room1', { id: eventId, amount, user: { id, nickname: id } });
  const advance = ms => { time += ms; };
  const room = () => store.load('room1');
  const user = id => room().users[id];
  const setSettings = patch => store.transaction('room1', r => Object.assign(r.settings, patch));
  const tick = () => store.transaction('room1', r => engine.battleTick(r, time));
  // 세 명(a1·b1·c1)이 대결에 참가한 상태를 만들어 줍니다.
  const startWithThree = () => {
    dj('!대결 시작 5');
    for (const id of ['a1', 'b1', 'c1']) say('!대결', { id, name: id });
  };
  return { store, engine, say, dj, donate, advance, room, user, setSettings, tick, startWithThree };
}

test('기본 설정: 켜짐, 5분, 선물 안내 10스푼, 보상 300/150/50', () => {
  const s = defaults();
  assert.deepEqual([s.battleEnabled, s.battleMinutes, s.battleGiftSpoons], [true, 5, 10]);
  assert.deepEqual([s.battleFirstPt, s.battleFirstExp, s.battleSecondPt, s.battleSecondExp, s.battleThirdPt, s.battleThirdExp], [300, 300, 150, 150, 50, 50]);
});

test('DJ만 시작·종료·취소할 수 있고, 분을 생략하면 설정값을 씁니다', () => {
  const f = setup();
  assert.match(f.say('!대결 시작 5').text, /DJ 전용/);
  assert.match(f.dj('!대결 종료').text, /진행 중인 대결이 없습니다/);
  assert.match(f.dj('!대결 시작').text, /후원 대결 시작! 5분/);
  assert.equal(f.room().battle.endsAt - f.room().battle.startedAt, 5 * 60000);
  assert.match(f.dj('!대결 시작 3').text, /이미 진행 중인 대결/);
  assert.match(f.say('!대결 종료', { id: 'u2' }).text, /DJ 전용/);
  assert.match(f.say('!대결 취소', { id: 'u2' }).text, /DJ 전용/);
  assert.match(f.dj('!대결 취소').text, /취소했어요/);
  assert.equal(f.room().battle, undefined);
  for (const bad of ['0', '121', 'abc', '1.5']) assert.match(f.dj(`!대결 시작 ${bad}`).text, /사용법: !대결 시작 5/);
});

test('방송 주인 계정은 isDj가 없어도 스푼 스트림(delivery)에서 오면 DJ로 인정합니다', () => {
  const f = setup();
  // 방 ID(room1)와 같은 계정이 실제 스트림에서 보낸 메시지
  assert.match(f.say('!대결 시작 2', { id: 'room1', name: '주인', delivery: true }).text, /후원 대결 시작! 2분/);
  // 같은 ID라도 스트림이 아닌 경로(delivery 없음)에서는 DJ가 아닙니다.
  assert.match(f.say('!대결 종료', { id: 'room1', name: '주인', delivery: false }).text, /DJ 전용/);
});

test('참가: 프로필이 자동으로 만들어지고 한 사람은 한 번만 참가합니다', () => {
  const f = setup();
  assert.match(f.say('!대결', { id: 'a1', name: '가' }).text, /진행 중인 대결이 없어요/);
  f.dj('!대결 시작 5');
  const joined = f.say('!대결', { id: 'new1', name: '새사람' }).text;
  assert.match(joined, /새사람님 대결 참가! \(참가 1명\)/);
  assert.equal(f.user('new1').name, '새사람');
  assert.match(f.say('!대결', { id: 'new1', name: '새사람' }).text, /이미 참가 중이에요 · 현재 0스푼/);
  // DJ가 !대결만 입력하면 참가가 아니라 현황을 보여 줍니다.
  assert.match(f.dj('!대결').text, /대결 진행 중 · 남은 \d+분 · 참가 1명 · 아직 후원 없음/);
  assert.equal(Object.keys(f.room().battle.participants).length, 1);
  assert.match(f.say('!대결 아무말', { id: 'u9' }).text, /사용법: !대결/);
});

test('참가자의 후원만, 참가한 뒤의 후원만, 같은 알림은 한 번만 합산합니다', () => {
  const f = setup();
  f.dj('!대결 시작 5');
  assert.equal(f.donate('a1', 40), false, '참가 전 후원은 합산하지 않습니다');
  f.say('!대결', { id: 'a1', name: '가' });
  assert.equal(f.donate('a1', 30, 'same'), true);
  assert.equal(f.donate('a1', 30, 'same'), false, '같은 후원 알림은 한 번만');
  assert.equal(f.donate('a1', 20, 'next'), true);
  assert.equal(f.donate('stranger', 100), false, '참가하지 않은 사람의 후원은 무시');
  assert.equal(f.donate('a1', 0), false);
  assert.equal(f.donate('a1', 12.5), false);
  assert.equal(f.room().battle.participants.a1.total, 50);
});

test('종료하면 후원 합계 순으로 1·2·3등을 정하고 PT·EXP를 지급합니다', () => {
  const f = setup(); f.startWithThree();
  f.say('!대결', { id: 'd1', name: 'd1' }); // 후원하지 않은 참가자
  f.donate('a1', 100); f.donate('b1', 300); f.donate('c1', 200);
  const result = f.dj('!대결 종료').text;
  assert.match(result, /^🏆 대결 결과 1등 b1 300스푼 \+300PT\+300EXP · 2등 c1 200스푼 \+150PT\+150EXP · 3등 a1 100스푼 \+50PT\+50EXP/);
  assert.match(result, /\n🎁 선물 약속: 1등 외 참가자는 1등에게 10스푼 \(직접 전달\)$/);
  assert.deepEqual([f.user('b1').pt, f.user('b1').exp], [300, 300]);
  assert.deepEqual([f.user('c1').pt, f.user('c1').exp], [150, 150]);
  assert.deepEqual([f.user('a1').pt, f.user('a1').exp], [50, 50]);
  assert.deepEqual([f.user('d1').pt, f.user('d1').exp], [0, 0], '후원하지 않은 참가자는 보상이 없습니다');
  assert.equal(f.room().battle, undefined);
  // 기록: 순위별 보상과 결과가 남습니다.
  const logs = f.store.logs('room1').filter(l => l.type === 'battle');
  assert.deepEqual(logs.map(l => [l.user, l.data.rank, l.data.total, l.data.pt, l.data.exp]).sort(), [['a1', 3, 100, 50, 50], ['b1', 1, 300, 300, 300], ['c1', 2, 200, 150, 150]].sort());
  assert.equal(f.store.logs('room1').filter(l => l.type === 'battle-result').length, 1);
});

test('참가자가 4명 이상이어도 보상은 3등까지, 동점이면 먼저 도달한 사람이 앞섭니다', () => {
  const f = setup(); f.startWithThree();
  f.say('!대결', { id: 'd1', name: 'd1' });
  f.donate('a1', 100); f.advance(1000); f.donate('b1', 100); f.advance(1000); f.donate('c1', 50); f.donate('d1', 10);
  const result = f.dj('!대결 종료').text;
  assert.match(result, /1등 a1 100스푼 .* 2등 b1 100스푼 .* 3등 c1 50스푼/);
  assert.ok(!result.includes('d1 10스푼'));
  assert.equal(f.user('d1').pt, 0);
});

test('후원한 참가자가 2명 미만이면 무효로 처리하고 보상을 주지 않습니다', () => {
  const f = setup(); f.startWithThree();
  f.donate('a1', 500);
  assert.match(f.dj('!대결 종료').text, /후원한 참가자가 2명 미만이라 무효/);
  assert.deepEqual([f.user('a1').pt, f.user('a1').exp], [0, 0]);
  assert.equal(f.room().lastBattle.void, true);
});

test('시간이 다 되면 점검에서 자동 종료되고, 보상은 한 번만 지급합니다', () => {
  const f = setup(); f.startWithThree();
  f.donate('a1', 100); f.donate('b1', 200);
  assert.equal(f.tick(), null, '시간이 남아 있으면 종료하지 않습니다');
  f.advance(5 * 60000);
  const ended = f.tick();
  assert.match(ended.text, /🏆 대결 결과 1등 b1 200스푼 .* 2등 a1 100스푼/);
  assert.equal(f.user('b1').pt, 300);
  assert.equal(f.tick(), null, '이미 끝난 대결은 다시 처리하지 않습니다');
  assert.equal(f.user('b1').pt, 300);
  // 시간이 지난 뒤에는 후원 합산도 참가도 받지 않습니다.
  f.dj('!대결 시작 1');
  f.say('!대결', { id: 'a1', name: 'a1' });
  f.advance(2 * 60000);
  assert.equal(f.donate('a1', 50), false);
  assert.match(f.say('!대결', { id: 'z9', name: 'z9' }).text, /곧 결과를 발표해요/);
});

test('현황: 진행 중이면 현재 순위, 끝난 뒤에는 지난 대결 결과를 보여 줍니다', () => {
  const f = setup(); f.startWithThree();
  f.donate('a1', 100); f.donate('b1', 300);
  assert.match(f.say('!대결 현황', { id: 'u9' }).text, /^⚔️ 대결 진행 중 · 남은 \d+분 · 참가 3명 · 1위 b1 300스푼 \/ 2위 a1 100스푼$/);
  f.dj('!대결 종료');
  assert.match(f.say('!대결 현황', { id: 'u9' }).text, /진행 중인 대결이 없어요 · 지난 대결 1등 b1 300스푼 · 2등 a1 100스푼/);
});

test('설정에서 끄면 동작하지 않고, 선물 안내를 0으로 두면 안내 줄이 없습니다', () => {
  const f = setup(); f.startWithThree();
  f.donate('a1', 100); f.donate('b1', 50);
  f.setSettings({ battleGiftSpoons: 0, battleFirstPt: 1, battleFirstExp: 0 });
  const result = f.dj('!대결 종료').text;
  assert.ok(!result.includes('선물 약속'));
  assert.match(result, /1등 a1 100스푼 \+1PT · 2등 b1 50스푼/);
  f.setSettings({ battleEnabled: false });
  assert.match(f.dj('!대결 시작').text, /후원 대결이 꺼져 있습니다/);
  assert.equal(f.donate('a1', 10), false);
});

test('결과 메시지는 200자를 넘지 않습니다 (큰 보상·긴 닉네임)', () => {
  const f = setup();
  f.setSettings({ battleFirstPt: 1000000, battleFirstExp: 1000000, battleSecondPt: 1000000, battleSecondExp: 1000000, battleThirdPt: 1000000, battleThirdExp: 1000000, battleGiftSpoons: 1000 });
  f.dj('!대결 시작 5');
  for (const [id, total] of [['x1', 99999], ['x2', 88888], ['x3', 77777]]) { f.say('!대결', { id, name: '아주아주아주긴닉네임입니다' }); f.donate(id, total); }
  const text = f.dj('!대결 종료').text;
  assert.ok([...text].length <= 200, `길이 ${[...text].length}`);
});

test('보유량이 정수 범위를 넘는 우승자는 보상만 건너뜁니다', () => {
  const f = setup(); f.startWithThree();
  f.store.transaction('room1', r => { r.users.b1.pt = Number.MAX_SAFE_INTEGER; });
  f.donate('a1', 100); f.donate('b1', 300);
  assert.match(f.dj('!대결 종료').text, /1등 b1 300스푼 · 2등 a1 100스푼 \+150PT\+150EXP/);
  assert.equal(f.user('b1').pt, Number.MAX_SAFE_INTEGER);
  assert.equal(f.user('a1').pt, 150);
});

test('설정 값 검사와 이전 설정 불러오기', () => {
  const base = () => structuredClone(defaults());
  const ok = Object.assign(base(), { battleMinutes: 120, battleGiftSpoons: 1000, battleFirstPt: 1000000, battleThirdExp: 0 });
  assert.equal(validateSettings(ok).battleMinutes, 120);
  for (const patch of [{ battleEnabled: 'yes' }, { battleMinutes: 0 }, { battleMinutes: 121 }, { battleMinutes: 1.5 }, { battleGiftSpoons: -1 }, { battleGiftSpoons: 1001 }, { battleFirstPt: 1000001 }, { battleSecondExp: -1 }, { battleThirdPt: null }, { battleFirstExp: '5' }])
    assert.throws(() => validateSettings(Object.assign(base(), patch)), /후원 대결/);
  const old = base(); for (const k of Object.keys(old)) if (k.startsWith('battle')) delete old[k];
  const loaded = validateSettings(old);
  assert.deepEqual([loaded.battleEnabled, loaded.battleMinutes, loaded.battleGiftSpoons, loaded.battleFirstPt, loaded.battleThirdExp], [true, 5, 10, 300, 50]);
});

test('웹 관리 화면의 후원 대결 카드가 설정 입력칸과 안내를 보여 줍니다', () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function battlePanel(){');
  const end = source.indexOf('\n}\n', start) + 3;
  assert.ok(start >= 0 && end > start);
  const render = settings => {
    const context = { room: { settings }, card: (title, body) => `${title}|${body}`, toggle: key => `[toggle:${key}]`, field: (label, key) => `[field:${key}]`, saveButton: () => '[save]', num: value => Number(value).toLocaleString('ko-KR') };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.html=battlePanel();`, context);
    return context.html;
  };
  const s = { ...defaults() };
  const html = render(s);
  for (const key of ['battleEnabled', 'battleMinutes', 'battleFirstPt', 'battleFirstExp', 'battleSecondPt', 'battleSecondExp', 'battleThirdPt', 'battleThirdExp', 'battleGiftSpoons'])
    assert.ok(html.includes(`:${key}]`), key);
  assert.ok(html.includes('후원 대결 · !대결') && html.includes('[save]'));
  assert.ok(html.includes('봇은 스푼을 대신 보관하거나 사용자끼리 옮길 수 없습니다'));
  assert.ok(html.includes('5분 · 1등 300PT+300EXP / 2등 150PT+150EXP / 3등 50PT+50EXP'));
  assert.ok(render({ ...s, battleEnabled: false }).includes('지금 설정: 꺼짐'));
});
