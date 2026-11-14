import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Finance Add/Drop summary labels posted tuition correctly after billing',()=>{
 const flow=readFileSync(new URL('../src/components/portal/StudentAddDropWorkflow.tsx',import.meta.url),'utf8');
 assert.match(flow,/Added unbilled estimate/);
 assert.match(flow,/Added tuition posted/);
 assert.match(flow,/item\.unbilledRegistrations\?\.length/);
});
