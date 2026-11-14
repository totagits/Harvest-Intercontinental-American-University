import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Operations,WorkflowError} from './operations';

test('course sections enforce Classroom, Online and Hybrid delivery requirements',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hiau-delivery-mode-'));
 const store=new Operations(directory);
 const admin={id:crypto.randomUUID(),email:'admin@example.test',name:'Admin',role:'super_admin',title:''} as any;
 const lecturer={id:crypto.randomUUID(),email:'faculty@example.test',name:'Faculty',role:'lecturer',title:'',department:''};
 store.saveUsers([admin,lecturer]);
 const program=store.execute(admin,'program',{code:'MODE',title:'Delivery Mode Program',requiredCredits:120});
 const term=store.execute(admin,'term',{code:'MODE-2026',title:'Delivery Mode Term',startDate:'2026-11-01',endDate:'2027-03-01',status:'open',maxCredits:18});
 const course=store.execute(admin,'course',{code:'MODE-101',title:'Delivery Mode Course',credits:3,feePerCredit:'100.00',programId:program.id,prerequisites:[]});

 assert.throws(
  ()=>store.execute(admin,'section',{courseId:course.id,termId:term.id,lecturerId:lecturer.id,code:'A',capacity:20,deliveryMode:'classroom',location:'Main Campus',schedule:'Mon 09:00'}),
  (error:any)=>error instanceof WorkflowError&&/Classroom \/ room is required/i.test(error.message)
 );

 const classroom=store.execute(admin,'section',{
  courseId:course.id,termId:term.id,lecturerId:lecturer.id,code:'A',capacity:20,
  deliveryMode:'classroom',location:'Main Campus',classroom:'Room 201',
  onlineClassroom:'should be cleared',schedule:'Mon 09:00'
 });
 assert.equal(classroom.delivery_mode,'classroom');
 assert.equal(classroom.location,'Main Campus');
 assert.equal(classroom.classroom,'Room 201');
 assert.equal(classroom.online_classroom,'');

 assert.throws(
  ()=>store.execute(admin,'section',{courseId:course.id,termId:term.id,lecturerId:lecturer.id,code:'B',capacity:20,deliveryMode:'online',schedule:'Tue 10:00'}),
  (error:any)=>error instanceof WorkflowError&&/Online classroom \/ LMS reference is required/i.test(error.message)
 );

 const online=store.execute(admin,'section',{
  courseId:course.id,termId:term.id,lecturerId:lecturer.id,code:'B',capacity:20,
  deliveryMode:'online',location:'Should disappear',classroom:'Should disappear',
  onlineClassroom:'HIAU LMS / MODE-101-B',schedule:'Tue 10:00'
 });
 assert.equal(online.delivery_mode,'online');
 assert.equal(online.location,'');
 assert.equal(online.classroom,'');
 assert.equal(online.online_classroom,'HIAU LMS / MODE-101-B');

 const hybrid=store.execute(admin,'section',{
  courseId:course.id,termId:term.id,lecturerId:lecturer.id,code:'C',capacity:20,
  deliveryMode:'hybrid',location:'Main Campus',classroom:'Lab 3',
  onlineClassroom:'HIAU LMS / MODE-101-C',schedule:'Wed 11:00'
 });
 assert.equal(hybrid.delivery_mode,'hybrid');

 const switched=store.execute(admin,'sectionSettings',{
  id:classroom.id,capacity:20,deliveryMode:'online',location:'Main Campus',
  classroom:'Room 201',onlineClassroom:'HIAU LMS / MODE-101-A'
 });
 assert.equal(switched.delivery_mode,'online');
 assert.equal(switched.location,'');
 assert.equal(switched.classroom,'');
 assert.equal(switched.online_classroom,'HIAU LMS / MODE-101-A');

 store.close();fs.rmSync(directory,{recursive:true,force:true});
});
