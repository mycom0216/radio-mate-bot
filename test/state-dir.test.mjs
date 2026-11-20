import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stateDir, prepareState } from '../tools/runtime-policy.mjs';

// 방송 서버를 OneDrive 같은 동기화 폴더에서 돌려도 자동 운영 관리자의 상태·로그·PID 파일이 동기화와 겹치지 않도록,
// 이 파일들을 deploy/temporary.env의 RADIOMATE_STATE_DIR(로컬 폴더)에 둘 수 있어야 합니다. 비워 두면 예전처럼 deploy입니다.
function project(envText) {
  const root = mkdtempSync(join(tmpdir(), 'radio-state-'));
  mkdirSync(join(root, 'deploy'));
  if (envText !== undefined) writeFileSync(join(root, 'deploy', 'temporary.env'), envText);
  return root;
}
const remove = (...dirs) => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); };
const forward = path => path.replaceAll('\\', '/');

test('RADIOMATE_STATE_DIR가 없으면 예전처럼 deploy 폴더를 쓴다(temporary.env가 없어도 오류 없음)', () => {
  const root = project('PORT=4395\nDATA_DIR=./data\n');
  const empty = mkdtempSync(join(tmpdir(), 'radio-state-empty-'));
  try {
    assert.equal(stateDir(root, {}), join(root, 'deploy'));
    assert.equal(stateDir(empty, {}), join(empty, 'deploy'));
  } finally { remove(root, empty); }
});

test('상태 폴더는 환경변수나 deploy/temporary.env에서 읽고, 상대 경로는 프로젝트 폴더 기준으로 푼다', () => {
  const outside = mkdtempSync(join(tmpdir(), 'radio-state-out-'));
  const root = project(`PORT=4395\nRADIOMATE_STATE_DIR=${forward(outside)}\n`);
  try {
    assert.equal(stateDir(root, {}), resolve(outside));
    assert.equal(stateDir(root, { RADIOMATE_STATE_DIR: './run-state' }), join(root, 'run-state'), '환경변수가 파일보다 우선합니다');
    writeFileSync(join(root, 'deploy', 'temporary.env'), 'PORT=1\r\nRADIOMATE_STATE_DIR=../state-dir\r\n');
    assert.equal(stateDir(root, {}), resolve(root, '../state-dir'), 'CRLF 파일도 읽습니다');
    assert.equal(stateDir(root, { RADIOMATE_STATE_DIR: '   ' }), resolve(root, '../state-dir'), '공백만 있으면 없는 것으로 봅니다');
  } finally { remove(root, outside); }
});

test('prepareState는 상태 폴더를 만들고 옛 automation.json을 새 폴더에 없을 때 한 번만 복사한다', () => {
  const outside = mkdtempSync(join(tmpdir(), 'radio-state-out-'));
  const state = join(outside, 'nested', 'state');
  const root = project(`RADIOMATE_STATE_DIR=${forward(state)}\n`);
  try {
    writeFileSync(join(root, 'deploy', 'automation.json'), JSON.stringify({ enabled: false, gatewayUrl: 'https://example.test' }));
    assert.equal(prepareState(root, {}), resolve(state));
    assert.deepEqual(JSON.parse(readFileSync(join(state, 'automation.json'), 'utf8')), { enabled: false, gatewayUrl: 'https://example.test' });
    writeFileSync(join(state, 'automation.json'), JSON.stringify({ enabled: true, gatewayUrl: 'https://example.test', sequence: 7 }));
    prepareState(root, {});
    assert.equal(JSON.parse(readFileSync(join(state, 'automation.json'), 'utf8')).sequence, 7, '이미 있으면 덮어쓰지 않습니다');
  } finally { remove(root, outside); }
});

test('상태 폴더가 deploy이면 아무것도 복사하거나 만들지 않는다', () => {
  const root = project('PORT=1\n');
  try {
    writeFileSync(join(root, 'deploy', 'automation.json'), '{"enabled":true}');
    assert.equal(prepareState(root, {}), join(root, 'deploy'));
    assert.deepEqual(readdirSync(join(root, 'deploy')).sort(), ['automation.json', 'temporary.env']);
  } finally { remove(root); }
});

// 나중에 코드를 고치다가 실행 중 바뀌는 파일을 다시 deploy(동기화 폴더)에 쓰게 되는 일을 막는 가드입니다.
test('관리자·설치 도구·서버는 실행 중 바뀌는 파일을 상태 폴더에서만 다룬다', () => {
  const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
  const manager = read('tools/managed-runtime.mjs');
  assert.doesNotMatch(manager, /join\(DEPLOY,'(automation|public|tunnel-out)/, '상태·로그·PID는 STATE 폴더에 둬야 합니다');
  for (const name of ['automation.json', 'automation.pid', 'automation.lock', 'automation.log', 'automation-status.json', 'automation-error.log', 'public.pid', 'public-out.log', 'public-error.log', 'tunnel-out.log']) {
    assert.ok(manager.includes(`join(STATE,'${name}')`), `${name}은 STATE 폴더에 둬야 합니다`);
  }
  for (const name of ['temporary.env', 'gateway-router.key', 'cloudflared.exe']) {
    assert.ok(manager.includes(`join(DEPLOY,'${name}')`), `${name}은 읽기만 하므로 deploy에 남습니다`);
  }
  assert.match(read('tools/install-automation.mjs'), /prepareState\(root\)/);
  assert.ok(read('server.mjs').includes("join(STATE_DIR,'automation-status.json')"));
});
