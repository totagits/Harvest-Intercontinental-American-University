import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('student academic activity includes submitted Add/Drop requests',()=>{
 const api=readFileSync(new URL('./workspaces.ts',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../src/components/portal/StudentActivityTimeline.tsx',import.meta.url),'utf8');
 assert.match(api,/ADD_DROP_SUBMITTED/);
 assert.match(ui,/ADD_DROP_SUBMITTED/);
 assert.match(ui,/Submitted an Add\/Drop request to the Registrar/);
});
