// 한 번에 기준 스푼(기본 20스푼) 이상 후원하면 후원자에게 EXP를 주어 레벨이 오르는 기능을 검사하는 테스트입니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Engine, Store, defaults, validateSettings } from '../core.mjs';

// 방 'a'에 청취자 u1(닉네임 '가')을 만들어 두고 시작합니다.
function setup() {
  const store = new Store();
  let time = Date.parse('2026-11-16T00:00:00Z');
  const engine = new Engine(store, { now: () => time, int: (a) => a });
  store.create('a', 'A'); store.create('b', 'B');
  time += 21000;
  engine.handle('a', { id: 'first', user: { id: 'u1', nickname: '가' }, message: '!내정보 생성' });
  const user = id => store.load('a').users[id];
  const setSettings = patch => store.transaction('a', r => Object.assign(r.settings, patch));
  return { store, engine, user, setSettings };
}
const gift = (id, amount, user = { id: 'u1', nickname: '가' }) => ({ id, amount, user });

test('기본값: 켜짐, 20스푼 이상, 1스푼당 20 EXP', () => {
  const s = defaults();
  assert.deepEqual([s.donationExpEnabled, s.donationExpMin, s.donationExpPerSpoon], [true, 20, 20]);
});

test('기준 미만은 지급하지 않고, 기준 이상이면 스푼 수 × 20 EXP를 줍니다', () => {
  const f = setup();
  assert.equal(f.engine.donationLevelUp('a', gift('d1', 19)).text, null);
  assert.equal(f.user('u1').exp, 0);
  // 정확히 20스푼도 대상입니다.
  const out = f.engine.donationLevelUp('a', gift('d2', 20));
  assert.equal(out.text, '✨ 가님 20스푼 후원! +400 EXP · Lv.1 (다음 레벨까지 9,600 EXP)');
  assert.equal(f.user('u1').exp, 400);
  // 기록이 남습니다.
  const log = f.store.logs('a').find(l => l.type === 'donation-exp');
  assert.deepEqual([log.user, log.data.amount, log.data.exp, log.data.balance, log.data.levelBefore, log.data.levelAfter], ['u1', 20, 400, 400, 1, 1]);
});

test('레벨이 오르면 레벨 업 안내가 나옵니다', () => {
  const f = setup();
  f.store.transaction('a', r => { r.users.u1.exp = 9800; });
  const out = f.engine.donationLevelUp('a', gift('d1', 20));
  assert.equal(out.text, '🆙 가님 20스푼 후원! +400 EXP · Lv.1 → Lv.2 레벨 업!');
  assert.equal(f.user('u1').exp, 10200);
  assert.deepEqual([out.levelBefore, out.levelAfter], [1, 2]);
  // 한 번에 여러 레벨도 오를 수 있습니다. (1,000스푼 = 20,000 EXP)
  const big = f.engine.donationLevelUp('a', gift('d2', 1000));
  assert.match(big.text, /Lv\.2 → Lv\.4 레벨 업!/);
});

test('같은 후원 알림이 다시 들어와도 한 번만 지급합니다', () => {
  const f = setup();
  assert.ok(f.engine.donationLevelUp('a', gift('same', 50)).text);
  assert.equal(f.engine.donationLevelUp('a', gift('same', 50)).text, null);
  assert.equal(f.user('u1').exp, 1000);
  assert.ok(f.engine.donationLevelUp('a', gift('other', 50)).text);
  assert.equal(f.user('u1').exp, 2000);
});

test('프로필이 없는 후원자는 프로필을 만들어 EXP를 줍니다', () => {
  const f = setup();
  const out = f.engine.donationLevelUp('a', gift('d1', 30, { id: 'new-donor', nickname: '새후원자' }));
  assert.match(out.text, /^✨ 새후원자님 30스푼 후원! \+600 EXP/);
  assert.equal(f.user('new-donor').name, '새후원자');
  assert.equal(f.user('new-donor').exp, 600);
  // 다른 방에는 만들어지지 않습니다.
  assert.equal(f.store.load('b').users['new-donor'], undefined);
});

test('꺼져 있거나 잘못된 후원 정보는 무시합니다', () => {
  const f = setup();
  for (const bad of [{ amount: 50, user: { id: 'u1' } }, { id: 'x', amount: 50 }, { id: 'x', amount: 50, user: {} }, { id: 'x', amount: 'abc', user: { id: 'u1' } }, { id: 'x', amount: 25.5, user: { id: 'u1' } }, { id: 'x', user: { id: 'u1' } }])
    assert.equal(f.engine.donationLevelUp('a', bad).text, null);
  f.setSettings({ donationExpEnabled: false });
  assert.equal(f.engine.donationLevelUp('a', gift('off', 500)).text, null);
  assert.equal(f.user('u1').exp, 0);
});

test('설정을 바꾸면 기준과 스푼당 EXP가 바뀝니다', () => {
  const f = setup();
  f.setSettings({ donationExpMin: 100, donationExpPerSpoon: 5 });
  assert.equal(f.engine.donationLevelUp('a', gift('d1', 99)).text, null);
  assert.match(f.engine.donationLevelUp('a', gift('d2', 100)).text, /\+500 EXP/);
});

test('EXP가 정수 범위를 넘으면 지급하지 않고 기록만 남깁니다', () => {
  const f = setup();
  f.store.transaction('a', r => { r.users.u1.exp = Number.MAX_SAFE_INTEGER - 5; });
  assert.equal(f.engine.donationLevelUp('a', gift('d1', 50)).text, null);
  assert.equal(f.user('u1').exp, Number.MAX_SAFE_INTEGER - 5);
  assert.equal(f.store.logs('a').filter(l => l.type === 'donation-exp-failed').length, 1);
});

test('설정 값 검사와 이전 설정 불러오기', () => {
  const base = () => structuredClone(defaults());
  assert.equal(validateSettings(Object.assign(base(), { donationExpMin: 1, donationExpPerSpoon: 100000 })).donationExpPerSpoon, 100000);
  for (const patch of [{ donationExpEnabled: 'yes' }, { donationExpMin: 0 }, { donationExpMin: 1.5 }, { donationExpMin: 100000001 }, { donationExpPerSpoon: 0 }, { donationExpPerSpoon: 100001 }, { donationExpPerSpoon: null }])
    assert.throws(() => validateSettings(Object.assign(base(), patch)), /후원 레벨 보상/);
  const old = base(); delete old.donationExpEnabled; delete old.donationExpMin; delete old.donationExpPerSpoon;
  const loaded = validateSettings(old);
  assert.deepEqual([loaded.donationExpEnabled, loaded.donationExpMin, loaded.donationExpPerSpoon], [true, 20, 20]);
});

test('웹 관리 화면의 후원 레벨 카드가 현재 설정을 보여 줍니다', () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function donationExpPanel(){');
  const end = source.indexOf('\n}\n', start) + 3;
  assert.ok(start >= 0 && end > start);
  const render = settings => {
    const context = {
      room: { settings }, card: (title, body) => `${title}|${body}`, toggle: key => `[toggle:${key}]`, field: (label, key) => `[field:${key}]`,
      saveButton: () => '[save]', num: value => Number(value).toLocaleString('ko-KR'),
    };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.html=donationExpPanel();`, context);
    return context.html;
  };
  const on = render({ donationExpEnabled: true, donationExpMin: 20, donationExpPerSpoon: 20, levelStep: 10000 });
  assert.ok(on.includes('후원 레벨 · EXP 보상') && on.includes('[toggle:donationExpEnabled]') && on.includes('[field:donationExpMin]') && on.includes('[field:donationExpPerSpoon]') && on.includes('[save]'));
  assert.ok(on.includes('20스푼 이상 → 400 EXP부터 (레벨당 10,000 EXP)'));
  assert.ok(render({ donationExpEnabled: false, donationExpMin: 20, donationExpPerSpoon: 20, levelStep: 10000 }).includes('지금 설정: 꺼짐'));
});
