import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('integrated Finance UI exposes audited invoice and assistance-credit posting controls',()=>{
 const handoff=readFileSync(new URL('../src/components/portal/FinanceRegistrationHandoff.tsx',import.meta.url),'utf8');
 const assistance=readFileSync(new URL('../src/components/portal/StudentAssistanceRequests.tsx',import.meta.url),'utf8');
 const server=readFileSync(new URL('./studentAssistance.ts',import.meta.url),'utf8');

 assert.match(handoff,/Post verified tuition invoice/);
 assert.match(handoff,/action:'invoice'/);
 assert.match(handoff,/x-csrf-token/);
 assert.match(handoff,/studentId:quote\.studentId/);
 assert.match(handoff,/termId:quote\.termId/);

 assert.match(assistance,/Complete independent Finance review/);
 assert.match(assistance,/Independent Finance review required/);
 assert.match(assistance,/Post assistance credit/);
 assert.match(assistance,/x-csrf-token/);
 assert.match(server,/ASSISTANCE_AWARD_POSTED/);
 assert.match(server,/student_assistance_awards/);
 assert.match(server,/item\.registrar_id===actor\.id&&stage==='finance'/);
});
