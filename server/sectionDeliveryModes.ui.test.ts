import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('section management and Course Board distinguish Classroom, Online and Hybrid delivery',()=>{
 const admin=readFileSync(new URL('../src/components/portal/CourseSectionManagement.tsx',import.meta.url),'utf8');
 const board=readFileSync(new URL('../src/components/portal/StudentCourseBoard.tsx',import.meta.url),'utf8');
 const cart=readFileSync(new URL('../src/components/portal/StudentAddDropWorkflow.tsx',import.meta.url),'utf8');
 const operations=readFileSync(new URL('./operations.ts',import.meta.url),'utf8');
 const delivery=readFileSync(new URL('./sectionDelivery.ts',import.meta.url),'utf8');
 const server=readFileSync(new URL('./studentAddDrop.ts',import.meta.url),'utf8');

 assert.match(admin,/Delivery mode/);
 assert.match(admin,/<option value="classroom">Classroom<\/option>/);
 assert.match(admin,/<option value="online">Online<\/option>/);
 assert.match(admin,/<option value="hybrid">Hybrid<\/option>/);
 assert.match(admin,/Online classroom \/ LMS reference/);
 assert.match(admin,/Campus \/ location/);

 assert.match(board,/mode==='online'/);
 assert.match(board,/modeLabel=mode==='classroom'\?'Classroom':mode==='online'\?'Online':'Hybrid'/);
 assert.match(board,/Online access available after enrollment/);
 assert.match(board,/Section setup incomplete/);
 assert.match(board,/Classroom not assigned/);
 assert.match(cart,/Online access after enrollment/);

 assert.match(operations,/delivery_mode/);
 assert.match(operations,/online_classroom/);
 assert.match(operations,/sectionSetupIssue/);
 assert.match(delivery,/Campus \/ location and classroom \/ room are required/);
 assert.match(delivery,/Online classroom \/ LMS reference is required/);
 assert.match(delivery,/Hybrid setup incomplete/);

 assert.match(server,/has_online_classroom/);
 assert.match(server,/THEN s\.online_classroom ELSE '' END AS online_classroom/);
});
