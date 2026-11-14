import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {Operations} from './operations';
import {installStudentAddDrop} from './studentAddDrop';
import {installStudentPlanning} from './studentPlanning';

test('paid drop without replacement creates controlled refund payable and deadline blocks late Add/Drop',async()=>{
 const isoDay=(date:Date)=>date.toISOString().slice(0,10);
 const nowDate=new Date();
 const termStartDate=new Date(nowDate.getTime()-7*86400000);
 const termEndDate=new Date(nowDate.getTime()+120*86400000);
 const deadlineDate=new Date(nowDate.getTime()+30*86400000);
 const termStart=isoDay(termStartDate),termEnd=isoDay(termEndDate),registrationClose=isoDay(deadlineDate),receivedDate=isoDay(nowDate);
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hiau-refund-adddrop-'));
 const store=new Operations(directory);
 const registrar:any={id:crypto.randomUUID(),email:'registrar@example.test',name:'Registrar',role:'super_admin',title:''};
 const bursar1:any={id:crypto.randomUUID(),email:'b1@example.test',name:'Bursar One',role:'bursar',title:''};
 const bursar2:any={id:crypto.randomUUID(),email:'b2@example.test',name:'Bursar Two',role:'bursar',title:''};
 const faculty:any={id:crypto.randomUUID(),email:'faculty@example.test',name:'Faculty',role:'lecturer',title:''};
 const studentUser:any={id:crypto.randomUUID(),email:'student@example.test',name:'Student',role:'student',title:''};
 store.saveUsers([registrar,bursar1,bursar2,faculty,studentUser]);

 const program=store.execute(registrar,'program',{code:'REF',title:'Refund Test',requiredCredits:120});
 const term=store.execute(registrar,'term',{
  code:'REF-2026',title:'Refund Term',startDate:termStart,endDate:termEnd,
  registrationCloseDate:registrationClose,status:'open',maxCredits:18
 });
 const course1=store.execute(registrar,'course',{code:'REF-101',title:'Paid Course',credits:3,feePerCredit:'150.00',programId:program.id,prerequisites:[]});
 const course2=store.execute(registrar,'course',{code:'REF-102',title:'Remaining Course',credits:3,feePerCredit:'150.00',programId:program.id,prerequisites:[]});
 const section1=store.execute(registrar,'section',{courseId:course1.id,termId:term.id,lecturerId:faculty.id,code:'A',capacity:20,deliveryMode:'classroom',location:'Main Campus',classroom:'101',onlineClassroom:'',schedule:'Mon 09:00'});
 const section2=store.execute(registrar,'section',{courseId:course2.id,termId:term.id,lecturerId:faculty.id,code:'A',capacity:20,deliveryMode:'classroom',location:'Main Campus',classroom:'102',onlineClassroom:'',schedule:'Tue 09:00'});

 const stamp=new Date().toISOString(),applicationId=crypto.randomUUID(),studentId=crypto.randomUUID();
 store.run("INSERT INTO applications(id,number,full_name,email,phone,program_id,status,decision_note,created_at,updated_at) VALUES(?,?,?,?,?,?,'admitted','',?,?)",
  applicationId,'APP-REF','Student','student@example.test','',program.id,stamp,stamp);
 store.run("INSERT INTO students(id,user_id,application_id,student_number,full_name,email,program_id,admitted_term_id,status,financial_hold,created_at) VALUES(?,?,?,?,?,?,?,?, 'active',0,?)",
  studentId,studentUser.id,applicationId,'HIAU-REF-001','Student','student@example.test',program.id,term.id,stamp);
 const reg1=crypto.randomUUID(),reg2=crypto.randomUUID();
 store.run("INSERT INTO registrations(id,student_id,section_id,status,created_at,updated_at) VALUES(?,?,?,'enrolled',?,?)",reg1,studentId,section1.id,stamp,stamp);
 store.run("INSERT INTO registrations(id,student_id,section_id,status,created_at,updated_at) VALUES(?,?,?,'enrolled',?,?)",reg2,studentId,section2.id,stamp,stamp);
 const invoiceId=crypto.randomUUID();
 store.run('INSERT INTO invoices(id,student_id,term_id,number,amount_cents,due_date,posted_by,created_at) VALUES(?,?,?,?,?,?,?,?)',
  invoiceId,studentId,term.id,'INV-REF-001',45000,registrationClose,bursar1.id,stamp);
 store.run('INSERT INTO invoice_lines(id,invoice_id,registration_id,description,amount_cents) VALUES(?,?,?,?,?)',
  crypto.randomUUID(),invoiceId,reg1,'REF-101 Paid Course',45000);
 const payment:any=store.execute(bursar1,'payment',{invoiceId,amount:'450.00',method:'cash',externalReference:'',receivedDate});
 store.execute(bursar2,'reconcilePayment',{id:payment.id,status:'reconciled',note:'Verified paid tuition for refund acceptance test.'});
 assert.equal(store.invoiceBalance(invoiceId),0);

 let actor:any=studentUser;
 const app=express();app.use(express.json());
 app.use((_req,res,next)=>{res.locals.actor=actor;next();});
 installStudentAddDrop(app,store);
 installStudentPlanning(app,store);
 const server=app.listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));
 const addr=server.address();if(!addr||typeof addr==='string')throw Error('No test server');
 const base='http://127.0.0.1:'+addr.port;
 const call=async(method:string,url:string,body?:unknown)=>{
  const response=await fetch(base+url,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,data:await response.json().catch(()=>({}))};
 };
 try{
  let result=await call('POST','/api/student/add-drop',{termId:term.id,addSectionIds:[],dropRegistrationIds:[reg1],reason:'Dropping paid course without a replacement for refund testing.'});
  assert.equal(result.status,201);
  const requestId=result.data.id;

  actor=registrar;
  result=await call('POST','/api/student/add-drop/'+requestId+'/review',{decision:'approved',note:'Approved paid-course drop within refund window.'});
  assert.equal(result.status,200);
  result=await call('POST','/api/student/add-drop/'+requestId+'/commit',{confirmation:'CONFIRM_ADD_DROP'});
  assert.equal(result.status,200);
  assert.equal(result.data.droppedRegistrations,1);
  assert.ok(result.data.refundDueCents>0);

  const refund=store.one('SELECT * FROM student_refunds WHERE add_drop_request_id=?',requestId);
  assert.ok(refund);
  assert.equal(refund.status,'pending');
  assert.equal(refund.amount_cents,45000);
  assert.equal(store.balance(studentId),-45000);

  actor=bursar1;
  result=await call('GET','/api/student/add-drop/finance');
  assert.equal(result.status,200);
  assert.equal(result.data.refunds.length,1);
  result=await call('POST','/api/student/add-drop/refunds/'+refund.id+'/review',{decision:'approved',note:'Verified refundable overpayment from reconciled cash tuition.'});
  assert.equal(result.status,200);

  result=await call('POST','/api/student/add-drop/refunds/'+refund.id+'/pay',{method:'cash',externalReference:''});
  assert.equal(result.status,409,'Same account cannot approve and pay a refund');

  actor=bursar2;
  result=await call('POST','/api/student/add-drop/refunds/'+refund.id+'/pay',{method:'cash',externalReference:''});
  assert.equal(result.status,200);
  assert.match(result.data.reference,new RegExp('^HIAU-REF-'+receivedDate.slice(0,4)+'-\\d{6}
  assert.equal(store.balance(studentId),0);
  assert.equal(store.invoiceBalance(invoiceId),0);

  actor=studentUser;
  result=await call('GET','/api/student/my-statement');
  assert.equal(result.status,200);
  assert.equal(result.data.invoices[0].refunds[0].status,'paid');

  actor=registrar;
  store.execute(registrar,'termRegistrationDeadline',{id:term.id,registrationCloseDate:termStart});
  actor=studentUser;
  result=await call('PUT','/api/student/add-drop/cart',{termId:term.id,addSectionIds:[],dropRegistrationIds:[reg2],reason:'Late drop should be blocked by deadline.'});
  assert.equal(result.status,409);
  assert.match(result.data.error,/closed/i);
 }finally{
  server.closeAllConnections();
  await new Promise<void>((resolve,reject)=>server.close(error=>error&&(error as NodeJS.ErrnoException).code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve()));
  store.close();fs.rmSync(directory,{recursive:true,force:true});
 }
});
));
  assert.equal(store.balance(studentId),0);
  assert.equal(store.invoiceBalance(invoiceId),0);

  actor=studentUser;
  result=await call('GET','/api/student/my-statement');
  assert.equal(result.status,200);
  assert.equal(result.data.invoices[0].refunds[0].status,'paid');

  actor=registrar;
  store.execute(registrar,'termRegistrationDeadline',{id:term.id,registrationCloseDate:termStart});
  actor=studentUser;
  result=await call('PUT','/api/student/add-drop/cart',{termId:term.id,addSectionIds:[],dropRegistrationIds:[reg2],reason:'Late drop should be blocked by deadline.'});
  assert.equal(result.status,409);
  assert.match(result.data.error,/closed/i);
 }finally{
  server.closeAllConnections();
  await new Promise<void>((resolve,reject)=>server.close(error=>error&&(error as NodeJS.ErrnoException).code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve()));
  store.close();fs.rmSync(directory,{recursive:true,force:true});
 }
});
