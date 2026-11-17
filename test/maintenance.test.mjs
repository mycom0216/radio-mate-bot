import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
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
