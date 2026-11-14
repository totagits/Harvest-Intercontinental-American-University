import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Add/Drop UI clearly distinguishes cart state from submitted request state',()=>{
 const board=readFileSync(new URL('../src/components/portal/StudentCourseBoard.tsx',import.meta.url),'utf8');
 const flow=readFileSync(new URL('../src/components/portal/StudentAddDropWorkflow.tsx',import.meta.url),'utf8');

 assert.match(board,/Cart only — not yet submitted to Registrar/);
 assert.match(board,/Review & submit Add\/Drop request/);
 assert.match(flow,/still only in the Add\/Drop cart/);
 assert.match(flow,/Submit Add\/Drop request to Registrar/);
 assert.match(flow,/No request has been submitted yet/);
});
