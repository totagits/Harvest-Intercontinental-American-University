import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Course section capacity is managed by staff and enforced on the student Course Board',()=>{
 const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
 const admin=readFileSync(new URL('../src/components/portal/CourseSectionManagement.tsx',import.meta.url),'utf8');
 const board=readFileSync(new URL('../src/components/portal/StudentCourseBoard.tsx',import.meta.url),'utf8');
 const server=readFileSync(new URL('./studentAddDrop.ts',import.meta.url),'utf8');
 const operations=readFileSync(new URL('./operations.ts',import.meta.url),'utf8');

 assert.match(app,/CourseSectionManagement currentUser=\{currentUser\}/);
 assert.match(admin,/Student limit \/ capacity/);
 assert.match(admin,/Create section/);
 assert.match(admin,/Save changes/);
 assert.match(admin,/section\.enrolled} \/ \{section\.capacity/);
 assert.match(admin,/Seats available:/);

 assert.match(board,/seats available/);
 assert.match(board,/Section full/);
 assert.match(board,/const full=seats<=0/);
 assert.match(board,/!already&&programEligible&&!full/);

 assert.match(server,/is full and cannot be added to your Add\/Drop cart/);
 assert.match(operations,/action === 'sectionSettings'/);
 assert.match(operations,/Capacity cannot be reduced below the current enrollment/);
});
