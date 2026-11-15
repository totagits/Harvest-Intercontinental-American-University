import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Registrar Add/Drop review shows estimated drop tuition credit and refund percentage',()=>{
 const api=readFileSync(new URL('./studentAddDrop.ts',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../src/components/portal/StudentAddDropWorkflow.tsx',import.meta.url),'utf8');
 assert.match(api,/estimatedDropCreditCents/);
 assert.match(api,/refundPercent:check\.refundPercent/);
 assert.match(ui,/Drop tuition credit estimate/);
 assert.match(ui,/% within Add\/Drop window/);
});
