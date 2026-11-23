// 방송일수·방송시간 집계(넥스트초이스 활동 기준)와 !초이스 명령을 검사합니다.
// 규칙: 5분 이상 이어진 방송만 더하고, 하루(한국 시간)에 1시간 이상 방송한 날을 1일로 셉니다. 봇이 연결돼 있던 시간만 셉니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, Store } from '../core.mjs';

const kst = text => Date.parse(`${text}+09:00`);
const MIN = 60000;
function setup(start = '2026-11-23T12:00:00') {
  const store = new Store();
  let time = kst(start), counter = 0;
  const engine = new Engine(store, { now: () => time, int: a => a });
  store.create('r', '콰앙의 라디오');
  const mutate = fn => store.transaction('r', r => fn(r, time));
  const room = () => store.load('r');
  const summary = () => engine.liveSummary(room(), time);
  const at = text => { time = kst(text); };
  const say = message => { time += 21000; return engine.handle('r', { id: `c${++counter}`, user: { id: 'u1', nickname: '가' }, message }).text; };
  // 방송 한 번: start부터 minutes분 동안 연결 (끝나면 연결 종료)
  // (방송 중에는 스케줄 점검이 5초마다 liveMaintain으로 '확인 신호'를 남기므로, 시험에서도 끝나기 직전에 한 번 남깁니다)
  const broadcast = (start, minutes) => { at(start); mutate((r, now) => { r.live = true; engine.liveStart(r, now); }); time += minutes * MIN; mutate((r, now) => engine.liveMaintain(r, now)); mutate((r, now) => { r.live = false; engine.liveEnd(r, now); }); };
  return { store, engine, mutate, room, summary, at, say, broadcast, now: () => time };
}

test('70분 방송은 1일·70분, 5분 미만 방송은 더하지 않습니다', () => {
  const f = setup();
  f.broadcast('2026-11-23T20:00:00', 70);
  f.at('2026-11-23T22:00:00'); f.mutate((r, now) => f.engine.liveMaintain(r, now)); // 정산
  assert.deepEqual(f.summary(), { days: 1, minutes: 70 });
  f.broadcast('2026-11-24T10:00:00', 4);
  f.at('2026-11-24T11:00:00'); f.mutate((r, now) => f.engine.liveMaintain(r, now));
  assert.deepEqual(f.summary(), { days: 1, minutes: 70 }, '4분 방송은 집계되지 않음');
});

test('공식 예시: 첫 방송 4분 + 둘째 방송 58분 → 총 58분이고 1시간 미만이라 방송일 0일', () => {
  const f = setup();
  f.broadcast('2026-11-23T09:00:00', 4);
  f.broadcast('2026-11-23T13:00:00', 58);
  f.at('2026-11-23T16:00:00'); f.mutate((r, now) => f.engine.liveMaintain(r, now));
  assert.deepEqual(f.summary(), { days: 0, minutes: 58 });
});

test('같은 날 방송을 합쳐 1시간이 넘으면 1일로 셉니다', () => {
  const f = setup();
  f.broadcast('2026-11-23T09:00:00', 40);
  f.broadcast('2026-11-23T14:00:00', 30);
  f.at('2026-11-23T20:00:00'); f.mutate((r, now) => f.engine.liveMaintain(r, now));
  assert.deepEqual(f.summary(), { days: 1, minutes: 70 });
});

test('2분 안에 끊겼다 다시 연결되면 한 방송으로 이어 보고, 그보다 길게 끊기면 따로 봅니다', () => {
  const f = setup();
  // 3분 방송 → 1분 끊김 → 3분 방송: 이어서 한 방송(7분)으로 집계
  f.broadcast('2026-11-23T10:00:00', 3);
  f.at('2026-11-23T10:04:00'); f.mutate((r, now) => { r.live = true; f.engine.liveStart(r, now); });
  f.at('2026-11-23T10:07:00'); f.mutate((r, now) => { r.live = false; f.engine.liveEnd(r, now); });
  f.at('2026-11-23T11:00:00'); f.mutate((r, now) => f.engine.liveMaintain(r, now));
  assert.equal(Math.round(f.summary().minutes), 7);
  // 3분 방송 → 10분 끊김 → 3분 방송: 각각 5분 미만이라 집계되지 않음
  const g = setup();
  g.broadcast('2026-11-23T10:00:00', 3); g.broadcast('2026-11-23T10:13:00', 3);
  g.at('2026-11-23T12:00:00'); g.mutate((r, now) => g.engine.liveMaintain(r, now));
  assert.equal(g.summary().minutes, 0);
});

test('방송 데이터는 방송을 시작한 날의 기록입니다 (자정을 넘겨도 시작한 날로 셈)', () => {
  const f = setup();
  f.broadcast('2026-11-22T23:30:00', 130); // 23:30 ~ 01:40 → 전부 11-22
  f.at('2026-11-23T05:00:00'); f.mutate((r, now) => f.engine.liveMaintain(r, now));
  const days = f.room().liveStats['2026-11'].days;
  assert.deepEqual(Object.keys(days), ['2026-11-22']);
  assert.equal(Math.round(days['2026-11-22']), 130);
  assert.deepEqual([f.summary().days, Math.round(f.summary().minutes)], [1, 130], '시작한 날에 130분이므로 1일');
});

test('공식 예시: 1월 31일 23:50 ~ 2월 1일 00:10 방송은 1월 31일로 집계됩니다 (달을 넘겨도 시작한 달)', () => {
  const f = setup('2027-01-31T20:00:00');
  f.broadcast('2027-01-31T23:50:00', 20);
  f.at('2027-02-01T09:00:00'); f.mutate((r, now) => f.engine.liveMaintain(r, now));
  assert.deepEqual(Object.keys(f.room().liveStats), ['2027-01']);
  assert.equal(Math.round(f.room().liveStats['2027-01'].days['2027-01-31']), 20);
  assert.deepEqual(f.summary(), { days: 0, minutes: 0 }, '2월 현황에는 들어가지 않음');
  f.at('2027-01-31T23:59:00');
});

test('진행 중인 방송과 닫힌 지 얼마 안 된 방송도 현황에 포함합니다', () => {
  const f = setup();
  f.at('2026-11-23T20:00:00'); f.mutate((r, now) => { r.live = true; f.engine.liveStart(r, now); });
  f.at('2026-11-23T21:30:00'); // 아직 방송 중 (정산 전)
  assert.deepEqual([f.summary().days, Math.round(f.summary().minutes)], [1, 90]);
  assert.equal(f.room().liveStats, undefined, '정산 전에는 저장된 집계가 없음');
});

test('확인 신호가 끊긴 채 종료되면(서버 중단 등) 마지막 확인+3분까지만 인정합니다', () => {
  const f = setup();
  f.at('2026-11-23T10:00:00'); f.mutate((r, now) => { r.live = true; f.engine.liveStart(r, now); });
  f.at('2026-11-23T10:30:00'); f.mutate((r, now) => f.engine.liveMaintain(r, now)); // 30분까지 확인
  f.at('2026-11-23T15:00:00'); f.mutate((r, now) => { r.live = false; f.engine.liveEnd(r, now); }); // 서버가 한참 뒤 종료 처리
  assert.equal(f.room().liveSession.last, kst('2026-11-23T10:33:00'));
  f.at('2026-11-23T16:00:00'); f.mutate((r, now) => f.engine.liveMaintain(r, now));
  assert.equal(Math.round(f.summary().minutes), 33);
});

test('연결이 끊긴 것을 점검이 알아채고, 정산은 닫힌 지 2분 뒤에 합니다', () => {
  const f = setup();
  f.at('2026-11-23T10:00:00'); f.mutate((r, now) => { r.live = true; f.engine.liveStart(r, now); });
  f.at('2026-11-23T10:20:00'); f.mutate((r, now) => f.engine.liveMaintain(r, now)); // 20분까지 확인 신호
  f.mutate(r => { r.live = false; }); // 연결 상태만 꺼짐 (liveEnd 호출 누락)
  f.at('2026-11-23T10:21:00'); f.mutate((r, now) => f.engine.liveMaintain(r, now));
  assert.equal(f.room().liveSession.open, false);
  assert.equal(f.room().liveStats, undefined, '2분이 지나기 전에는 정산하지 않음');
  f.at('2026-11-23T10:24:30'); f.mutate((r, now) => f.engine.liveMaintain(r, now));
  assert.equal(f.room().liveSession, undefined);
  assert.equal(Math.round(Object.values(f.room().liveStats['2026-11'].days)[0]), 21);
});

test('이번 달만 세고, 오래된 달은 3개월까지만 보관합니다', () => {
  const f = setup();
  for (const [day, minutes] of [['2026-08-10', 120], ['2026-09-10', 120], ['2026-10-10', 120], ['2026-11-10', 90]]) f.broadcast(`${day}T20:00:00`, minutes);
  f.at('2026-11-23T12:00:00'); f.mutate((r, now) => f.engine.liveMaintain(r, now));
  assert.deepEqual(Object.keys(f.room().liveStats).sort(), ['2026-09', '2026-10', '2026-11']);
  assert.deepEqual([f.summary().days, Math.round(f.summary().minutes)], [1, 90], '10월 방송은 이번 달 현황에 들어가지 않음');
});

test('!초이스: 이번 달 방송일수·시간을 등급별 기준과 비교해 보여 줍니다', () => {
  const f = setup();
  assert.equal(f.say('!초이스'), '📊 콰앙의 라디오 이번 달 방송 0일 · 0시간\nNormal Choice(15일·30시간) 15일·30시간 남음\nTop·Star Choice(20일·45시간) 20일·45시간 남음\n※ 봇이 연결된 동안만 집계해 공식 기록과 다를 수 있어요');
  // 16일 × 2시간 = 32시간 → Normal 달성, Top·Star는 4일·13시간 남음
  f.mutate(r => { r.liveStats = { '2026-11': { days: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`2026-11-${String(i + 1).padStart(2, '0')}`, 120])) } }; });
  const text = f.say('!초이스');
  assert.match(text, /이번 달 방송 16일 · 32시간\nNormal Choice\(15일·30시간\) ✅ 달성\nTop·Star Choice\(20일·45시간\) 4일·13시간 남음/);
  assert.ok([...text].length <= 200, `길이 ${[...text].length}`);
  for (const alias of ['!초이스조회', '!방송기록']) assert.equal(f.say(alias), text, alias);
  // 일수만 모자란 경우, 시간만 모자란 경우
  f.mutate(r => { r.liveStats = { '2026-11': { days: Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`2026-11-${String(i + 1).padStart(2, '0')}`, 180])) } }; });
  assert.match(f.say('!초이스'), /14일 · 42시간\nNormal Choice\(15일·30시간\) 1일·0시간 남음\nTop·Star Choice\(20일·45시간\) 6일·3시간 남음/);
});

test('방 정보에 이번 달 방송 집계가 포함됩니다 (웹 화면용)', () => {
  const f = setup();
  f.broadcast('2026-11-23T20:00:00', 100);
  f.at('2026-11-23T23:00:00'); f.mutate((r, now) => f.engine.liveMaintain(r, now));
  assert.deepEqual(f.summary(), { days: 1, minutes: 100 });
});
