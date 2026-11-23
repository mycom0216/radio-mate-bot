// !랭킹조회·!랭크조회(그 방송 DJ의 일라디·월라디 순위, 넥스트초이스 레벨)와 DJ 입력 명령(!랭킹등록)을 검사하는 테스트입니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Engine, Store, defaults, validateSettings, stampDjRank } from '../core.mjs';

function setup(start = '2026-11-23T12:00:00+09:00') {
  const store = new Store();
  let time = Date.parse(start), counter = 0;
  const engine = new Engine(store, { now: () => time, int: a => a });
  store.create('room1', '콰앙의 라디오'); store.create('room2', '다른 DJ 방송');
  const say = (message, { id = 'u1', name = '가', dj = false, room = 'room1' } = {}) => {
    time += 21000;
    return engine.handle(room, { id: `chat-${++counter}`, user: { id, nickname: name }, message, isDj: dj });
  };
  const dj = (message, room = 'room1') => say(message, { id: 'dj1', name: 'DJ', dj: true, room });
  const advance = ms => { time += ms; };
  const settings = (room = 'room1') => store.load(room).settings;
  return { store, engine, say, dj, advance, settings };
}

test('등록 전에는 미등록으로 안내합니다 (!랭킹조회·!랭크조회·!랭크 모두 같은 답)', () => {
  const f = setup();
  const expected = '📻 콰앙의 라디오 랭킹\n일라디 미등록 · 월라디 미등록\n넥스트초이스 레벨 미등록 (DJ가 !랭킹등록으로 입력)';
  for (const command of ['!랭킹조회', '!랭크조회', '!랭크']) assert.equal(f.say(command).text, expected, command);
});

test('DJ가 입력하면 일라디·월라디 순위와 이전·현재·다음 초이스 레벨, 남은 등수를 순서대로 보여 줍니다', () => {
  const f = setup();
  assert.match(f.dj('!랭킹등록 일 12').text, /일라디 12위 · 월라디 미등록/);
  assert.match(f.dj('!랭킹등록 월 45').text, /일라디 12위 · 월라디 45위/);
  const out = f.dj('!랭킹등록 초이스 이전 2 현재 3 다음 4 컷 30').text;
  assert.equal(out, '📻 콰앙의 라디오 랭킹\n일라디 12위 · 월라디 45위\n넥스트초이스 이전 Lv.2 → 현재 Lv.3 → 다음 Lv.4까지 15등 남음');
  // 청취자도 조회할 수 있습니다.
  assert.equal(f.say('!랭킹조회', { id: 'u9', name: '청취자' }).text, out);
  assert.equal(f.say('!랭크조회', { id: 'u8', name: '청취자2' }).text, out);
  assert.ok([...out].length <= 200);
});

test('순위가 컷 안으로 들어오면 조건 달성, 컷이나 월라디가 없으면 남은 등수 미등록', () => {
  const f = setup();
  f.dj('!랭킹등록 초이스 이전 2 현재 3 다음 4 컷 30');
  assert.match(f.say('!랭킹조회').text, /다음 Lv\.4 \(남은 등수 미등록\)/, '월라디 순위가 없으면 계산하지 못함');
  f.dj('!랭킹등록 월 30');
  assert.match(f.say('!랭킹조회').text, /다음 Lv\.4 조건 달성/);
  f.dj('!랭킹등록 월 31');
  assert.match(f.say('!랭킹조회').text, /다음 Lv\.4까지 1등 남음/);
  f.dj('!랭킹등록 초이스 다음 5');
  assert.match(f.say('!랭킹조회').text, /이전 Lv\.2 → 현재 Lv\.3 → 다음 Lv\.5까지 1등 남음/, '일부만 고쳐도 나머지는 유지');
});

test('이번 날·이번 달이 아닌 값에는 (기준일)이 붙습니다', () => {
  const f = setup();
  f.dj('!랭킹등록 일 12'); f.dj('!랭킹등록 월 45'); f.dj('!랭킹등록 초이스 이전 2 현재 3 다음 4 컷 30');
  f.advance(24 * 3600000); // 다음 날(11-24)
  let text = f.say('!랭킹조회').text;
  assert.match(text, /일라디 12위\(11-23 기준\) · 월라디 45위\n/);
  f.advance(10 * 24 * 3600000); // 12월
  text = f.say('!랭킹조회').text;
  assert.match(text, /월라디 45위\(11월 기준\)/);
  assert.match(text, /다음 Lv\.4 \(남은 등수 미등록\) \(11월 기준\)$/, '이전 달 순위로는 남은 등수를 계산하지 않음');
});

test('방송(DJ)마다 따로 저장됩니다', () => {
  const f = setup();
  f.dj('!랭킹등록 월 45');
  assert.match(f.say('!랭킹조회').text, /월라디 45위/);
  const other = f.say('!랭킹조회', { room: 'room2' }).text;
  assert.match(other, /^📻 다른 DJ 방송 랭킹\n일라디 미등록 · 월라디 미등록/);
});

test('!랭킹등록은 DJ만, 형식이 틀리면 사용법을 알려 줍니다', () => {
  const f = setup();
  assert.match(f.say('!랭킹등록 월 45').text, /DJ 전용/);
  for (const bad of ['', '일', '일 0', '일 abc', '월 1.5', '월 1 2', '초이스', '초이스 이전', '초이스 이전 2 현재', '초이스 이름 3', '모름 1', '초기화 1'])
    assert.match(f.dj(`!랭킹등록 ${bad}`).text, /^사용법: !랭킹등록 일 12/, bad);
  assert.equal(f.settings().djRankMonthly, null);
  assert.match(f.dj('!랭킹등록 일 12').text, /일라디 12위/);
  assert.match(f.dj('!랭킹등록 초기화').text, /일라디 미등록 · 월라디 미등록/);
  assert.equal(f.settings().djRankDailyDate, '');
  // !랭크등록도 같은 명령입니다.
  assert.match(f.dj('!랭크등록 월일 7').text, /^사용법/);
  assert.match(f.dj('!랭크등록 월라디 7').text, /월라디 7위/);
});

test('!랭킹(청취자 애청지수 순위)은 그대로 청취자 순위를 보여 줍니다', () => {
  const f = setup();
  f.say('!내정보 생성', { id: 'u1', name: '가' });
  const ranking = f.say('!랭킹').text;
  assert.match(ranking, /1\. 가 0점/, '청취자 애청지수 순위(이름과 점수)가 나옵니다');
  assert.ok(!ranking.includes('일라디'));
  assert.ok(f.say('!랭킹조회').text.includes('일라디'), '!랭킹조회는 DJ 랭킹');
});

test('예전 !랭크의 직접 입력 문구(monthlyRank)는 월라디 칸에 대신 보여 줍니다', () => {
  const f = setup();
  f.store.transaction('room1', r => { r.settings.monthlyRank = '38위'; r.settings.monthlyRankMonth = '2026-11'; });
  assert.match(f.say('!랭크조회').text, /월라디 38위\n/);
  f.dj('!랭킹등록 월 20');
  assert.match(f.say('!랭크조회').text, /월라디 20위\n/, '새로 입력한 값이 우선');
});

test('설정 값 검사·빈 값 처리·기준일 기록', () => {
  const base = () => structuredClone(defaults());
  const ok = validateSettings(Object.assign(base(), { djRankDaily: 3, djRankMonthly: 1000000, choicePrevLevel: 999, choiceNowLevel: 1, choiceNextLevel: 2, choiceNextCut: 5 }));
  assert.equal(ok.djRankMonthly, 1000000);
  // 웹 입력칸을 비우면 0이 오는데, 미등록(null)으로 봅니다.
  const blank = validateSettings(Object.assign(base(), { djRankDaily: 0, choiceNowLevel: '' }));
  assert.equal(blank.djRankDaily, null); assert.equal(blank.choiceNowLevel, null);
  for (const patch of [{ djRankDaily: -1 }, { djRankDaily: 1000001 }, { choiceNowLevel: 1000 }, { choiceNextCut: 1.5 }, { djRankMonthly: 'a' }, { djRankDailyDate: 'x'.repeat(11) }])
    assert.throws(() => validateSettings(Object.assign(base(), patch)), /DJ 랭킹|순위|레벨/);
  // 기준일 기록: 값이 바뀌었을 때만 새 날짜·달로 바뀝니다.
  const prev = base(), next = Object.assign(base(), { djRankDaily: 12, djRankMonthly: 45, choiceNowLevel: 3 });
  stampDjRank(prev, next, Date.parse('2026-11-23T12:00:00+09:00'));
  assert.deepEqual([next.djRankDailyDate, next.djRankMonthlyMonth, next.choiceMonth], ['2026-11-23', '2026-11', '2026-11']);
  const again = structuredClone(next);
  stampDjRank(next, again, Date.parse('2026-12-05T12:00:00+09:00'));
  assert.deepEqual([again.djRankDailyDate, again.djRankMonthlyMonth], ['2026-11-23', '2026-11'], '값이 같으면 기준일 유지');
  again.djRankMonthly = 44; stampDjRank(next, again, Date.parse('2026-12-05T12:00:00+09:00'));
  assert.equal(again.djRankMonthlyMonth, '2026-12');
  const cleared = Object.assign(structuredClone(again), { djRankDaily: null, djRankMonthly: null, choiceNowLevel: null });
  stampDjRank(again, cleared); assert.deepEqual([cleared.djRankDailyDate, cleared.djRankMonthlyMonth, cleared.choiceMonth], ['', '', '']);
  // 이전에 저장된 방(키가 없음)을 불러와도 미등록 기본값이 채워집니다.
  const old = base(); for (const key of ['djRankDaily', 'djRankMonthly', 'choicePrevLevel', 'choiceNowLevel', 'choiceNextLevel', 'choiceNextCut', 'djRankDailyDate', 'djRankMonthlyMonth', 'choiceMonth']) delete old[key];
  const loaded = validateSettings(old);
  assert.deepEqual([loaded.djRankDaily, loaded.choiceNextLevel, loaded.djRankDailyDate], [null, null, '']);
});

test('웹 관리 화면의 DJ 랭킹 카드가 입력칸과 현재 입력 기준일을 보여 줍니다', () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function djRankPanel(){');
  const end = source.indexOf('\n}\n', start) + 3;
  assert.ok(start >= 0 && end > start);
  const render = settings => {
    const context = { room: { settings }, card: (title, body) => `${title}|${body}`, field: (label, key, value) => `[${label}:${key}=${value}]`, saveButton: () => '[save]', esc: value => String(value) };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.html=djRankPanel();`, context);
    return context.html;
  };
  const html = render({ ...defaults(), djRankMonthly: 45, djRankMonthlyMonth: '2026-11' });
  for (const key of ['djRankDaily', 'djRankMonthly', 'choicePrevLevel', 'choiceNowLevel', 'choiceNextLevel', 'choiceNextCut']) assert.ok(html.includes(`:${key}=`), key);
  assert.ok(html.includes('djRankMonthly=45') && html.includes('djRankDaily='));
  assert.ok(html.includes('!랭킹조회') && html.includes('!랭크조회') && html.includes('!랭킹등록 월 45') && html.includes('[save]'));
  assert.ok(html.includes('월라디 2026-11') && html.includes('일라디 -'));
});
