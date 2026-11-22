// 낚시 행운 보너스(고급 이상 물고기가 더 자주 나오는 설정)를 검사하는 테스트입니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Engine, Store, defaults, validateSettings } from '../core.mjs';

// 물고기를 '일반어'(일반, 가중치 10)와 '고급어'(고급, 가중치 10) 두 마리로 줄이고, 난수를 직접 정해 줍니다.
function setup(fish) {
  const store = new Store();
  let time = Date.parse('2026-11-16T00:00:00Z');
  const queue = [];
  const engine = new Engine(store, { now: () => time, int: (a, b) => { const x = queue.shift(); return x === undefined ? a : Math.min(b, Math.max(a, x)); } });
  store.create('a', 'A');
  store.transaction('a', r => { r.settings.fishing = true; r.settings.fishingWho = 'off'; r.settings.fish = fish; });
  const say = message => { time += 21000; return engine.handle('a', { id: `e-${time}`, user: { id: 'u1', nickname: '가' }, message }); };
  say('!내정보 생성');
  const setLuck = fishingLuck => store.transaction('a', r => { r.settings.fishingLuck = fishingLuck; });
  // 낚시 한 번에 쓰는 난수: 꽝 판정(10000이면 꽝 아님) → 물고기 고르기 → 크기 → PT
  const cast = roll => { queue.push(10000, roll, 0, 0); return say('!낚시').text; };
  return { store, setLuck, cast };
}
const make = (id, name, rarity, weight, golden = false) => ({ id, name, rarity, weight, minSize: 10, maxSize: 20, minPt: 50, maxPt: 60, golden });

test('같은 난수라도 행운 보너스가 있으면 고급 물고기가 나옵니다', () => {
  // 가중치: 일반어 10, 고급어 10. 난수 400000(=40%)은 보너스가 없으면 일반어, 보너스 100%면 고급어(10:20)입니다.
  const f = setup([make('a', '일반어', 0, 10), make('b', '고급어', 1, 10)]);
  f.setLuck(0);
  assert.match(f.cast(400000), /^🎣 일반어 \(일반\)/);
  f.setLuck(100);
  assert.match(f.cast(400000), /^🎣 고급어 \(고급\)/);
});

test('황금주사위는 행운 보너스를 받지 않습니다', () => {
  const f = setup([make('a', '일반어', 0, 10), make('g', '황금주사위', 4, 10, true)]);
  // 보너스가 황금주사위에 적용되면 20이 되어 이 난수에서 황금주사위가 나옵니다. 적용되지 않으므로 일반어여야 합니다.
  f.setLuck(1000);
  assert.match(f.cast(400000), /^🎣 일반어 \(일반\)/);
});

test('행운 보너스 0이면 기존과 같습니다', () => {
  const f = setup([make('a', '일반어', 0, 10), make('b', '고급어', 1, 10)]);
  f.setLuck(0);
  assert.match(f.cast(600000), /^🎣 고급어 \(고급\)/);
  assert.match(f.cast(100000), /^🎣 일반어 \(일반\)/);
});

test('기본값은 100%이고 설정 값 검사를 합니다', () => {
  assert.equal(defaults().fishingLuck, 100);
  const base = () => structuredClone(defaults());
  for (const ok of [0, 100, 1000]) assert.equal(validateSettings(Object.assign(base(), { fishingLuck: ok })).fishingLuck, ok);
  for (const bad of [-1, 1001, 1.5, '100', null, NaN]) assert.throws(() => validateSettings(Object.assign(base(), { fishingLuck: bad })), /낚시 행운 보너스/);
  const old = base(); delete old.fishingLuck;
  assert.equal(validateSettings(old).fishingLuck, 100);
});

test('웹 관리 화면이 행운 보너스를 반영한 등급별 확률을 보여 줍니다', () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function fishOddsLine(){');
  const end = source.indexOf('\n}\n', start) + 3;
  assert.ok(start >= 0 && end > start);
  const render = fishingLuck => {
    const context = { rarities: ['일반', '고급', '희귀', '영웅', '전설'], room: { settings: { fish: defaults().fish, fishingLuck } } };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.text=fishOddsLine();`, context);
    return context.text;
  };
  // 보너스 없음: 기본 가중치 60/20/12/6/2
  assert.ok(render(0).includes('일반 60.0% · 고급 20.0% · 희귀 12.0% · 영웅 6.0% · 전설 2.0%'));
  // 보너스 100%: 고급 이상(황금주사위 제외) 가중치 2배 → 60/40/24/12/3 (합계 139)
  assert.ok(render(100).includes('일반 43.2% · 고급 28.8% · 희귀 17.3% · 영웅 8.6% · 전설 2.2%'));
});
