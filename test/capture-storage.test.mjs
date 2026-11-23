// 서버에 보관되는 후원 캡처(PNG 검사·저장·목록·내려받기·ZIP·삭제·한도)를 검사합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { Store } from '../core.mjs';
import { ScreenCapture, inspectPng } from '../screen-capture.mjs';
import { buildZip, crc32 } from '../zip-store.mjs';

// 시험용 진짜 PNG를 만듭니다. (무작위 화소라 1KB보다 커서 작은 파일 검사에 걸리지 않음)
function png(width = 120, height = 120, noise = true) {
  const crcOf = buffer => { const out = Buffer.alloc(4); out.writeUInt32BE(crc32(buffer)); return out; };
  const chunk = (type, data) => { const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type, 'latin1'), data]); return Buffer.concat([length, body, crcOf(body)]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const rows = []; for (let y = 0; y < height; y++) rows.push(Buffer.concat([Buffer.from([0]), noise ? randomBytes(width * 3) : Buffer.alloc(width * 3, 7)]));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
const NOW = Date.parse('2026-11-23T12:00:00+09:00');
function setup(extra = {}) {
  const store = new Store(), dir = mkdtempSync(join(tmpdir(), 'capture-store-'));
  let time = NOW;
  const captures = new ScreenCapture(store, { now: () => time });
  captures.configure({ dir, ...extra });
  store.create('roomA', 'A'); store.create('roomB', 'B');
  const meta = (eventId = 'a'.repeat(64), frame = 1, extra = {}) => ({ eventId, frame, amount: 350, time: NOW - 1000, nickname: '후원자', ...extra });
  return { store, dir, captures, meta, advance: ms => { time += ms; }, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
// 간단한 ZIP 읽기: 중앙 디렉터리의 파일 이름·CRC·내용을 꺼냅니다. (만든 ZIP이 표준 형식인지 확인용)
function readZip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])), count = buffer.readUInt16LE(end + 10), entries = [];
  let at = buffer.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(at), 0x02014b50);
    const crc = buffer.readUInt32LE(at + 16), size = buffer.readUInt32LE(at + 24), nameLength = buffer.readUInt16LE(at + 28), offset = buffer.readUInt32LE(at + 42), flags = buffer.readUInt16LE(at + 8);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength), local = offset, dataAt = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    entries.push({ name, crc, flags, data: buffer.subarray(dataAt, dataAt + size) });
    at += 46 + nameLength;
  }
  return entries;
}

test('PNG 검사: 진짜 PNG만 통과하고 크기·서명·끝·화면 크기를 확인합니다', () => {
  const good = png(160, 90 + 20);
  assert.deepEqual(inspectPng(good), { width: 160, height: 110 });
  assert.throws(() => inspectPng(Buffer.from('아무 글자나 1KB가 안 되는 내용')), /PNG 크기/);
  assert.throws(() => inspectPng(Buffer.alloc(5000, 1)), /올바른 PNG/);
  const brokenEnd = Buffer.from(good); brokenEnd[brokenEnd.length - 1] ^= 1;
  assert.throws(() => inspectPng(brokenEnd), /올바른 PNG/);
  assert.throws(() => inspectPng(png(50, 200)), /화면 크기/);
  assert.throws(() => inspectPng(png(200, 50)), /화면 크기/);
  assert.throws(() => inspectPng(Buffer.concat([good, Buffer.alloc(9 * 1024 * 1024)])), error => error.status === 413);
  assert.throws(() => inspectPng('문자열'), /PNG 크기/);
});

test('저장·목록·내려받기: 파일은 서버 폴더에 서버가 만든 이름으로 보관되고 같은 장은 한 번만 받습니다', () => {
  const f = setup();
  try {
    const bytes = png();
    const saved = f.captures.save('roomA', f.meta(), bytes);
    assert.equal(saved.duplicate, false);
    assert.match(saved.id, /^[a-f0-9]{24}$/);
    // 서버가 만든 영문·숫자 이름: 후원자 닉네임이 경로에 들어가지 않습니다. (방 키/날짜/파일)
    const files = []; const walk = d => readdirSync(d, { withFileTypes: true }).forEach(e => e.isDirectory() ? walk(join(d, e.name)) : files.push(join(d, e.name)));
    walk(f.dir);
    assert.equal(files.length, 1);
    assert.match(files[0].slice(f.dir.length + 1).replaceAll('\\', '/'), /^[a-f0-9]{16}\/2026-11-23\/115959_350spoon_aaaaaaaa_f1_[a-f0-9]{6}\.png$/);
    assert.deepEqual(readFileSync(files[0]), bytes);
    // 같은 (후원, 장)을 다시 보내면 중복으로 처리하고 새 파일을 만들지 않습니다.
    const again = f.captures.save('roomA', f.meta(), png());
    assert.deepEqual([again.duplicate, again.id], [true, saved.id]);
    assert.equal(f.captures.usage('roomA').count, 1);
    // 목록·내려받기
    assert.deepEqual(f.captures.files('roomA').map(file => [file.eventId, file.frame, file.nickname, file.amount, file.width, file.height]), [['a'.repeat(64), 1, '후원자', 350, 120, 120]]);
    const read = f.captures.file('roomA', saved.id);
    assert.deepEqual(read.data, bytes); assert.equal(read.row.nickname, '후원자');
    assert.deepEqual(f.captures.usage('roomA'), { count: 1, bytes: bytes.length });
    // 다시 시작해도(새 객체) 목록과 파일이 남아 있습니다.
    const reopened = new ScreenCapture(f.store); reopened.configure({ dir: f.dir });
    assert.equal(reopened.files('roomA').length, 1); assert.deepEqual(reopened.file('roomA', saved.id).data, bytes);
  } finally { f.cleanup(); }
});

test('입력 검사: 잘못된 후원 정보·장 번호·PNG가 아닌 파일·과도한 업로드는 거절합니다', () => {
  const f = setup();
  try {
    const bytes = png();
    for (const bad of [{ eventId: '' }, { eventId: '../../etc/passwd' }, { eventId: 'a b' }, { eventId: 'x'.repeat(81) }, { frame: 0 }, { frame: 10 }, { frame: 1.5 }, { amount: -1 }, { amount: 1.5 }, { amount: 'abc' }, { time: 'x' }])
      assert.throws(() => f.captures.save('roomA', f.meta('e1', 1, bad), bytes), /캡처 정보/, JSON.stringify(bad));
    assert.throws(() => f.captures.save('roomA', f.meta(), Buffer.alloc(5000, 2)), error => error.status === 415);
    assert.equal(f.captures.usage('roomA').count, 0);
    // 닉네임의 제어 문자는 지우고 40자로 줄이며, 비어 있으면 '청취자'
    f.captures.save('roomA', f.meta('e2', 1, { nickname: '  \u0007진짜\u0000닉네임 ' + 'ㅋ'.repeat(60) }), png());
    f.captures.save('roomA', f.meta('e3', 1, { nickname: '   ' }), png());
    const names = f.captures.files('roomA').map(file => file.nickname);
    assert.ok(names.includes('청취자') && names.some(name => name.startsWith('진짜닉네임') && [...name].length === 40));
    // 보관 폴더가 없는 서버(공개 체험 등)는 받지 않습니다.
    const none = new ScreenCapture(f.store);
    assert.throws(() => none.save('roomA', f.meta('e4'), bytes), error => error.status === 503);
  } finally { f.cleanup(); }
});

test('방마다 분당 30장까지만 받고, 1분이 지나면 다시 받습니다', () => {
  const f = setup({ maxFiles: 1000 });
  try {
    for (let i = 0; i < 30; i++) f.captures.save('roomA', f.meta('ev' + i, 1), png(110, 110));
    assert.throws(() => f.captures.save('roomA', f.meta('ev99', 1), png(110, 110)), error => error.status === 429);
    f.captures.save('roomB', f.meta('evB', 1), png(110, 110)); // 다른 방은 영향 없음
    f.advance(61000);
    f.captures.save('roomA', f.meta('ev100', 1), png(110, 110));
    assert.equal(f.captures.usage('roomA').count, 31);
  } finally { f.cleanup(); }
});

test('다른 방의 캡처는 보이지도 지워지지도 않습니다', () => {
  const f = setup();
  try {
    const a = f.captures.save('roomA', f.meta('evA'), png());
    f.captures.save('roomB', f.meta('evB'), png());
    assert.throws(() => f.captures.file('roomB', a.id), error => error.status === 404);
    assert.throws(() => f.captures.zip('roomB', 'evA'), error => error.status === 404);
    assert.equal(f.captures.remove('roomB', [a.id]), 0);
    assert.equal(f.captures.files('roomA').length, 1); assert.equal(f.captures.files('roomB').length, 1);
    for (const id of ['', 'zz', '../x', 'A'.repeat(24), null, undefined]) assert.throws(() => f.captures.file('roomA', id), error => error.status === 404, String(id));
  } finally { f.cleanup(); }
});

test('후원 한 건의 여러 장을 표준 ZIP 하나로 묶습니다 (한글 이름 포함, 내용·CRC 일치)', () => {
  const f = setup();
  try {
    const frames = [1, 2, 3].map(frame => ({ frame, bytes: png(130, 130) }));
    for (const { frame, bytes } of frames) f.captures.save('roomA', f.meta('evZip', frame, { nickname: '한글닉' }), bytes);
    f.captures.save('roomA', f.meta('other', 1), png());
    const { data, name } = f.captures.zip('roomA', 'evZip');
    assert.equal(name, 'RadioMate-2026-11-23-350spoon.zip');
    const entries = readZip(data);
    assert.deepEqual(entries.map(entry => entry.name), ['2026-11-23_350spoon_frame01.png', '2026-11-23_350spoon_frame02.png', '2026-11-23_350spoon_frame03.png']);
    entries.forEach((entry, i) => { assert.deepEqual(entry.data, frames[i].bytes); assert.equal(entry.crc, crc32(frames[i].bytes)); assert.equal(entry.flags & 0x0800, 0x0800); });
    // 한글 이름도 UTF-8로 안전하게 들어갑니다.
    assert.deepEqual(readZip(buildZip([{ name: '한글/프레임01.png', data: Buffer.from('내용') }])).map(entry => entry.name), ['한글/프레임01.png']);
    assert.throws(() => buildZip([]), /파일 수/);
  } finally { f.cleanup(); }
});

test('삭제: 선택 삭제와 전체 삭제는 목록과 서버 파일을 함께 지웁니다', () => {
  const f = setup();
  try {
    const ids = [1, 2, 3].map(frame => f.captures.save('roomA', f.meta('evDel', frame), png()).id);
    const row = f.captures.file('roomA', ids[0]).row, firstPath = join(f.dir, ...row.path.split('/'));
    assert.ok(existsSync(firstPath));
    assert.equal(f.captures.remove('roomA', [ids[0], 'nothing', ids[0]]), 1);
    assert.ok(!existsSync(firstPath));
    assert.equal(f.captures.usage('roomA').count, 2);
    assert.equal(f.captures.remove('roomA', null), 2);
    assert.deepEqual(f.captures.usage('roomA'), { count: 0, bytes: 0 });
    assert.deepEqual(f.captures.files('roomA'), []);
    // 파일이 이미 사라졌어도 목록 정리는 됩니다.
    const lone = f.captures.save('roomA', f.meta('evGone', 1), png());
    rmSync(join(f.dir, ...f.captures.file('roomA', lone.id).row.path.split('/')));
    assert.throws(() => f.captures.file('roomA', lone.id), error => error.status === 404);
    assert.equal(f.captures.remove('roomA', [lone.id]), 1);
  } finally { f.cleanup(); }
});

test('보관 한도: 오래되었거나 개수·용량이 넘치면 오래된 것부터 지웁니다', () => {
  const f = setup({ maxFiles: 50 });
  try {
    f.captures.maxFiles = 3;
    for (let i = 0; i < 5; i++) { f.captures.save('roomA', f.meta('ev' + i, 1, { time: NOW - 5000 + i * 100 }), png(110, 110)); }
    assert.deepEqual(f.captures.files('roomA').map(file => file.eventId), ['ev4', 'ev3', 'ev2'], '개수 한도 3장: 가장 오래된 것부터 삭제');
    // 보관 기간
    f.captures.maxFiles = 1000; f.captures.retentionDays = 30;
    f.advance(31 * 86400000);
    f.captures.save('roomA', f.meta('fresh', 1, { time: NOW + 31 * 86400000 - 1000 }), png(110, 110));
    assert.deepEqual(f.captures.files('roomA').map(file => file.eventId), ['fresh'], '30일이 지난 것은 삭제');
    // 용량 한도
    const size = png(110, 110).length;
    f.captures.maxBytes = size * 2 + 10;
    for (let i = 0; i < 4; i++) f.captures.save('roomA', f.meta('big' + i, 1, { time: NOW + 31 * 86400000 - 500 + i }), png(110, 110));
    assert.ok(f.captures.usage('roomA').bytes <= f.captures.maxBytes + size, '용량 한도를 거의 넘지 않음');
    assert.ok(f.captures.files('roomA').length <= 3);
  } finally { f.cleanup(); }
});
