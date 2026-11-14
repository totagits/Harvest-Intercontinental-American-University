import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Add/Drop reason validation explains why submit is disabled',()=>{
 const flow=readFileSync(new URL('../src/components/portal/StudentAddDropWorkflow.tsx',import.meta.url),'utf8');
 assert.match(flow,/more character/);
 assert.match(flow,/Reason requirement satisfied/);
 assert.match(flow,/Enter at least 20 characters/);
 assert.match(flow,/reason\.trim\(\)\.length<20/);
});
