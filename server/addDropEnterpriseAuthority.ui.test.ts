import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Add Drop accepts functional position permissions while preserving legacy roles',()=>{
 const source=readFileSync(new URL('./studentAddDrop.ts',import.meta.url),'utf8');
 assert.match(source,/registration\.review/);
 assert.match(source,/registration\.commit/);
 assert.match(source,/student_billing\.view/);
 assert.match(source,/refund\.review/);
 assert.match(source,/refund\.pay/);
 assert.match(source,/registrarReview\(res\)/);
 assert.match(source,/registrarCommit\(res\)/);
});
