import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('installed Student and Staff apps revalidate the server session when a stale tab regains focus',()=>{
  const source=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  assert.match(source,/window\.addEventListener\('focus'/);
  assert.match(source,/document\.addEventListener\('visibilitychange'/);
  assert.match(source,/fetch\('\/api\/auth\/me'/);
  assert.match(source,/appKind !== null && !canUseInstalledApp\(session\.user\.role\)/);
  assert.match(source,/setIsLoginModalOpen\(true\)/);
});
