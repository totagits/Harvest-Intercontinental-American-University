import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {Operations} from './operations';
import {installStudentAddDrop} from './studentAddDrop';

test('Course Board hides online classroom reference until the student is enrolled',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hiau-online-access-'));
 const store=new Operations(directory);
 const admin={id:crypto.randomUUID(),email:'admin@example.test',name:'Admin',role:'super_admin',title:''} as any;
 const lecturer={id:crypto.randomUUID(),email:'faculty@example.test',name:'Faculty',role:'lecturer',title:'',department:''};
 const studentUser={id:crypto.randomUUID(),email:'student@example.test',name:'Student',role:'student',title:'',department:''};
 store.saveUsers([admin,lecturer,studentUser]);
 const program=store.execute(admin,'program',{code:'SEC',title:'Security Program',requiredCredits:120});
 const term=store.execute(admin,'term',{code:'SEC-2026',title:'Security Term',startDate:'2026-11-01',endDate:'2027-03-01',status:'open',maxCredits:18});
 const course=store.execute(admin,'course',{code:'SEC-101',title:'Secure Online Course',credits:3,feePerCredit:'100.00',programId:program.id,prerequisites:[]});
 const section=store.execute(admin,'section',{
  courseId:course.id,termId:term.id,lecturerId:lecturer.id,code:'A',capacity:20,
  deliveryMode:'online',onlineClassroom:'https://private.example.test/meeting/secret',schedule:'Tue 10:00'
 });
 const stamp=new Date().toISOString(),applicationId=crypto.randomUUID(),studentId=crypto.randomUUID();
 store.run("INSERT INTO applications(id,number,full_name,email,phone,program_id,status,decision_note,created_at,updated_at) VALUES(?,?,?,?,?,?,'admitted','test',?,?)",
  applicationId,'APP-SEC','Student','student@example.test','',program.id,stamp,stamp);
 store.run("INSERT INTO students(id,user_id,application_id,student_number,full_name,email,program_id,admitted_term_id,status,financial_hold,created_at) VALUES(?,?,?,?,?,?,?,?, 'active',0,?)",
  studentId,studentUser.id,applicationId,'STU-SEC','Student','student@example.test',program.id,term.id,stamp);

 const app=express();app.use(express.json());
 app.use((_req,res,next)=>{res.locals.actor=studentUser;next();});
 installStudentAddDrop(app,store);
 const server=app.listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));
 const addr=server.address();if(!addr||typeof addr==='string')throw Error('No test server');
 const base='http://127.0.0.1:'+addr.port;
 try{
  let response=await fetch(base+'/api/student/add-drop');
  assert.equal(response.status,200);
  let data:any=await response.json();
  let listed=data.sections.find((row:any)=>row.id===section.id);
  assert.equal(listed.delivery_mode,'online');
  assert.equal(listed.has_online_classroom,1);
  assert.equal(listed.online_classroom,'');

  store.run("INSERT INTO registrations(id,student_id,section_id,status,created_at,updated_at) VALUES(?,?,?,'enrolled',?,?)",
   crypto.randomUUID(),studentId,section.id,stamp,stamp);

  response=await fetch(base+'/api/student/add-drop');
  data=await response.json();
  listed=data.sections.find((row:any)=>row.id===section.id);
  assert.equal(listed.online_classroom,'https://private.example.test/meeting/secret');
  assert.equal(data.registrations[0].online_classroom,'https://private.example.test/meeting/secret');
 }finally{
  server.closeAllConnections();
  await new Promise<void>((resolve,reject)=>server.close(error=>error&&(error as NodeJS.ErrnoException).code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve()));
  store.close();fs.rmSync(directory,{recursive:true,force:true});
 }
});
