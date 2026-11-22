import test from 'node:test';import assert from 'node:assert/strict';import {MobileLink} from '../mobile-link.mjs';

test('mobile login codes are single-use, expiring, hashed and invalidated on reissue',()=>{
 let now=1000;const auth=new MobileLink({now:()=>now});const first=auth.issue('DJ A');assert.match(first.code,/^M-[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/);
 assert.equal(auth.preview(first.code).room,'DJ A');assert.ok(!JSON.stringify([...auth.codes]).includes(first.code));
 const next=auth.issue('DJ A');assert.throws(()=>auth.redeem(first.code),/만료/);assert.equal(auth.redeem(next.code.toLowerCase()),'DJ A');assert.throws(()=>auth.redeem(next.code),/만료/);
 const expired=auth.issue('DJ B');now=expired.expiresAt;assert.throws(()=>auth.redeem(expired.code),/만료/);assert.throws(()=>auth.redeem('ABCDE-FGHJK'),/봇 호출 코드/);
});
test('only still-authorized DJs can issue or redeem mobile logins and revocation is immediate',()=>{
 const enabled=new Set(['DJ A']),auth=new MobileLink({authorized:id=>enabled.has(id)});assert.throws(()=>auth.issue('DJ B'),/먼저 연결/);
 const code=auth.issue('DJ A');enabled.delete('DJ A');assert.throws(()=>auth.redeem(code.code),/만료/);
 enabled.add('DJ A');const next=auth.issue('DJ A');auth.revoke('DJ A');assert.throws(()=>auth.preview(next.code),/만료/);
});
