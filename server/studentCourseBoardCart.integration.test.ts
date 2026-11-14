import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {Operations} from './operations';
import {installStudentAddDrop} from './studentAddDrop';

test('Course Board cart persists across student views and clears after Add/Drop submission',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hiau-course-board-cart-'));
 const store=new Operations(directory);
 const adminId=crypto.randomUUID(),studentUserId=crypto.randomUUID();
 const programId=crypto.randomUUID(),termId=crypto.randomUUID(),courseId=crypto.randomUUID(),sectionId=crypto.randomUUID();
 const applicationId=crypto.randomUUID(),studentId=crypto.randomUUID(),registrationId=crypto.randomUUID();
 const stamp=new Date().toISOString();
 store.saveUsers([
  {id:adminId,name:'University Administrator',email:'admin@example.test',role:'super_admin',title:'',department:''},
  {id:studentUserId,name:'MICHAEL GWOAH',email:'student@example.test',role:'student',title:'',department:''},
 ]);
 store.run('INSERT INTO programs(id,code,title,required_credits,created_at) VALUES(?,?,?,?,?)',programId,'STG-ACCEPT','Staging Program',120,stamp);
 store.run('INSERT INTO terms(id,code,title,start_date,end_date,status,max_credits,created_at) VALUES(?,?,?,?,?,?,?,?)',
  termId,'STG-2026-A','Staging Acceptance Term 2026','2026-11-01','2027-03-31','open',18,stamp);
 store.run('INSERT INTO courses(id,code,title,credits,fee_cents,created_at) VALUES(?,?,?,?,?,?)',
  courseId,'STG-101','University Foundations',3,15000,stamp);
 store.run('INSERT INTO program_requirements(program_id,course_id) VALUES(?,?)',programId,courseId);
 store.run('INSERT INTO sections(id,course_id,term_id,lecturer_id,code,capacity,location,schedule,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
  sectionId,courseId,termId,adminId,'A',30,'Main','Mon 09:00',stamp);
 store.run("INSERT INTO applications(id,number,full_name,email,phone,program_id,status,decision_note,created_at,updated_at) VALUES(?,?,?,?,?,?,'admitted','test',?,?)",
  applicationId,'APP-1','MICHAEL GWOAH','student@example.test','',programId,stamp,stamp);
 store.run("INSERT INTO students(id,user_id,application_id,student_number,full_name,email,program_id,admitted_term_id,status,financial_hold,created_at) VALUES(?,?,?,?,?,?,?,?, 'active',0,?)",
  studentId,studentUserId,applicationId,'HIAU-STG-1','MICHAEL GWOAH','student@example.test',programId,termId,stamp);
 store.run("INSERT INTO registrations(id,student_id,section_id,status,created_at,updated_at) VALUES(?,?,?,'enrolled',?,?)",
  registrationId,studentId,sectionId,stamp,stamp);

 const app=express();app.use(express.json());
 app.use((_req,res,next)=>{res.locals.actor={id:studentUserId,email:'student@example.test',name:'MICHAEL GWOAH',role:'student',title:''};next();});
 installStudentAddDrop(app,store);
 const server=app.listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));
 const addr=server.address();if(!addr||typeof addr==='string')throw Error('No test server');
 const base='http://127.0.0.1:'+addr.port;
 try{
  let r=await fetch(base+'/api/student/add-drop',{headers:{host:'hiau-staging.totag.network'}});
  assert.equal(r.status,200);
  const initial:any=await r.json();
  const stg104=initial.sections.find((s:any)=>s.course_code==='STG-104');
  assert.ok(stg104,'staging Course Board section should be available');

  r=await fetch(base+'/api/student/add-drop/cart',{
   method:'PUT',headers:{'content-type':'application/json',host:'hiau-staging.totag.network'},
   body:JSON.stringify({termId,addSectionIds:[stg104.id],dropRegistrationIds:[],reason:'Course Board cart acceptance testing reason.'}),
  });
  assert.equal(r.status,200);

  r=await fetch(base+'/api/student/add-drop',{headers:{host:'hiau-staging.totag.network'}});
  const withCart:any=await r.json();
  assert.equal(withCart.carts.length,1);
  assert.deepEqual(withCart.carts[0].addSectionIds,[stg104.id]);
  assert.equal(withCart.carts[0].reason,'Course Board cart acceptance testing reason.');

  r=await fetch(base+'/api/student/add-drop',{
   method:'POST',headers:{'content-type':'application/json',host:'hiau-staging.totag.network'},
   body:JSON.stringify({termId,addSectionIds:[stg104.id],dropRegistrationIds:[],reason:'Course Board cart acceptance testing reason.'}),
  });
  assert.equal(r.status,201);

  r=await fetch(base+'/api/student/add-drop',{headers:{host:'hiau-staging.totag.network'}});
  const afterSubmit:any=await r.json();
  assert.equal(afterSubmit.carts.length,0);
  assert.equal(afterSubmit.requests[0].status,'submitted');
 }finally{
  server.closeAllConnections();
  await new Promise<void>((resolve,reject)=>server.close(error=>error&&(error as NodeJS.ErrnoException).code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve()));
  store.close();fs.rmSync(directory,{recursive:true,force:true});
 }
});
