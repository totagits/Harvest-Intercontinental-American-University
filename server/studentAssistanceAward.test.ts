import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {Operations} from './operations';
import {installStudentAssistance} from './studentAssistance';

test('finance-reviewed assistance posts one audited invoice credit and reduces balances',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hiau-assistance-award-'));
 const store=new Operations(directory);
 const adminId=crypto.randomUUID(),studentUserId=crypto.randomUUID();
 const programId=crypto.randomUUID(),termId=crypto.randomUUID(),courseId=crypto.randomUUID(),sectionId=crypto.randomUUID();
 const applicationId=crypto.randomUUID(),studentId=crypto.randomUUID(),registrationId=crypto.randomUUID(),invoiceId=crypto.randomUUID(),requestId=crypto.randomUUID();
 const stamp=new Date().toISOString();
 store.saveUsers([
  {id:adminId,name:'Finance Administrator',email:'finance@hiau.example',role:'super_admin',title:'',department:''},
  {id:studentUserId,name:'MICHAEL GWOAH',email:'michael.staging@example.com',role:'student',title:'',department:''},
 ]);
 store.run('INSERT INTO programs(id,code,title,required_credits,created_at) VALUES(?,?,?,?,?)',programId,'STG','Staging',120,stamp);
 store.run('INSERT INTO terms(id,code,title,start_date,end_date,status,max_credits,created_at) VALUES(?,?,?,?,?,?,?,?)',termId,'T1','Term','2026-11-01','2027-03-31','open',18,stamp);
 store.run('INSERT INTO courses(id,code,title,credits,fee_cents,created_at) VALUES(?,?,?,?,?,?)',courseId,'STG-101','Course',3,15000,stamp);
 store.run('INSERT INTO sections(id,course_id,term_id,lecturer_id,code,capacity,location,schedule,created_at) VALUES(?,?,?,?,?,?,?,?,?)',sectionId,courseId,termId,adminId,'A',30,'Hybrid','TBA',stamp);
 store.run("INSERT INTO applications(id,number,full_name,email,phone,program_id,status,decision_note,created_at,updated_at) VALUES(?,?,?,?,?,?,'admitted','STAGING TEST',?,?)",
  applicationId,'APP-STG','MICHAEL GWOAH','michael.staging@example.com','',programId,stamp,stamp);
 store.run("INSERT INTO students(id,user_id,application_id,student_number,full_name,email,program_id,admitted_term_id,status,financial_hold,created_at) VALUES(?,?,?,?,?,?,?,?, 'active',0,?)",
  studentId,studentUserId,applicationId,'HIAU-STG-TEST','MICHAEL GWOAH','michael.staging@example.com',programId,termId,stamp);
 store.run("INSERT INTO registrations(id,student_id,section_id,status,created_at,updated_at) VALUES(?,?,?,'enrolled',?,?)",registrationId,studentId,sectionId,stamp,stamp);
 store.run('INSERT INTO invoices(id,student_id,term_id,number,amount_cents,due_date,posted_by,created_at) VALUES(?,?,?,?,?,?,?,?)',
  invoiceId,studentId,termId,'INV-STG',45000,'2026-12-15',adminId,stamp);
 store.run('INSERT INTO invoice_lines(id,invoice_id,registration_id,description,amount_cents) VALUES(?,?,?,?,?)',
  crypto.randomUUID(),invoiceId,registrationId,'STG-101 · Course',45000);
 store.run(`INSERT INTO student_assistance_requests
  (id,student_id,term_id,kind,requested_cents,reason,status,registrar_note,finance_note,registrar_id,finance_id,created_at,updated_at)
  VALUES(?,?,?,?,?,?, 'finance_reviewed',?,?,?,?,?,?)`,
  requestId,studentId,termId,'scholarship',20000,'Staging scholarship acceptance request',
  'Recommended for test','Finance review complete',crypto.randomUUID(),adminId,stamp,stamp);

 const app=express();
 app.use(express.json());
 app.use((_req,res,next)=>{res.locals.actor={id:adminId,email:'finance@hiau.example',name:'Finance Administrator',role:'super_admin',title:''};next();});
 installStudentAssistance(app,store);
 const server=app.listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));
 const addr=server.address(); if(!addr||typeof addr==='string')throw Error('No server');
 const base='http://127.0.0.1:'+addr.port;
 try{
  assert.equal(store.invoiceBalance(invoiceId),45000);
  assert.equal(store.balance(studentId),45000);
  const response=await fetch(base+'/api/student/assistance/'+requestId+'/award',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({invoiceId,amount:'200.00',note:'Approved staging scholarship credit'}),
  });
  const data:any=await response.json();
  assert.equal(response.status,201);
  assert.equal(data.award.amountCents,20000);
  assert.equal(store.invoiceBalance(invoiceId),25000);
  assert.equal(store.balance(studentId),25000);
  assert.equal(store.one('SELECT COUNT(*) AS n FROM student_assistance_awards WHERE request_id=?',requestId).n,1);
  assert.equal(store.one("SELECT COUNT(*) AS n FROM audit WHERE action='ASSISTANCE_AWARD_POSTED'").n,1);

  const duplicate=await fetch(base+'/api/student/assistance/'+requestId+'/award',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({invoiceId,amount:'1.00',note:'Duplicate staging award attempt'}),
  });
  assert.equal(duplicate.status,409);
  assert.equal(store.invoiceBalance(invoiceId),25000);
 }finally{
  server.closeAllConnections();
  await new Promise<void>((resolve,reject)=>server.close(error=>error&&
   (error as NodeJS.ErrnoException).code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve()));
  store.close();fs.rmSync(directory,{recursive:true,force:true});
 }
});
