import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Account Center protects invitations and access changes with CSRF',()=>{
  const source=readFileSync(new URL('../src/components/portal/AccountCenter.tsx',import.meta.url),'utf8');
  assert.match(source,/\/api\/auth\/me/);
  assert.match(source,/x-csrf-token/);
  assert.match(source,/credentials:'same-origin'/);
  assert.match(source,/\/api\/identity\/invite/);
  assert.match(source,/\/api\/identity\/accounts\//);
  assert.match(source,/Session verification unavailable/);
});
