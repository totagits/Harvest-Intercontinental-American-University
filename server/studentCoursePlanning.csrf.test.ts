import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Student course planning POST actions use authenticated CSRF token',()=>{
  const ui=readFileSync(new URL('../src/components/portal/StudentCoursePlanning.tsx',import.meta.url),'utf8');
  assert.match(ui,/\/api\/auth\/me/);
  assert.match(ui,/x-csrf-token/);
  assert.match(ui,/Session verification unavailable/);
  assert.match(ui,/\/api\/student\/course-plans/);
});
