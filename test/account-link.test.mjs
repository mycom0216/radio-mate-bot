// 스푼 프로필의 @아이디를 !계정연결로 한 번 연결한 뒤, 그 아이디로 복권을 지급할 수 있는지 검사합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, Store } from '../core.mjs';

// 방 'a'에 청취자 3명(u1=가, u2=나, u3=다)을 등록해 두고 시작합니다.
function setup() {
  const store = new Store();
  let time = Date.parse('2026-11-16T00:00:00Z'), counter = 0;
  const engine = new Engine(store, { now: () => time, int: (a) => a });
  store.create('a', 'A');
  // DJ 명령은 청취자와 다른 계정(id 'dj')이 보냅니다. 같은 id로 보내면 청취자 닉네임이 DJ 닉네임으로 바뀌어 버립니다.
  const say = (message, { id, name, dj = false } = {}) => {
    time += 21000;
    const sender = id ?? (dj ? 'dj' : 'u1'), nickname = name ?? (dj ? 'DJ' : '청취자');
    return engine.handle('a', { id: `event-${++counter}`, user: { id: sender, nickname }, message, isDj: dj });
  };
  for (const [id, name] of [['u1', '가'], ['u2', '나'], ['u3', '다']]) say('!내정보 생성', { id, name });
  return { store, say, user: id => store.load('a').users[id] };
}

test('아이디를 연결하기 전에는 @아이디로 지급할 수 없고, 연결 방법을 안내합니다', () => {
  const f = setup();
  const out = f.say('!복권지급 @kang_1 4', { dj: true });
  assert.match(out.text, /일치하는 청취자가 없습니다/);
  assert.match(out.text, /!계정연결 닉네임 @아이디/);
  assert.equal(f.user('u1').tickets, 0);
});

test('!계정연결로 한 번 연결하면 @아이디로 복권을 지급할 수 있습니다', () => {
  const f = setup();
  const linked = f.say('!계정연결 가 @kang_1', { dj: true });
  assert.match(linked.text, /가님에게 스푼 ID @kang_1를 연결했어요/);
  assert.equal(f.user('u1').accountAlias, 'kang_1');
  // @가 있든 없든, 대소문자가 달라도 같은 청취자로 찾습니다.
  assert.match(f.say('!복권지급 @kang_1 4', { dj: true }).text, /가님 복권 4장 지급/);
  assert.match(f.say('!복권지급 KANG_1 2', { dj: true }).text, /가님 복권 2장 지급/);
  assert.equal(f.user('u1').tickets, 6);
  assert.equal(f.user('u2').tickets, 0);
  // 연결 기록이 남습니다.
  assert.equal(f.store.logs('a').filter(l => l.type === 'identity-alias').length, 1);
});

test('고유 ID로도 대상을 지정해 연결할 수 있고, 같은 청취자에게 다시 연결해도 됩니다', () => {
  const f = setup();
  f.say('!계정연결 @u2 @first.id', { dj: true });
  assert.equal(f.user('u2').accountAlias, 'first.id');
  f.say('!계정연결 @u2 @second-id', { dj: true });
  assert.equal(f.user('u2').accountAlias, 'second-id');
  f.say('!복권지급 @second-id 1', { dj: true });
  assert.equal(f.user('u2').tickets, 1);
});

test('DJ가 아니면 연결할 수 없습니다', () => {
  const f = setup();
  assert.match(f.say('!계정연결 가 @kang_1', { id: 'u2' }).text, /DJ 전용/);
  assert.equal(f.user('u1').accountAlias, undefined);
});

test('사용법이 틀리거나 아이디가 겹치면 연결하지 않습니다', () => {
  const f = setup();
  assert.match(f.say('!계정연결', { dj: true }).text, /사용법/);
  assert.match(f.say('!계정연결 가', { dj: true }).text, /사용법/);
  assert.match(f.say('!계정연결 가 kang_1', { dj: true }).text, /사용법/);
  assert.match(f.say('!계정연결 가 @', { dj: true }).text, /사용법/);
  // 허용되지 않는 글자
  assert.match(f.say('!계정연결 가 @kang!1', { dj: true }).text, /형식이 올바르지 않습니다/);
  // 다른 청취자의 닉네임·고유 ID·이미 연결된 아이디와 겹침
  f.say('!계정연결 가 @kang_1', { dj: true });
  assert.match(f.say('!계정연결 나 @kang_1', { dj: true }).text, /중복/);
  assert.match(f.say('!계정연결 나 @u3', { dj: true }).text, /중복/);
  assert.match(f.say('!계정연결 나 @다', { dj: true }).text, /중복/);
  assert.equal(f.user('u2').accountAlias, undefined);
});

test('일치하는 청취자가 없으면 연결하지 않습니다', () => {
  const f = setup();
  assert.match(f.say('!계정연결 존재안함 @x1', { dj: true }).text, /일치하는 청취자가 없습니다/);
  assert.equal(f.store.logs('a').filter(l => l.type === 'identity-alias').length, 0);
});
