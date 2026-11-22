// 낚시 결과에 "누가 잡았는지"(닉네임·고유 ID)를 표시하는 기능을 검사하는 테스트입니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Engine, Store, defaults, validateSettings } from '../core.mjs';

// 방 'a'에 닉네임 "콰앙", 고유 ID "12345"인 청취자를 만들고 낚시를 켜 둔 준비 함수입니다.
function setup() {
  const store = new Store();
  let time = Date.parse('2026-11-16T00:00:00Z'), counter = 0;
  const engine = new Engine(store, { now: () => time, int: (a) => a });
  store.create('a', 'A');
  store.transaction('a', r => { r.settings.fishing = true; });
  const say = (message, { id = '12345', name = '콰앙' } = {}) => {
    time += 21000;
    return engine.handle('a', { id: `event-${++counter}`, user: { id, nickname: name }, message });
  };
  say('!내정보 생성');
  const setSettings = patch => store.transaction('a', r => Object.assign(r.settings, patch));
  return { store, say, setSettings };
}

test('기본값은 닉네임과 고유 ID를 함께 보여 줍니다', () => {
  assert.equal(defaults().fishingWho, 'both');
  const f = setup();
  assert.match(f.say('!낚시').text, /^🎣 콰앙\(@12345\) · .+ \(.+\) \d+cm\n\+\d+ EXP/);
});

test('표시 방식을 닉네임만·고유 ID만·표시 안 함으로 바꿀 수 있습니다', () => {
  const f = setup();
  f.setSettings({ fishingWho: 'nickname' });
  assert.match(f.say('!낚시').text, /^🎣 콰앙 · /);
  f.setSettings({ fishingWho: 'id' });
  assert.match(f.say('!낚시').text, /^🎣 @12345 · /);
  f.setSettings({ fishingWho: 'off' });
  const plain = f.say('!낚시').text;
  assert.match(plain, /^🎣 [^·@(]+ \(.+\) \d+cm/);
  assert.ok(!plain.includes('콰앙') && !plain.includes('12345'));
});

test('꽝일 때도 누가 낚시했는지 표시합니다', () => {
  const f = setup();
  f.setSettings({ miss: 100 });
  assert.match(f.say('!낚시').text, /^콰앙\(@12345\) · 이번엔 꽝! \+\d+ EXP$/);
  f.setSettings({ fishingWho: 'off' });
  assert.match(f.say('!낚시').text, /^이번엔 꽝! \+\d+ EXP$/);
});

test('긴 닉네임은 14자까지만 보여 주고, 사람마다 자기 ID가 나옵니다', () => {
  const f = setup();
  const longName = '아주아주아주아주아주아주긴닉네임입니다';
  f.say('!내정보 생성', { id: '777', name: longName });
  const out = f.say('!낚시', { id: '777', name: longName }).text;
  assert.match(out, /^🎣 아주아주아주아주아주아주긴닉\(@777\) · /);
  assert.match(f.say('!낚시').text, /^🎣 콰앙\(@12345\) · /);
});

test('낚시 기록은 청취자 고유 ID로 남아 웹 기록 화면에서 닉네임과 함께 볼 수 있습니다', () => {
  const f = setup();
  f.say('!낚시');
  const log = f.store.logs('a').find(l => l.type === 'fishing');
  assert.equal(log.user, '12345');
});

test('설정 값 검사와 이전 설정 불러오기', () => {
  const base = () => structuredClone(defaults());
  for (const mode of ['both', 'nickname', 'id', 'off']) assert.equal(validateSettings(Object.assign(base(), { fishingWho: mode })).fishingWho, mode);
  for (const bad of ['all', '', null, 1, true]) assert.throws(() => validateSettings(Object.assign(base(), { fishingWho: bad })), /낚시 결과 표시 방식/);
  const old = base(); delete old.fishingWho;
  assert.equal(validateSettings(old).fishingWho, 'both');
});

test('웹 관리 화면의 선택 상자가 현재 값을 선택해 보여 줍니다', () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function fishingWhoField(){');
  const end = source.indexOf('\n}\n', start) + 3;
  assert.ok(start >= 0 && end > start);
  const render = fishingWho => {
    const context = { room: { settings: { fishingWho } } };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.html=fishingWhoField();`, context);
    return context.html;
  };
  const html = render('id');
  assert.ok(html.includes('data-field="fishingWho"'));
  for (const label of ['닉네임 + 고유 ID', '닉네임만', '고유 ID만', '표시 안 함']) assert.ok(html.includes(label), label);
  assert.ok(html.includes('<option value="id" selected>'));
  assert.ok(!html.includes('<option value="both" selected>'));
});
