import test from 'node:test';
import assert from 'node:assert/strict';
import {oauthCookieName,oauthCookieMatches,oauthProviderError,oauthFailurePage} from '../oauth-flow.mjs';

test('parallel browser OAuth attempts retain distinct state cookies and reject absent or substituted state',()=>{
 const a='a'.repeat(64),b='b'.repeat(64),header=oauthCookieName(a)+'='+a+'; '+oauthCookieName(b)+'='+b;
 assert.notEqual(oauthCookieName(a),oauthCookieName(b));assert.equal(oauthCookieMatches(header,a),true);assert.equal(oauthCookieMatches(header,b),true);
 assert.equal(oauthCookieMatches(oauthCookieName(a)+'='+b,a),false);assert.equal(oauthCookieMatches('',a),false);assert.equal(oauthCookieMatches(header,'bad'),false);
});
test('OAuth failure messages distinguish provider permission errors and escape recovery page content',()=>{
 assert.equal(oauthProviderError('invalid_scope').oauthReason,'invalid-scope');assert.match(oauthProviderError('invalid_scope').message,/권한/);
 assert.equal(oauthProviderError('access_denied').oauthReason,'access-denied');
 const html=oauthFailurePage('<script>bad()</script>');assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);assert.match(html,/DJ 연결 다시 시작/);
});
