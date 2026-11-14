import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {Operations} from './operations';
import {installStudentAddDrop} from './studentAddDrop';

test('incomplete section setup is visible but blocked until completed',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hiau-section-readiness-'));
 const store=new Operations(directory);
 const admin={id:crypto.randomUUID(),email:'admin@example.test',name:'Admin',role:'super_admin',title:''} as any;
 const lecturer={id:crypto.randomUUID(),email:'faculty@example.test',name:'Faculty',role:'lecturer',title:'',department:''};
 const studentUser={id:crypto.randomUUID(),email:'student@example.test',name:'Student',role:'student',title:'',department:''};
 store.saveUsers([admin,lecturer,studentUser]);

 const program=store.execute(admin,'program',{code:'READY',title:'Readiness Program',requiredCredits:120});
 const term=store.execute(admin,'term',{code:'READY-2026',title:'Readiness Term',startDate:'2026-11-01',endDate:'2027-03-31',status:'open',maxCredits:18});
 const course=store.execute(admin,'course',{code:'READY-101',title:'Readiness Course',credits:3,feePerCredit:'100.00',programId:program.id,prerequisites:[]});
 const sectionId=crypto.randomUUID(),stamp=new Date().toISOString();
 store.run(`INSERT INTO sections(id,course_id,term_id,lecturer_id,code,capacity,delivery_mode,location,classroom,online_classroom,schedule,created_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
  sectionId,course.id,term.id,lecturer.id,'A',20,'hybrid','Main Campus','Room 201','','Mon/Wed 10:00–11:30',stamp);

 const applicationId=crypto.randomUUID(),studentId=crypto.randomUUID();
 store.run("INSERT INTO applications(id,number,full_name,email,phone,program_id,status,decision_note,created_at,updated_at) VALUES(?,?,?,?,?,?,'admitted','test',?,?)",
  applicationId,'APP-READY','Student','student@example.test','',program.id,stamp,stamp);
 store.run("INSERT INTO students(id,user_id,application_id,student_number,full_name,email,program_id,admitted_term_id,status,financial_hold,created_at) VALUES(?,?,?,?,?,?,?,?, 'active',0,?)",
  studentId,studentUser.id,applicationId,'STU-READY','Student','student@example.test',program.id,term.id,stamp);

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
  let listed=data.sections.find((row:any)=>row.id===sectionId);
  assert.equal(listed.setup_complete,0);
  assert.match(listed.setup_issue,/online classroom/i);

  response=await fetch(base+'/api/student/add-drop/cart',{
   method:'PUT',headers:{'content-type':'application/json'},
   body:JSON.stringify({termId:term.id,addSectionIds:[sectionId],dropRegistrationIds:[],reason:''}),
  });
  assert.equal(response.status,409);
  let error:any=await response.json();
  assert.match(error.error,/setup is incomplete/i);

  store.run("UPDATE sections SET online_classroom='HIAU LMS / READY-101' WHERE id=?",sectionId);

  response=await fetch(base+'/api/student/add-drop');
  data=await response.json();
  listed=data.sections.find((row:any)=>row.id===sectionId);
  assert.equal(listed.setup_complete,1);
  assert.equal(listed.setup_issue,'');

  response=await fetch(base+'/api/student/add-drop/cart',{
   method:'PUT',headers:{'content-type':'application/json'},
   body:JSON.stringify({termId:term.id,addSectionIds:[sectionId],dropRegistrationIds:[],reason:''}),
  });
  assert.equal(response.status,200);
 }finally{
  server.closeAllConnections();
  await new Promise<void>((resolve,reject)=>server.close(error=>error&&(error as NodeJS.ErrnoException).code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve()));
  store.close();fs.rmSync(directory,{recursive:true,force:true});
 }
});
