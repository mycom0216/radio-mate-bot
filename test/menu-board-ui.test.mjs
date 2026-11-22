// 웹 관리 화면(public/app.js)의 "후원 메뉴판" 입력 기능을 검사하는 테스트입니다.
// 브라우저가 없어도 돌릴 수 있도록, app.js 안의 메뉴판 구간만 잘라 가짜 화면(document)과 함께 실행합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Store, validateSettings } from '../core.mjs';

// app.js에서 "후원 메뉴판 시작" ~ "후원 메뉴판 끝" 사이의 코드만 꺼냅니다.
const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const start = source.indexOf('// ── 후원 메뉴판 시작');
const end = source.indexOf('// ── 후원 메뉴판 끝 ──');
assert.ok(start >= 0 && end > start, 'app.js에서 메뉴판 구간을 찾을 수 없습니다.');
const menuCode = source.slice(start, end);
// 같은 파일에서 esc(특수문자 안전 처리) 함수도 그대로 가져옵니다.
const declarations = source.split('\n').find(line => line.startsWith('const $='));
const escLine = declarations.slice(declarations.indexOf('esc='), declarations.indexOf(',num='));

// 가짜 화면을 만들어 메뉴판 코드를 실행합니다.
// rows: 화면에 입력된 줄 목록 [{amount, text}], boardOpen: 메뉴판 카드가 열려 있는지 여부
function load({ rows = [], boardOpen = true, reactions = {} } = {}) {
  const fakeRows = rows.map(r => ({
    querySelector: selector => ({ value: selector.includes('amount') ? r.amount : r.text }),
  }));
  const context = {
    document: { querySelectorAll: selector => (selector === '[data-menu-row]' ? fakeRows : []) },
    $: selector => (selector === '[data-menu-board]' && boardOpen ? {} : null),
    room: { settings: { donationReactions: reactions } },
    // 카드·표 만들기 함수는 내용만 확인하면 되므로 단순한 버전으로 바꿔 둡니다.
    card: (title, body) => body,
    table: (headers, bodyRows) => bodyRows.join(''),
    saveButton: () => '',
  };
  vm.createContext(context);
  vm.runInContext(`const ${escLine};\n${menuCode}\nthis.api={menuAmountKey,menuRows,menuProblem,menuBoardPanel};`, context);
  return context.api;
}

test('스푼 금액 입력값을 저장용 숫자 글자로 맞춥니다', () => {
  const { menuAmountKey } = load();
  assert.equal(menuAmountKey(' 10 '), '10');
  assert.equal(menuAmountKey('010'), '10');
  assert.equal(menuAmountKey(''), '');
  assert.equal(menuAmountKey('1.5'), '1.5');
});

test('올바른 메뉴판 입력은 문제가 없고 저장용 형태로 바뀝니다', () => {
  const rows = [{ amount: '10', text: '{name}님 하트 💖' }, { amount: '100', text: '{amount}스푼 감사해요' }];
  const { menuProblem, menuRows } = load({ rows });
  assert.equal(menuProblem(), '');
  // 화면 줄을 저장용 형태({ 금액: 문구 })로 바꿔 봅니다.
  const reactions = Object.fromEntries(menuRows().map(r => [r.amount, r.text]));
  assert.deepEqual(reactions, { 10: '{name}님 하트 💖', 100: '{amount}스푼 감사해요' });
});

test('잘못된 입력은 저장 전에 안내 문구로 막습니다', () => {
  const cases = [
    [[{ amount: '', text: '문구' }], /1 이상의 정수/],
    [[{ amount: '0', text: '문구' }], /1 이상의 정수/],
    [[{ amount: '1.5', text: '문구' }], /1 이상의 정수/],
    [[{ amount: '10', text: '' }], /문구를 입력/],
    [[{ amount: '10', text: 'a'.repeat(101) }], /100자 이내/],
    [[{ amount: '10', text: 'a' }, { amount: '010', text: 'b' }], /두 번 이상/],
    [Array.from({ length: 51 }, (_, i) => ({ amount: String(i + 1), text: 'x' })), /최대 50개/],
  ];
  for (const [rows, message] of cases) assert.match(load({ rows }).menuProblem(), message);
});

test('메뉴판 카드가 열려 있지 않으면 검사하지 않습니다', () => {
  assert.equal(load({ rows: [{ amount: '', text: '' }], boardOpen: false }).menuProblem(), '');
});

test('메뉴판 카드는 금액이 작은 순서로 보여 주고 문구의 특수문자를 안전하게 처리합니다', () => {
  const html = load({ reactions: { 100: '큰 후원', 10: '<b>하트</b>' } }).menuBoardPanel();
  assert.ok(html.includes('data-menu-board'));
  assert.ok(html.indexOf('value="10"') < html.indexOf('value="100"'), '10스푼이 100스푼보다 먼저 나와야 합니다.');
  assert.ok(html.includes('&lt;b&gt;하트&lt;/b&gt;') && !html.includes('<b>하트</b>'));
  assert.ok(load({ reactions: {} }).menuBoardPanel().includes('등록된 메뉴가 없습니다'));
});

test('서버는 웹 화면에서 만든 메뉴판 형태를 그대로 받아들이고 잘못된 형태는 거부합니다', () => {
  const store = new Store();
  store.create('menu', 'M');
  const settings = structuredClone(store.load('menu').settings);
  settings.donationReactions = { 10: '{name}님, {amount}스푼 감사합니다 💖', 100: '큰 후원 감사합니다' };
  assert.deepEqual(validateSettings(settings).donationReactions, settings.donationReactions);
  settings.donationReactions = { 0: '잘못된 금액' };
  assert.throws(() => validateSettings(settings), /메뉴판/);
});
