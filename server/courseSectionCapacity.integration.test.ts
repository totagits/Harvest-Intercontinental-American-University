import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Operations,WorkflowError} from './operations';

test('Registrar can set section capacity but cannot reduce it below current enrollment',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hiau-capacity-'));
 const store=new Operations(directory);
 const admin={id:crypto.randomUUID(),email:'admin@example.test',name:'Admin',role:'super_admin',title:''} as any;
 const lecturerId=crypto.randomUUID(),studentUserId=crypto.randomUUID(),studentUserId2=crypto.randomUUID();
 store.saveUsers([
  admin,
  {id:lecturerId,email:'lecturer@example.test',name:'Lecturer',role:'lecturer',title:'',department:''},
  {id:studentUserId,email:'student@example.test',name:'Student One',role:'student',title:'',department:''},
  {id:studentUserId2,email:'student2@example.test',name:'Student Two',role:'student',title:'',department:''},
 ]);
 const program=store.execute(admin,'program',{code:'TST',title:'Test Program',requiredCredits:120});
 const term=store.execute(admin,'term',{code:'T-1',title:'Test Term',startDate:'2026-11-01',endDate:'2027-03-01',status:'open',maxCredits:18});
 const course=store.execute(admin,'course',{code:'TST-101',title:'Test Course',credits:3,feePerCredit:'100.00',programId:program.id,prerequisites:[]});
 const section=store.execute(admin,'section',{courseId:course.id,termId:term.id,lecturerId,code:'A',capacity:20,location:'Room 1',schedule:'Mon 09:00'});
 assert.equal(section.capacity,20);

 const applicationId=crypto.randomUUID(),studentId=crypto.randomUUID(),registrationId=crypto.randomUUID();
 const applicationId2=crypto.randomUUID(),studentId2=crypto.randomUUID(),registrationId2=crypto.randomUUID(),stamp=new Date().toISOString();
 store.run("INSERT INTO applications(id,number,full_name,email,phone,program_id,status,decision_note,created_at,updated_at) VALUES(?,?,?,?,?,?,'admitted','test',?,?)",
  applicationId,'APP-TST-1','Student One','student@example.test','',program.id,stamp,stamp);
 store.run("INSERT INTO applications(id,number,full_name,email,phone,program_id,status,decision_note,created_at,updated_at) VALUES(?,?,?,?,?,?,'admitted','test',?,?)",
  applicationId2,'APP-TST-2','Student Two','student2@example.test','',program.id,stamp,stamp);
 store.run("INSERT INTO students(id,user_id,application_id,student_number,full_name,email,program_id,admitted_term_id,status,financial_hold,created_at) VALUES(?,?,?,?,?,?,?,?, 'active',0,?)",
  studentId,studentUserId,applicationId,'STU-TST-1','Student One','student@example.test',program.id,term.id,stamp);
 store.run("INSERT INTO students(id,user_id,application_id,student_number,full_name,email,program_id,admitted_term_id,status,financial_hold,created_at) VALUES(?,?,?,?,?,?,?,?, 'active',0,?)",
  studentId2,studentUserId2,applicationId2,'STU-TST-2','Student Two','student2@example.test',program.id,term.id,stamp);
 store.run("INSERT INTO registrations(id,student_id,section_id,status,created_at,updated_at) VALUES(?,?,?,'enrolled',?,?)",
  registrationId,studentId,section.id,stamp,stamp);
 store.run("INSERT INTO registrations(id,student_id,section_id,status,created_at,updated_at) VALUES(?,?,?,'enrolled',?,?)",
  registrationId2,studentId2,section.id,stamp,stamp);

 assert.throws(
  ()=>store.execute(admin,'sectionCapacity',{id:section.id,capacity:1}),
  (error:any)=>error instanceof WorkflowError&&/current enrollment of 2/.test(error.message)
 );
 const updated=store.execute(admin,'sectionCapacity',{id:section.id,capacity:25});
 assert.equal(updated.capacity,25);
 assert.equal(updated.enrolled,2);

 store.close();fs.rmSync(directory,{recursive:true,force:true});
});
