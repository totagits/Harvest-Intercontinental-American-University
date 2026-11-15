import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Staff and Student PWA authentication cannot fall through to the SPA HTML shell',()=>{
  const login=readFileSync(new URL('../src/components/portal/PortalLoginModal.tsx',import.meta.url),'utf8');
  const server=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
  assert.match(login,/new URL\(authPath,window\.location\.origin\)/);
  assert.match(login,/credentials:'same-origin'/);
  assert.match(login,/cache:'no-store'/);
  assert.match(login,/Accept':'application\/json'/);
  assert.match(login,/authentication service returned an invalid response/);
  assert.match(server,/staff\|student/);
  assert.match(server,/api\\\/auth/);
  assert.match(server,/req\.url=req\.url\.replace/);
});
