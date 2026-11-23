// !랭킹조회·!랭크조회: 그 방송 DJ의 일라디·월라디 순위와 넥스트초이스 등급(월라디 순위로 자동 계산), DJ 입력 명령(!랭킹등록)을 검사합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Engine, Store, defaults, validateSettings, stampDjRank, CHOICE_TIERS, choiceTier, choiceNext } from '../core.mjs';

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

test('스푼 공식 기준표: Top 1~10위, Star 11~110위, Normal 111~410위 (방송일수·시간 포함)', () => {
  assert.deepEqual(CHOICE_TIERS.map(t => [t.name, t.min, t.max, t.days, t.hours]), [['Top Choice', 1, 10, 20, 45], ['Star Choice', 11, 110, 20, 45], ['Normal Choice', 111, 410, 15, 30]]);
  const names = rank => choiceTier(rank)?.name ?? null;
  for (const [rank, name] of [[1, 'Top Choice'], [10, 'Top Choice'], [11, 'Star Choice'], [110, 'Star Choice'], [111, 'Normal Choice'], [410, 'Normal Choice'], [411, null], [5000, null], [0, null], [-3, null], [1.5, null], [null, null], [undefined, null]])
    assert.equal(names(rank), name, String(rank));
  // 다음 등급까지 남은 등수: 한 단계 위 등급의 마지막 순위까지
  const step = rank => { const next = choiceNext(rank); return next && [next.tier.name, next.left]; };
  assert.deepEqual(step(45), ['Top Choice', 35]); // 45위 → 10위까지
  assert.deepEqual(step(111), ['Star Choice', 1]);
  assert.deepEqual(step(410), ['Star Choice', 300]);
  assert.deepEqual(step(111 + 39), ['Star Choice', 40]);
  assert.deepEqual(step(411), ['Normal Choice', 1]);
  assert.deepEqual(step(1000), ['Normal Choice', 590]);
  assert.deepEqual(step(11), ['Top Choice', 1]);
  assert.equal(step(1), null);
  assert.equal(step(10), null);
  assert.equal(step(null), null);
});

test('등록 전에는 미등록으로 안내합니다 (!랭킹조회·!랭크조회·!랭크 모두 같은 답)', () => {
  const f = setup();
  const expected = '📻 콰앙의 라디오 랭킹\n일라디 미등록 · 월라디 미등록\n초이스 이전 미등록 → 현재 미등록 → 다음 등급은 월라디 순위를 입력하면 계산해요';
  for (const command of ['!랭킹조회', '!랭크조회', '!랭크']) assert.equal(f.say(command).text, expected, command);
});

test('DJ가 순위를 입력하면 일라디·월라디, 이전·현재 등급, 다음 등급까지 남은 등수를 순서대로 보여 줍니다', () => {
  const f = setup();
  assert.match(f.dj('!랭킹등록 일 12').text, /일라디 12위 · 월라디 미등록/);
  assert.match(f.dj('!랭킹등록 월 45').text, /일라디 12위 · 월라디 45위/);
  const out = f.dj('!랭킹등록 지난달 150').text;
  assert.equal(out, '📻 콰앙의 라디오 랭킹\n일라디 12위 · 월라디 45위\n초이스 이전 Normal Choice → 현재 Star Choice → 다음 Top Choice까지 35등 남음');
  // 청취자도 조회할 수 있습니다.
  assert.equal(f.say('!랭킹조회', { id: 'u9', name: '청취자' }).text, out);
  assert.equal(f.say('!랭크조회', { id: 'u8', name: '청취자2' }).text, out);
  assert.ok([...out].length <= 200);
});

test('등급별 표시: Top은 최고 등급, 410위 밖은 선정권 밖과 Normal Choice까지 남은 등수', () => {
  const f = setup();
  f.dj('!랭킹등록 지난달 8'); f.dj('!랭킹등록 월 3');
  assert.match(f.say('!랭킹조회').text, /초이스 이전 Top Choice → 현재 Top Choice → 최고 등급\(Top Choice\)이에요$/);
  f.dj('!랭킹등록 월 111');
  assert.match(f.say('!랭킹조회').text, /현재 Normal Choice → 다음 Star Choice까지 1등 남음$/);
  f.dj('!랭킹등록 월 500'); f.dj('!랭킹등록 지난달 450');
  assert.match(f.say('!랭킹조회').text, /초이스 이전 선정권 밖 → 현재 선정권 밖 → 다음 Normal Choice까지 90등 남음$/);
});

test('이번 날·이번 달이 아닌 값에는 (기준일)이 붙고, 이전 달 순위로는 남은 등수를 계산하지 않습니다', () => {
  const f = setup();
  f.dj('!랭킹등록 일 12'); f.dj('!랭킹등록 월 45'); f.dj('!랭킹등록 지난달 150');
  f.advance(24 * 3600000); // 다음 날(11-24)
  assert.match(f.say('!랭킹조회').text, /일라디 12위\(11-23 기준\) · 월라디 45위\n/);
  f.advance(10 * 24 * 3600000); // 12월
  const text = f.say('!랭킹조회').text;
  assert.match(text, /월라디 45위\(11월 기준\)/);
  assert.match(text, /초이스 이전 Normal Choice → 현재 Star Choice\(11월 기준\) → 다음 등급까지는 이번 달 월라디 순위를 입력하면 계산해요$/);
});

test('새 달의 월라디 순위를 처음 입력하면 이전 달 순위가 지난달로 자동 이동합니다', () => {
  const f = setup();
  f.dj('!랭킹등록 월 45');
  f.advance(10 * 24 * 3600000); // 12월
  const out = f.dj('!랭킹등록 월 30').text;
  assert.match(out, /월라디 30위\n초이스 이전 Star Choice → 현재 Star Choice → 다음 Top Choice까지 20등 남음$/);
  assert.deepEqual([f.settings().djRankPrevMonthly, f.settings().djRankPrevMonth, f.settings().djRankMonthlyMonth], [45, '2026-11', '2026-12']);
  // 같은 달에 다시 고쳐도 지난달 값은 유지됩니다.
  f.dj('!랭킹등록 월 9');
  assert.equal(f.settings().djRankPrevMonthly, 45);
  assert.match(f.say('!랭킹조회').text, /이전 Star Choice → 현재 Top Choice → 최고 등급/);
  // 지난달을 직접 고치면 그 값을 씁니다.
  f.dj('!랭킹등록 지난달 300');
  assert.equal(f.settings().djRankPrevMonthly, 300);
  assert.equal(f.settings().djRankPrevMonth, '2026-11');
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
  for (const bad of ['', '일', '일 0', '일 abc', '월 1.5', '월 1 2', '지난달', '초이스 이전 2 현재 3', '모름 1', '초기화 1', '월 10000000'])
    assert.match(f.dj(`!랭킹등록 ${bad}`).text, /^사용법: !랭킹등록 일 12 · !랭킹등록 월 45 · !랭킹등록 지난달 85/, bad);
  assert.equal(f.settings().djRankMonthly, null);
  assert.match(f.dj('!랭킹등록 일 12').text, /일라디 12위/);
  assert.match(f.dj('!랭킹등록 초기화').text, /일라디 미등록 · 월라디 미등록/);
  assert.equal(f.settings().djRankDailyDate, '');
  assert.match(f.dj('!랭크등록 월일 7').text, /^사용법/);
  assert.match(f.dj('!랭크등록 월라디 7').text, /월라디 7위/);
  assert.match(f.dj('!랭크등록 전월 90').text, /이전 Top Choice|이전 Star Choice/);
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

test('설정 값 검사·빈 값 처리·기준일 기록·이전 설정 불러오기', () => {
  const base = () => structuredClone(defaults());
  const ok = validateSettings(Object.assign(base(), { djRankDaily: 3, djRankMonthly: 1000000, djRankPrevMonthly: 7 }));
  assert.equal(ok.djRankMonthly, 1000000);
  // 웹 입력칸을 비우면 0이 오는데, 미등록(null)으로 봅니다.
  const blank = validateSettings(Object.assign(base(), { djRankDaily: 0, djRankPrevMonthly: '' }));
  assert.equal(blank.djRankDaily, null); assert.equal(blank.djRankPrevMonthly, null);
  for (const patch of [{ djRankDaily: -1 }, { djRankMonthly: 1000001 }, { djRankPrevMonthly: 1.5 }, { djRankMonthly: 'a' }, { djRankDailyDate: 'x'.repeat(11) }, { djRankPrevMonth: 5 }])
    assert.throws(() => validateSettings(Object.assign(base(), patch)), /순위|DJ 랭킹/, JSON.stringify(patch));
  // 기준일 기록: 값이 바뀌었을 때만 새 날짜·달로 바뀝니다.
  const prev = base(), next = Object.assign(base(), { djRankDaily: 12, djRankMonthly: 45, djRankPrevMonthly: 90 });
  stampDjRank(prev, next, Date.parse('2026-11-23T12:00:00+09:00'));
  assert.deepEqual([next.djRankDailyDate, next.djRankMonthlyMonth, next.djRankPrevMonth], ['2026-11-23', '2026-11', '2026-10']);
  const again = structuredClone(next);
  stampDjRank(next, again, Date.parse('2026-12-05T12:00:00+09:00'));
  assert.deepEqual([again.djRankDailyDate, again.djRankMonthlyMonth, again.djRankPrevMonth], ['2026-11-23', '2026-11', '2026-10'], '값이 같으면 기준일 유지');
  // 1월의 지난달은 전년 12월
  const jan = Object.assign(base(), { djRankPrevMonthly: 5 }); stampDjRank(base(), jan, Date.parse('2027-01-10T12:00:00+09:00'));
  assert.equal(jan.djRankPrevMonth, '2026-12');
  const cleared = Object.assign(structuredClone(again), { djRankDaily: null, djRankMonthly: null, djRankPrevMonthly: null });
  stampDjRank(again, cleared); assert.deepEqual([cleared.djRankDailyDate, cleared.djRankMonthlyMonth, cleared.djRankPrevMonth], ['', '', '']);
  // 이전에 저장된 방(키가 없음)을 불러와도 미등록 기본값이 채워집니다.
  const old = base(); for (const key of ['djRankDaily', 'djRankMonthly', 'djRankPrevMonthly', 'djRankDailyDate', 'djRankMonthlyMonth', 'djRankPrevMonth']) delete old[key];
  const loaded = validateSettings(old);
  assert.deepEqual([loaded.djRankDaily, loaded.djRankPrevMonthly, loaded.djRankDailyDate], [null, null, '']);
});

test('웹 관리 화면의 DJ 랭킹 카드가 입력칸·공식 기준표·이번 달 방송 집계를 보여 줍니다', () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function djRankPanel(){');
  const end = source.indexOf('\n}\n', start) + 3;
  assert.ok(start >= 0 && end > start);
  const render = (settings, progress) => {
    const context = { room: { settings, choiceProgress: progress }, card: (title, body) => `${title}|${body}`, field: (label, key, value) => `[${label}:${key}=${value}]`, table: (head, rows) => `<table>${head.join(',')}${rows.join('')}</table>`, num: value => String(value), saveButton: () => '[save]', esc: value => String(value) };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.html=djRankPanel();`, context);
    return context.html;
  };
  const html = render({ ...defaults(), djRankMonthly: 45, djRankMonthlyMonth: '2026-11' }, { days: 7, minutes: 1290 });
  for (const key of ['djRankDaily', 'djRankMonthly', 'djRankPrevMonthly']) assert.ok(html.includes(`:${key}=`), key);
  assert.ok(html.includes('djRankMonthly=45'));
  // 화면의 기준표가 코드의 기준과 같아야 합니다.
  for (const tier of CHOICE_TIERS) assert.ok(html.includes(`<td>${tier.name}</td><td>${tier.min}~${tier.max}위</td><td>${tier.days}일</td><td>${tier.hours}시간</td><td>${tier.settle}%</td><td>${tier.payoutDays}일</td><td>${tier.benefits.join(' · ')}</td>`), tier.name);
  assert.ok(html.includes('방송을 시작한 날</b>의 기록') && html.includes('오전 5시경') && html.includes('최근 24시간') && html.includes('1일~어제 누적'));
  assert.ok(html.includes('정산 비율') && html.includes('환전 처리일') && html.includes('매월 1일 오후 6~7시') && html.includes('영업일 기준') && html.includes('!초이스안내'));
  assert.ok(html.includes('7일 · 21.5시간') && html.includes('!초이스'));
  assert.ok(html.includes('!랭킹조회') && html.includes('!랭크조회') && html.includes('!랭킹등록 월 45') && html.includes('!랭킹등록 지난달 85') && html.includes('[save]'));
  assert.ok(html.includes('월라디 2026-11') && html.includes('일라디 -') && html.includes('지난달 -'));
});

test('스푼 Choice DJ 안내 기준: 정산 비율·환전 처리일·혜택 데이터와 !초이스안내', () => {
  assert.deepEqual(CHOICE_TIERS.map(t => [t.name, t.settle, t.payoutDays, t.benefits.length]), [['Top Choice', 70, 1, 8], ['Star Choice', 65, 2, 4], ['Normal Choice', 60, 2, 3]]);
  const [top, star, normal] = CHOICE_TIERS;
  assert.ok(top.benefits.includes('1위 선정 시 순금 숟가락 지급') && top.benefits.includes('최초 선정 시 순금 명함 지급') && top.benefits.includes('랭킹 부스터 10개'));
  assert.deepEqual(star.benefits.slice(1), ['방송시간 연장 5개', '고정매니저+3 15일', '퀵메시지+3 15일']);
  assert.deepEqual(normal.benefits, ['방송시간 연장 5개', '고정매니저+3 7일', '퀵메시지+3 7일']);
  const f = setup();
  const guide = '🏅 Choice DJ 티어 (선정 결과는 매월 1일 오후 6~7시 갱신)\nTop Choice 1~10위 · 정산 70% · 환전 1영업일\nStar Choice 11~110위 · 정산 65% · 환전 2영업일\nNormal Choice 111~410위 · 정산 60% · 환전 2영업일';
  for (const command of ['!초이스안내', '!초이스등급', '!초이스기준']) assert.equal(f.say(command).text, guide, command);
  assert.ok([...guide].length <= 200, `길이 ${[...guide].length}`);
  // 같은 이름의 다른 명령은 그대로입니다.
  assert.match(f.say('!초이스').text, /^📊 /);
});
