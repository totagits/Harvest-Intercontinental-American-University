import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {Operations} from './operations';
import {installStudentAddDrop} from './studentAddDrop';

const ymd=(date:Date)=>date.toISOString().slice(0,10);

test('staging Add/Drop can add a section, bill it, then drop it with a full early-term credit',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hiau-add-drop-'));
 const store=new Operations(directory);
 const adminId=crypto.randomUUID(),studentUserId=crypto.randomUUID();
 const programId=crypto.randomUUID(),termId=crypto.randomUUID(),courseId=crypto.randomUUID(),sectionId=crypto.randomUUID();
 const applicationId=crypto.randomUUID(),studentId=crypto.randomUUID(),registrationId=crypto.randomUUID();
 const now=new Date(),stamp=now.toISOString();
 const start=new Date(now.getTime()-3*86400000),end=new Date(now.getTime()+90*86400000);
 store.saveUsers([
  {id:adminId,name:'University Administrator',email:'admin@hiau.example',role:'super_admin',title:'',department:''},
  {id:studentUserId,name:'MICHAEL GWOAH',email:'michael.staging@example.com',role:'student',title:'',department:''},
 ]);
 store.run('INSERT INTO programs(id,code,title,required_credits,created_at) VALUES(?,?,?,?,?)',programId,'STG-ACCEPT','HIAU Staging Acceptance Program',120,stamp);
 store.run('INSERT INTO terms(id,code,title,start_date,end_date,status,max_credits,created_at) VALUES(?,?,?,?,?,?,?,?)',
  termId,'STG-2026-A','Staging Acceptance Term 2026',ymd(start),ymd(end),'open',18,stamp);
 store.run('INSERT INTO courses(id,code,title,credits,fee_cents,created_at) VALUES(?,?,?,?,?,?)',
  courseId,'STG-101','University Foundations',3,15000,stamp);
 store.run('INSERT INTO program_requirements(program_id,course_id) VALUES(?,?)',programId,courseId);
 store.run("INSERT INTO sections(id,course_id,term_id,lecturer_id,code,capacity,delivery_mode,location,classroom,online_classroom,schedule,created_at) VALUES(?,?,?,?,?,?,'hybrid','HIAU Staging','Room 101','HIAU Online Classroom — STG-101','Mon/Wed 09:00–10:30',?)",
  sectionId,courseId,termId,adminId,'A',30,stamp);
 store.run("INSERT INTO applications(id,number,full_name,email,phone,program_id,status,decision_note,created_at,updated_at) VALUES(?,?,?,?,?,?,'admitted','STAGING TEST',?,?)",
  applicationId,'APP-STG','MICHAEL GWOAH','michael.staging@example.com','',programId,stamp,stamp);
 store.run("INSERT INTO students(id,user_id,application_id,student_number,full_name,email,program_id,admitted_term_id,status,financial_hold,created_at) VALUES(?,?,?,?,?,?,?,?, 'active',0,?)",
  studentId,studentUserId,applicationId,'HIAU-STG-TEST','MICHAEL GWOAH','michael.staging@example.com',programId,termId,stamp);
 store.run("INSERT INTO registrations(id,student_id,section_id,status,created_at,updated_at) VALUES(?,?,?,'enrolled',?,?)",
  registrationId,studentId,sectionId,stamp,stamp);

 let actor:any={id:studentUserId,email:'michael.staging@example.com',name:'MICHAEL GWOAH',role:'student',title:''};
 const app=express();app.use(express.json());
 app.use((_req,res,next)=>{res.locals.actor=actor;next();});
 installStudentAddDrop(app,store);
 const server=app.listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));
 const addr=server.address();if(!addr||typeof addr==='string')throw Error('No test server');
 const base='http://127.0.0.1:'+addr.port;
 try{
  const bootstrap=await fetch(base+'/api/student/add-drop',{headers:{'x-forwarded-host':'hiau-staging.totag.network'}});
  assert.equal(bootstrap.status,200);
  const stg104=store.one(`SELECT s.id,c.id AS course_id FROM sections s JOIN courses c ON c.id=s.course_id
    WHERE c.code='STG-104' AND s.term_id=?`,termId);
  assert.ok(stg104);

  const addResponse=await fetch(base+'/api/student/add-drop',{
   method:'POST',headers:{'content-type':'application/json','x-forwarded-host':'hiau-staging.totag.network'},
   body:JSON.stringify({termId,addSectionIds:[stg104.id],dropRegistrationIds:[],reason:'Add STG-104 for staging Add/Drop acceptance testing.'}),
  });
  const addRequest:any=await addResponse.json();
  assert.equal(addResponse.status,201);
  assert.equal(addRequest.status,'submitted');

  actor={id:adminId,email:'admin@hiau.example',name:'University Administrator',role:'super_admin',title:''};
  let response=await fetch(base+'/api/student/add-drop/'+addRequest.id+'/review',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({decision:'approved',note:'Approved staging addition for acceptance testing.'}),
  });
  assert.equal(response.status,200);
  response=await fetch(base+'/api/student/add-drop/'+addRequest.id+'/commit',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({confirmation:'CONFIRM_ADD_DROP'}),
  });
  const committed:any=await response.json();
  assert.equal(response.status,200);
  assert.equal(committed.addedRegistrations,1);

  const addedReg=store.one("SELECT r.* FROM registrations r WHERE r.student_id=? AND r.section_id=? AND r.status='enrolled'",studentId,stg104.id);
  assert.ok(addedReg);
  const invoiceId=crypto.randomUUID();
  store.run('INSERT INTO invoices(id,student_id,term_id,number,amount_cents,due_date,posted_by,created_at) VALUES(?,?,?,?,?,?,?,?)',
   invoiceId,studentId,termId,'INV-ADD-DROP',45000,ymd(end),adminId,stamp);
  store.run('INSERT INTO invoice_lines(id,invoice_id,registration_id,description,amount_cents) VALUES(?,?,?,?,?)',
   crypto.randomUUID(),invoiceId,addedReg.id,'STG-104 · Applied Digital Collaboration',45000);
  assert.equal(store.invoiceBalance(invoiceId),45000);

  actor={id:studentUserId,email:'michael.staging@example.com',name:'MICHAEL GWOAH',role:'student',title:''};
  const dropResponse=await fetch(base+'/api/student/add-drop',{
   method:'POST',headers:{'content-type':'application/json','x-forwarded-host':'hiau-staging.totag.network'},
   body:JSON.stringify({termId,addSectionIds:[],dropRegistrationIds:[addedReg.id],reason:'Drop STG-104 to verify the early-term tuition adjustment workflow.'}),
  });
  const dropRequest:any=await dropResponse.json();
  assert.equal(dropResponse.status,201);

  actor={id:adminId,email:'admin@hiau.example',name:'University Administrator',role:'super_admin',title:''};
  response=await fetch(base+'/api/student/add-drop/'+dropRequest.id+'/review',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({decision:'approved',note:'Approved staging drop and refund verification.'}),
  });
  assert.equal(response.status,200);
  response=await fetch(base+'/api/student/add-drop/'+dropRequest.id+'/commit',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({confirmation:'CONFIRM_ADD_DROP'}),
  });
  const dropped:any=await response.json();
  assert.equal(response.status,200);
  assert.equal(dropped.droppedRegistrations,1);
  assert.equal(dropped.refundPercent,100);
  assert.equal(dropped.droppedCreditCents,45000);
  assert.equal(store.one('SELECT status FROM registrations WHERE id=?',addedReg.id).status,'dropped');
  assert.equal(store.one('SELECT amount_cents FROM credit_notes WHERE registration_id=?',addedReg.id).amount_cents,45000);
  assert.equal(store.invoiceBalance(invoiceId),0);
 }finally{
  server.closeAllConnections();
  await new Promise<void>((resolve,reject)=>server.close(error=>error&&(error as NodeJS.ErrnoException).code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve()));
  store.close();fs.rmSync(directory,{recursive:true,force:true});
 }
});
