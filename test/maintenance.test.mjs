import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../core.mjs';

test('prune trims old audit rows, events and extra backups; snapshot keeps rolling copies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-'));
  try {
    const s = new Store(join(dir, 'db.sqlite'));
    s.create('r', 'room');
    const now = Date.now();
    s.log('r', 'u', 'old', {}, now - 200 * 86400000);
    s.log('r', 'u', 'new', {}, now);
    for (let i = 0; i < 5; i++) s.db.prepare('INSERT INTO events VALUES(?,?,?)').run('r', 'e' + i, '{}');
    for (let i = 0; i < 5; i++) s.backup('r');
    s.prune({ eventsKeep: 2, auditDays: 90, backupsKeep: 3 }, now);
    assert.equal(s.logs('r').length, 1);
    assert.equal(s.db.prepare('SELECT COUNT(*) c FROM events').get().c, 2);
    assert.equal(s.db.prepare('SELECT COUNT(*) c FROM backups').get().c, 3);
    for (let d = 0; d < 10; d++) s.snapshot(join(dir, 'bk'), { keep: 7, now: now + d * 86400000 });
    assert.equal(readdirSync(join(dir, 'bk')).length, 7);
    s.db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('failed snapshot keeps the previous backup, repeated snapshots replace safely, invalid retention cannot erase data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-safe-'));
  const s = new Store(join(dir, 'db.sqlite'));
  try {
    s.create('r', 'first');
    const now = Date.now(), bk = join(dir, 'bk');
    const file = s.snapshot(bk, { now });
    const before = readFileSync(file);
    const exec = s.db.exec.bind(s.db);
    s.db.exec = sql => { if (sql.startsWith('VACUUM INTO')) throw Error('disk full'); return exec(sql); };
    assert.throws(() => s.snapshot(bk, { now }), /disk full/);
    assert.deepEqual(readFileSync(file), before);
    assert.deepEqual(readdirSync(bk), [file.split(/[\\/]/).pop()]);
    s.db.exec = exec;
    s.transaction('r', r => { r.name = 'updated'; });
    s.snapshot(bk, { now });
    const restored = new Store(file);
    try { assert.equal(restored.load('r').name, 'updated'); } finally { restored.db.close(); }
    assert.throws(() => s.snapshot(bk, { keep: 0 }), /보관/);
    s.log('r', 'u', 'saved', {});
    assert.throws(() => s.prune({ eventsKeep: -1 }), /보관/);
    assert.equal(s.logs('r').length, 1);
  } finally { s.db.close(); rmSync(dir, { recursive: true, force: true }); }
});
