import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('staff and students see dedicated classroom information for course sections',()=>{
 const admin=readFileSync(new URL('../src/components/portal/CourseSectionManagement.tsx',import.meta.url),'utf8');
 const board=readFileSync(new URL('../src/components/portal/StudentCourseBoard.tsx',import.meta.url),'utf8');
 const cart=readFileSync(new URL('../src/components/portal/StudentAddDropWorkflow.tsx',import.meta.url),'utf8');
 const operations=readFileSync(new URL('./operations.ts',import.meta.url),'utf8');

 assert.match(admin,/Classroom \/ room/);
 assert.match(admin,/Classroom \/ Room/);
 assert.match(admin,/sectionSettings/);
 assert.match(admin,/Save changes/);
 assert.match(board,/Classroom TBA/);
 assert.match(board,/section\.classroom/);
 assert.match(cart,/Classroom TBA/);
 assert.match(operations,/ALTER TABLE sections ADD COLUMN classroom/);
 assert.match(operations,/action === 'sectionSettings'/);
});
