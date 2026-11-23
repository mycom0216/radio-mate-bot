// 관리 화면의 「서버에 보관된 후원 캡처」: 태블릿·폰에서도 쓰는 저장·ZIP·삭제 버튼과 안전한 표시를 검사합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function load() {
  const start = source.indexOf('function captureFilesHtml(data){'), end = source.indexOf('async function loadCaptureFiles()');
  assert.ok(start >= 0 && end > start);
  const context = { esc: value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]), num: value => Number(value).toLocaleString('en-US') };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}\nthis.render=captureFilesHtml;`, context);
  return context.render;
}
const file = (id, frame, extra = {}) => ({ id, eventId: 'evA', frame, nickname: '후원자', amount: 350, time: Date.parse('2026-11-23T12:00:00+09:00'), size: 1048576 * 1.5, width: 921, height: 920, ...extra });

test('보관된 캡처가 없으면 안내 문구를 보여 줍니다', () => {
  const render = load();
  assert.match(render({ files: [], usage: { count: 0, bytes: 0 } }), /아직 서버에 보관된 캡처가 없습니다/);
  assert.match(render(null), /아직 서버에 보관된 캡처가 없습니다/);
});

test('후원 한 건씩 묶어 이미지·저장·삭제 버튼과 ZIP 링크를 보여 줍니다', () => {
  const render = load(), ids = [1, 2, 3, 4, 5].map(n => String(n).padStart(24, 'a'));
  // 일부러 번호 순서를 뒤섞어 보내도 화면에서는 1번부터 보입니다.
  const html = render({ files: [3, 1, 5, 2, 4].map(n => file(ids[n - 1], n)), usage: { count: 5, bytes: 5 * 1048576 * 1.5 } });
  assert.match(html, /보관 중 5장 · 7\.5MB/);
  assert.equal((html.match(/<article class="capture-event">/g) || []).length, 1);
  assert.match(html, /<h3>후원자 · 350스푼<\/h3>/); assert.ok(html.includes('2026'));
  assert.deepEqual([...html.matchAll(/data-id="([a-f0-9]{24})"/g)].map(m => m[1]), ids, '삭제 버튼도 1~5번 순서');
  for (const [i, id] of ids.entries()) {
    assert.ok(html.includes(`<img src="/api/screen-capture/files/${id}"`) && html.includes(`href="/api/screen-capture/files/${id}?download=1" download>저장</a>`), `${i + 1}번 이미지·저장 링크`);
    assert.ok(html.includes(`${i + 1}번째 · 1.5MB`));
  }
  assert.ok(html.includes('href="/api/screen-capture/zip/evA" download>5장 ZIP으로 저장</a>'));
  assert.equal((html.match(/data-action="capture-file-delete"/g) || []).length, 5);
  assert.ok(html.includes('alt="후원자 350스푼 후원 1번째 화면"') && html.includes('loading="lazy"'));
});

test('후원이 여러 건이면 각각 묶고, 금액 0은 테스트로 표시하며, 이벤트 번호는 주소에 안전하게 넣습니다', () => {
  const render = load();
  const html = render({ files: [file('b'.repeat(24), 1, { eventId: 'evB', nickname: '둘째', amount: 1234 }), file('c'.repeat(24), 1, { eventId: 'TEST-123', nickname: '캡처테스트', amount: 0 }), file('d'.repeat(24), 1, { eventId: 'a/b c' })], usage: null });
  assert.equal((html.match(/<article class="capture-event">/g) || []).length, 3);
  assert.ok(html.includes('둘째 · 1,234스푼') && html.includes('캡처테스트 · 0스푼 (테스트)'));
  assert.ok(html.includes('/api/screen-capture/zip/a%2Fb%20c'), '이벤트 번호의 특수문자는 주소 인코딩');
  assert.ok(!html.includes('보관 중'), '사용량 정보가 없으면 생략');
});

test('닉네임의 HTML은 실행되지 않도록 이스케이프합니다', () => {
  const render = load();
  const html = render({ files: [file('e'.repeat(24), 1, { nickname: '<img src=x onerror=alert(1)>"\'&' })], usage: { count: 1, bytes: 1 } });
  assert.ok(!html.includes('<img src=x'), '태그가 그대로 들어가면 안 됨');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;'));
  assert.ok(!/onerror=alert\(1\)(?!&gt;)/.test(html.replace(/&lt;img src=x onerror=alert\(1\)&gt;/g, '')), '속성으로 새어 나가지 않음');
});

test('캡처 카드: 서버 보관 안내, 갤러리 자리, 태블릿·폰 안내가 들어 있고 화면을 그린 뒤 목록을 불러옵니다', () => {
  const start = source.indexOf('function screenCapturePanel(){'), end = source.indexOf('\n', start);
  const panel = source.slice(start, end);
  assert.ok(panel.includes('서버에 보관된 후원 캡처') && panel.includes('id="capture-files"') && panel.includes('data-action="capture-files-refresh"') && panel.includes('data-action="capture-files-clear"'));
  assert.ok(panel.includes('태블릿·폰') && panel.includes('버전 1.2.0') && !panel.includes('서버로 이미지를 업로드하지 않습니다'));
  assert.ok(source.includes("if(page==='records')void loadCaptureFiles();"), '기록 화면을 그린 뒤 목록을 불러옴');
  for (const action of ['capture-files-refresh', 'capture-file-delete', 'capture-files-clear']) assert.ok(source.includes(`if(a==='${action}')`), action);
  assert.match(readFileSync(new URL('../public/style.css', import.meta.url), 'utf8'), /\.capture-grid\{display:grid/);
});
