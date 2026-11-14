import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {Operations} from './operations';
import {installStudentAddDrop} from './studentAddDrop';

test('STG-104 Add/Drop path commits enrollment and reveals online classroom only afterward',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hiau-add-drop-e2e-'));
 const store=new Operations(directory);
 const admin={id:crypto.randomUUID(),email:'registrar@example.test',name:'Registrar',role:'super_admin',title:''} as any;
 const faculty={id:crypto.randomUUID(),email:'faculty@example.test',name:'Faculty',role:'lecturer',title:'',department:''};
 const studentUser={id:crypto.randomUUID(),email:'student@example.test',name:'MICHAEL GWOAH',role:'student',title:'',department:''};
 store.saveUsers([admin,faculty,studentUser]);

 const program=store.execute(admin,'program',{code:'E2E',title:'E2E Program',requiredCredits:120});
 const term=store.execute(admin,'term',{code:'E2E-2026',title:'E2E Term',startDate:'2026-11-01',endDate:'2027-03-31',status:'open',maxCredits:18});
 const courses:any[]=[];
 for(const [i,code] of ['E2E-101','E2E-102','E2E-103','E2E-104'].entries()){
  courses.push(store.execute(admin,'course',{code,title:'Course '+(i+1),credits:3,feePerCredit:'150.00',programId:program.id,prerequisites:[]}));
 }
 const sections:any[]=[];
 for(let i=0;i<4;i++){
  sections.push(store.execute(admin,'section',{
   courseId:courses[i].id,termId:term.id,lecturerId:faculty.id,code:'A',capacity:i===3?20:30,
   deliveryMode:'hybrid',location:'HIAU Staging',classroom:'Room '+(101+i),
   onlineClassroom:'HIAU Online Classroom — E2E-'+(101+i),schedule:'Schedule '+(i+1)
  }));
 }

 const stamp=new Date().toISOString(),applicationId=crypto.randomUUID(),studentId=crypto.randomUUID();
 store.run("INSERT INTO applications(id,number,full_name,email,phone,program_id,status,decision_note,created_at,updated_at) VALUES(?,?,?,?,?,?,'admitted','test',?,?)",
  applicationId,'APP-E2E','MICHAEL GWOAH','student@example.test','',program.id,stamp,stamp);
 store.run("INSERT INTO students(id,user_id,application_id,student_number,full_name,email,program_id,admitted_term_id,status,financial_hold,created_at) VALUES(?,?,?,?,?,?,?,?, 'active',0,?)",
  studentId,studentUser.id,applicationId,'HIAU-STG-E2E','MICHAEL GWOAH','student@example.test',program.id,term.id,stamp);
 for(let i=0;i<3;i++)store.run("INSERT INTO registrations(id,student_id,section_id,status,created_at,updated_at) VALUES(?,?,?,'enrolled',?,?)",
  crypto.randomUUID(),studentId,sections[i].id,stamp,stamp);

 let actor:any=studentUser;
 const app=express();app.use(express.json());
 app.use((_req,res,next)=>{res.locals.actor=actor;next();});
 installStudentAddDrop(app,store);
 const server=app.listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));
 const addr=server.address();if(!addr||typeof addr==='string')throw Error('No test server');
 const base='http://127.0.0.1:'+addr.port;

 try{
  let response=await fetch(base+'/api/student/add-drop');
  assert.equal(response.status,200);
  let data:any=await response.json();
  const before=data.sections.find((row:any)=>row.id===sections[3].id);
  assert.equal(before.enrolled_count,0);
  assert.equal(before.online_classroom,'');
  assert.equal(before.has_online_classroom,1);

  response=await fetch(base+'/api/student/add-drop/cart',{
   method:'PUT',headers:{'content-type':'application/json'},
   body:JSON.stringify({termId:term.id,addSectionIds:[sections[3].id],dropRegistrationIds:[],reason:'Acceptance test for STG-104 enrollment workflow.'})
  });
  assert.equal(response.status,200);

  response=await fetch(base+'/api/student/add-drop',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({termId:term.id,addSectionIds:[sections[3].id],dropRegistrationIds:[],reason:'Acceptance test for STG-104 enrollment workflow.'})
  });
  assert.equal(response.status,201);
  const submitted:any=await response.json();
  assert.equal(submitted.status,'submitted');
  assert.equal(submitted.resultingCredits,12);
  assert.equal(submitted.addedUnbilledCents,45000);

  actor=admin;
  response=await fetch(base+'/api/student/add-drop');
  assert.equal(response.status,200);
  data=await response.json();
  assert.equal(data.requests.length,1);
  assert.equal(data.requests[0].reviewSummary.currentCredits,9);
  assert.equal(data.requests[0].reviewSummary.addCredits,3);
  assert.equal(data.requests[0].reviewSummary.resultingCredits,12);
  assert.equal(data.requests[0].reviewSummary.addedUnbilledCents,45000);

  response=await fetch(base+'/api/student/add-drop/'+submitted.id+'/review',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({decision:'approved',note:'Approved for end-to-end Add/Drop acceptance testing.'})
  });
  assert.equal(response.status,200);

  response=await fetch(base+'/api/student/add-drop/'+submitted.id+'/commit',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({confirmation:'CONFIRM_ADD_DROP'})
  });
  assert.equal(response.status,200);
  const committed:any=await response.json();
  assert.equal(committed.status,'committed');
  assert.equal(committed.addedRegistrations,1);
  assert.equal(committed.droppedRegistrations,0);

  actor=studentUser;
  response=await fetch(base+'/api/student/add-drop');
  data=await response.json();
  assert.equal(data.registrations.length,4);
  const added=data.registrations.find((row:any)=>row.section_id===sections[3].id);
  assert.ok(added);
  assert.equal(added.online_classroom,'HIAU Online Classroom — E2E-104');
  const after=data.sections.find((row:any)=>row.id===sections[3].id);
  assert.equal(after.enrolled_count,1);
  assert.equal(after.online_classroom,'HIAU Online Classroom — E2E-104');
  assert.equal(data.requests[0].status,'committed');
 }finally{
  server.closeAllConnections();
  await new Promise<void>((resolve,reject)=>server.close(error=>error&&(error as NodeJS.ErrnoException).code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve()));
  store.close();fs.rmSync(directory,{recursive:true,force:true});
 }
});
