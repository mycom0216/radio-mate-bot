// 복권 등수(1등·2등·3등·꽝)별 EXP·PT 보상과 설정을 검사하는 테스트입니다.
// 숫자 3개 게임은 그대로이고, 맞힌 개수 3/2/1/0개가 각각 1등/2등/3등/꽝입니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Engine, Store, defaults, validateSettings } from '../core.mjs';

// 청취자 u1에게 복권 10장을 주고, 추첨 숫자를 [1,2,3]으로 고정한 준비 함수입니다.
function setup() {
  const store = new Store();
  let time = Date.parse('2026-11-16T00:00:00Z'), counter = 0;
  const queue = [];
  // int()가 돌려줄 값을 미리 정해 둡니다. 0,0,0이면 당첨 숫자는 1 2 3이 됩니다.
  const engine = new Engine(store, { now: () => time, int: (a, b) => { const x = queue.shift(); return x === undefined ? a : Math.min(b, Math.max(a, x)); } });
  store.create('a', 'A');
  const say = (message, { id = 'u1', name = '청취자', dj = false } = {}) => {
    time += 21000;
    return engine.handle('a', { id: `event-${++counter}`, user: { id, nickname: name }, message, isDj: dj });
  };
  say('!내정보 생성');
  store.transaction('a', r => { r.users.u1.tickets = 10; });
  const user = () => store.load('a').users.u1;
  const setSettings = patch => store.transaction('a', r => Object.assign(r.settings, patch));
  return { store, say, user, setSettings, draw: () => queue.push(0, 0, 0) };
}

test('기본 보상: 1등은 EXP+PT, 2등은 EXP만, 3등은 PT만, 꽝은 없음', () => {
  const f = setup();
  // 당첨 숫자는 항상 1 2 3 입니다.
  f.draw(); assert.match(f.say('!복권 1 2 3').text, /3개 일치 · 1등! \+300 EXP \+300 PT/);
  assert.deepEqual([f.user().exp, f.user().pt], [300, 300]);
  f.draw(); assert.match(f.say('!복권 1 2 9').text, /2개 일치 · 2등! \+150 EXP$/);
  assert.deepEqual([f.user().exp, f.user().pt], [450, 300]);
  f.draw(); assert.match(f.say('!복권 1 8 9').text, /1개 일치 · 3등! \+50 PT$/);
  assert.deepEqual([f.user().exp, f.user().pt], [450, 350]);
  f.draw(); assert.match(f.say('!복권 7 8 9').text, /0개 일치 · 꽝$/);
  assert.deepEqual([f.user().exp, f.user().pt], [450, 350]);
  assert.equal(f.user().tickets, 6);
  // 기록에 등수와 보상이 남습니다.
  const logs = f.store.logs('a').filter(l => l.type === 'lottery');
  assert.deepEqual(logs.map(l => l.data.rank).sort(), ['1등', '2등', '3등', '꽝'].sort());
  assert.ok(logs.every(l => Number.isSafeInteger(l.data.exp) && Number.isSafeInteger(l.data.pt)));
});

test('DJ가 바꾼 등수별 보상이 바로 적용됩니다', () => {
  const f = setup();
  f.setSettings({ lotteryFirstExp: 1000, lotteryFirstPt: 5, lotterySecondExp: 0, lotterySecondPt: 70, lotteryThirdExp: 20, lotteryThirdPt: 0 });
  f.draw(); assert.match(f.say('!복권 1 2 3').text, /1등! \+1,000 EXP \+5 PT/);
  f.draw(); assert.match(f.say('!복권 1 2 9').text, /2등! \+70 PT$/);
  f.draw(); assert.match(f.say('!복권 1 8 9').text, /3등! \+20 EXP$/);
  assert.deepEqual([f.user().exp, f.user().pt], [1020, 75]);
  // 보상을 모두 0으로 두면 '보상 없음'으로 안내합니다.
  f.setSettings({ lotteryThirdExp: 0, lotteryThirdPt: 0 });
  f.draw(); assert.match(f.say('!복권 1 8 9').text, /3등! 보상 없음$/);
  assert.deepEqual([f.user().exp, f.user().pt], [1020, 75]);
});

test('!복권 자동 여러 장은 등수별 횟수와 EXP·PT 합계를 보여 줍니다', () => {
  const f = setup();
  // 숫자 선택은 직접 입력이 없어 난수로 정해지므로, 보상 표만 다르게 두고 합계가 등수 횟수와 맞는지 확인합니다.
  f.setSettings({ lotteryFirstExp: 10, lotteryFirstPt: 20, lotterySecondExp: 30, lotterySecondPt: 40, lotteryThirdExp: 50, lotteryThirdPt: 60 });
  const out = f.say('!복권 자동').text;
  assert.match(out, /자동 복권 10장 사용 · 1등\(3개 일치\) \d+회 \/ 2등\(2개\) \d+회 \/ 3등\(1개\) \d+회 \/ 꽝 \d+회/);
  const log = f.store.logs('a').find(l => l.type === 'lottery');
  const [miss, third, second, first] = log.data.counts;
  assert.equal(miss + third + second + first, 10);
  assert.equal(log.data.exp, first * 10 + second * 30 + third * 50);
  assert.equal(log.data.pt, first * 20 + second * 40 + third * 60);
  assert.equal(f.user().exp, log.data.exp);
  assert.equal(f.user().pt, log.data.pt);
  assert.equal(f.user().tickets, 0);
});

test('PT가 정수 범위를 넘으면 복권을 차감하지 않습니다', () => {
  const f = setup();
  f.store.transaction('a', r => { r.users.u1.pt = Number.MAX_SAFE_INTEGER - 10; });
  f.draw(); assert.match(f.say('!복권 1 2 3').text, /포인트가 정확히 처리 가능한 정수 범위를 초과/);
  assert.equal(f.user().tickets, 10);
  assert.equal(f.user().exp, 0);
});

test('설정 값 검사와 이전 설정 불러오기', () => {
  const base = () => structuredClone(defaults());
  assert.deepEqual(['lotteryFirstExp', 'lotteryFirstPt', 'lotterySecondExp', 'lotterySecondPt', 'lotteryThirdExp', 'lotteryThirdPt'].map(k => base()[k]), [300, 300, 150, 0, 0, 50]);
  const ok = Object.assign(base(), { lotteryFirstExp: 1000000, lotteryThirdPt: 0 });
  assert.equal(validateSettings(ok).lotteryFirstExp, 1000000);
  for (const patch of [{ lotteryFirstExp: -1 }, { lotteryFirstPt: 1000001 }, { lotterySecondExp: 1.5 }, { lotterySecondPt: '10' }, { lotteryThirdExp: null }, { lotteryThirdPt: NaN }])
    assert.throws(() => validateSettings(Object.assign(base(), patch)), /복권 등수 보상/);
  // 이 기능이 생기기 전에 저장한 설정에는 기본 보상을 채웁니다.
  const old = base(); for (const k of Object.keys(old)) if (k.startsWith('lottery')) delete old[k];
  const loaded = validateSettings(old);
  assert.equal(loaded.lotteryFirstPt, 300); assert.equal(loaded.lotterySecondPt, 0); assert.equal(loaded.lotteryThirdExp, 0); assert.equal(loaded.lotteryThirdPt, 50);
});

test('웹 관리 화면에 등수별 보상 입력칸이 있습니다', () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function lotteryRewardPanel(){');
  const end = source.indexOf('\n}\n', start) + 3;
  assert.ok(start >= 0 && end > start);
  const context = { card: (title, body) => `${title}|${body}`, field: (label, key) => `[${label}:${key}]`, saveButton: () => '[save]' };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}\nthis.html=lotteryRewardPanel();`, context);
  for (const key of ['lotteryFirstExp', 'lotteryFirstPt', 'lotterySecondExp', 'lotterySecondPt', 'lotteryThirdExp', 'lotteryThirdPt'])
    assert.ok(context.html.includes(`:${key}]`), key);
  assert.ok(context.html.includes('복권 등수 · 보상') && context.html.includes('[save]'));
});
