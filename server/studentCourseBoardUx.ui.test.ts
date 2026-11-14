import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('student Add/Drop UX separates University Course Board from My Courses',()=>{
 const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
 const board=readFileSync(new URL('../src/components/portal/StudentCourseBoard.tsx',import.meta.url),'utf8');
 const cart=readFileSync(new URL('../src/components/portal/StudentAddDropWorkflow.tsx',import.meta.url),'utf8');
 const server=readFileSync(new URL('./studentAddDrop.ts',import.meta.url),'utf8');

 assert.match(app,/currentUser\.role === 'student'[\s\S]*StudentCourseBoard/);
 assert.match(app,/onOpenStudentWorkspace=\{\(\) => setActivePortalTab\('student_portal'\)\}/);
 assert.match(app,/mode="student" onOpenCourseBoard=\{\(\) => setActivePortalTab\('academics'\)\}/);

 assert.match(board,/University Course Board/);
 assert.match(board,/Add to Add\/Drop Cart/);
 assert.match(board,/Review & submit Add\/Drop request/);
 assert.match(board,/university-wide/);
 assert.doesNotMatch(board,/registerCourse\(/);
 assert.doesNotMatch(board,/dropCourse\(/);

 assert.match(cart,/My Add\/Drop Cart/);
 assert.match(cart,/Add from Course Board/);
 assert.match(cart,/Drop from My Courses/);
 assert.match(cart,/Browse Course Board/);
 assert.doesNotMatch(cart,/Add available course/);

 assert.match(server,/student_add_drop_carts/);
 assert.match(server,/ADD_DROP_CART_UPDATED/);
 assert.match(server,/DELETE FROM student_add_drop_carts WHERE student_id=\? AND term_id=\?/);
});
