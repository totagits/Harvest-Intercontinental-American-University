import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Student Workspace exposes staging-only MICHAEL self-link action with CSRF protection',()=>{
  const ui=readFileSync(new URL('../src/components/portal/SecureStudentWorkspace.tsx',import.meta.url),'utf8');
  const api=readFileSync(new URL('./workspaces.ts',import.meta.url),'utf8');
  assert.match(ui,/hiau-staging\.totag\.network/);
  assert.match(ui,/MICHAEL\\s\+GWOAH/);
  assert.match(ui,/Complete staging test student link/);
  assert.match(ui,/\/api\/workspaces\/staging-student-self-link/);
  assert.match(ui,/x-csrf-token/);
  assert.match(api,/staging-student-self-link/);
  assert.match(api,/requestHost!=='hiau-staging\.totag\.network'/);
  assert.match(api,/actor\.role!=='student'/);
  assert.match(api,/accountId:actor\.id/);
});
