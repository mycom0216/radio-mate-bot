import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 실제 server.mjs와 기본 퀴즈 문제은행으로 "!라디오", "!간호사"처럼 정답만 입력하는 흐름과 !포기를 확인합니다.
test('a quiz is answered with just the answer (plain or with !) and given up with !포기 on the real server', { timeout: 40000 }, async () => {
  const data = mkdtempSync(join(tmpdir(), 'quiz-answer-http-'));
  const proc = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DATA_DIR: data, NODE_ENV: 'development', SPOON_CLIENT_ID: '', SPOON_CLIENT_SECRET: '', OPENAI_API_KEY: '', NAVER_CLIENT_ID: '', NAVER_CLIENT_SECRET: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    const address = await new Promise((resolve, reject) => {
      let text = ''; const timer = setTimeout(() => reject(Error('server start timeout')), 10000);
      proc.stdout.on('data', c => { text += c; const m = text.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(timer); resolve(m[0]); } });
      proc.on('exit', c => { clearTimeout(timer); reject(Error(`server exited ${c}`)); });
    });
    let res = await fetch(address + '/api/demo', { method: 'POST' });
    const cookie = res.headers.get('set-cookie').split(';')[0], { csrf } = await res.json();
    const headers = { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf };
    const post = (path, body) => fetch(address + path, { method: 'POST', headers, body: JSON.stringify(body) });
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const say = async message => (await (await post('/api/test', { message, user: 'listener-q', name: '퀴즈왕' })).json()).text;
    const round = async () => (await (await fetch(address + '/api/room', { headers })).json()).users['listener-q']?.quizRound ?? null;
    const state = async () => (await (await fetch(address + '/api/room', { headers })).json());
    // 대기시간을 줄이고 퀴즈를 켭니다(기본 문제은행 10문제).
    const current = await state();
    res = await post('/api/settings', { settings: { ...current.settings, cooldown: 1, responseGap: 1, quiz: true, chatMode: 'off' }, expectedRevision: current.settingsRevision || 0 });
    assert.equal(res.status, 200);
    assert.match(await say('!내정보 생성'), /프로필이 준비/);
    await pause(1200);
    const question = await say('!퀴즈');
    assert.match(question, /정답만 입력하세요\(! 붙여도 돼요\)/);assert.match(question, /!포기/);assert.ok(!question.includes('!정답 답안'));
    const answer = (await round()).answers[0];
    await pause(1200);
    assert.match(await say('!의사'), /아쉬워요! 정답: .* \(초성\) · 정답만 입력하세요 \/ !포기/); // 틀린 !낱말은 개인 문제에서 힌트
    assert.ok(await round(), '틀려도 문제는 계속');
    assert.match(await say('!' + answer), /님 정답! /);             // "!라디오" 같은 형태 (대기시간 안이어도 인정)
    assert.equal(await round(), null);
    await pause(1200);
    await say('!퀴즈');
    const second = (await round()).answers[0];
    assert.match(await say(second), /님 정답! /);                      // 느낌표 없이 정답만
    await pause(1200);
    await say('!퀴즈');
    await pause(1200);
    const gaveUp = await say('!포기');                                // !퀴즈 포기와 같은 동작
    assert.match(gaveUp, /^정답은 .+! 뜻: /);
    assert.equal(await round(), null);
    await pause(1200);
    assert.match(await say('!포기'), /진행 중인 문제가 없습니다/);
    await pause(1200);
    assert.match(await say('!도움말'), /!퀴즈 → 정답만 입력 · !포기/);
  } finally {
    const exited = new Promise(r => proc.once('exit', r));
    proc.kill();
    await Promise.race([exited, new Promise(r => setTimeout(r, 3000))]);
    try { rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }
});
