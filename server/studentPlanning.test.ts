import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type {Server} from 'node:http';
import {Operations} from './operations';
import {installStudentPlanning} from './studentPlanning';

test('ERP-STUDENT-01A plans are private, scoped, audited and do not create enrollment or tuition',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hiau-erp-student-'));
 const db=new Operations(dir);
 const [studentId,otherStudentId,studentUser,otherUser,registrar,courseId,sectionId,termId,programId,appId,appOther,lecturer,bursar]=Array.from({length:13},()=>randomUUID());
 const stamp=new Date().toISOString();
 for(const [id,role,email] of [[studentUser,'student','one@example.test'],[otherUser,'student','two@example.test'],
    [registrar,'registrar','registrar@example.test'],[lecturer,'lecturer','lecturer@example.test'],[bursar,'bursar','bursar@example.test']] as const)
  db.run('INSERT INTO users(id,email,name,role,title,department) VALUES(?,?,?,?,?,?)',id,email,id,role,role,'');
 db.run('INSERT INTO programs VALUES(?,?,?,?,?)',programId,'P-01','Approved sample program',120,stamp);
 db.run('INSERT INTO terms VALUES(?,?,?,?,?,?,?,?)',termId,'T-01','Test term','2026-11-01','2027-03-01','open',18,stamp);
 db.run('INSERT INTO courses VALUES(?,?,?,?,?,?)',courseId,'C-101','Test course',3,10000,stamp);
 db.run("INSERT INTO sections(id,course_id,term_id,lecturer_id,code,capacity,delivery_mode,location,classroom,online_classroom,schedule,created_at) VALUES(?,?,?,?,?,?,'online','','','HIAU Online Classroom — TEST','Mon 09:00',?)",sectionId,courseId,termId,lecturer,'A',40,stamp);
 for(const [id,email,app,number,user] of [[studentId,'one@example.test',appId,'ST-01',studentUser],[otherStudentId,'two@example.test',appOther,'ST-02',otherUser]] as const){
  db.run('INSERT INTO applications VALUES(?,?,?,?,?,?,?,?,?,?)',app,'APP-'+number,id,email,'',programId,'admitted','',stamp,stamp);
  db.run('INSERT INTO students VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,user,app,number,id,email,programId,termId,'active',0,stamp);
 }
 const app=express();
 app.use(express.json());
 app.use((req,res,next)=>{const id=req.header('x-actor')||'visitor';res.locals.actor={
   id,role:id===registrar?'registrar':id===bursar?'bursar':id===lecturer?'lecturer':id===studentUser||id===otherUser?'student':'visitor',
   email:'test@example.test',name:'Test',title:'',department:''
 };next();});
 installStudentPlanning(app,db);
 const server:Server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const address=server.address();
 if(!address||typeof address==='string')throw Error('Missing test server port');
 const base='http://127.0.0.1:'+address.port;
 t.after(async()=>{await new Promise<void>((ok,err)=>server.close(e=>e?err(e):ok()));db.close();fs.rmSync(dir,{recursive:true,force:true});});
 const request=async(method:string,url:string,user:string,body?:unknown)=>{
   const r=await fetch(base+url,{method,headers:{'x-actor':user,'content-type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body)});
   return {status:r.status,payload:await r.json().catch(()=>({}))};
 };
 const endpoint='/api/student/course-plans';
 assert.equal((await request('GET',endpoint,lecturer)).status,403);
 assert.equal((await request('GET',endpoint,otherUser)).payload.plans.length,0);
 const draft=await request('POST',endpoint,studentUser,{termId,sectionIds:[sectionId],note:'Requested course plan'});
 assert.equal(draft.status,201);
 assert.equal(draft.payload.status,'draft');
 const planId=draft.payload.id;
 assert.equal((await request('GET',endpoint,studentUser)).payload.plans.length,1);
 assert.equal((await request('GET',endpoint,otherUser)).payload.plans.length,0);
 assert.equal((await request('POST',endpoint+'/'+planId+'/submit',otherUser,{})).status,404);
 assert.equal((await request('POST',endpoint+'/'+planId+'/review',studentUser,{decision:'approved',note:''})).status,403);
 assert.equal((await request('POST',endpoint+'/'+planId+'/submit',studentUser,{})).status,200);
 assert.equal((await request('POST',endpoint+'/'+planId+'/submit',studentUser,{})).status,409);
 assert.equal((await request('POST',endpoint+'/'+planId+'/review',lecturer,{decision:'approved',note:''})).status,403);
 assert.equal((await request('GET',endpoint,registrar)).payload.plans.length,1);
 assert.equal((await request('POST',endpoint+'/'+planId+'/review',registrar,{decision:'returned',note:'Please revise selection'})).status,200);
 assert.equal((await request('POST',endpoint,studentUser,{termId,sectionIds:[sectionId],note:'Revised'})).status,201);
 assert.equal((await request('POST',endpoint+'/'+planId+'/submit',studentUser,{})).status,200);
 assert.equal((await request('POST',endpoint+'/'+planId+'/review',registrar,{decision:'approved',note:'Meets planning rules'})).status,200);
 assert.equal((await request('GET',endpoint,registrar)).payload.plans.length,1,'Approved plans must await explicit Registrar enrollment.');
 assert.equal((await request('GET',endpoint,registrar)).payload.plans[0].status,'approved');
 assert.equal(db.one('SELECT COUNT(*) AS n FROM registrations').n,0,'approval must not enroll');
 assert.equal(db.one('SELECT COUNT(*) AS n FROM invoices').n,0,'approval must not bill');
 assert.ok(db.one('SELECT id FROM audit WHERE action=?','COURSE_PLAN_REVIEW'));
 assert.equal((await request('POST',endpoint,studentUser,{termId,sectionIds:[sectionId],note:'Overwrite approved'})).status,409);
 assert.equal((await request('GET','/api/student/finance-handoff',studentUser)).status,403);
 assert.equal((await request('POST',endpoint+'/'+planId+'/register',studentUser,{confirmation:'CONFIRM_OFFICIAL_REGISTRATION'})).status,403);
 assert.equal((await request('POST',endpoint+'/'+planId+'/register',registrar,{})).status,400);
 const commit=await request('POST',endpoint+'/'+planId+'/register',registrar,{confirmation:'CONFIRM_OFFICIAL_REGISTRATION'});
 assert.equal(commit.status,201);
 assert.equal(commit.payload.registeredSections,1);
 assert.equal(commit.payload.billingStatus,'awaiting_finance_review');
 assert.equal(db.one('SELECT COUNT(*) AS n FROM registrations').n,1,'Only Registrar commits actual enrollment');
 assert.equal(db.one('SELECT COUNT(*) AS n FROM invoices').n,0,'Registrar must not issue invoice');
 assert.equal((await request('POST',endpoint+'/'+planId+'/register',registrar,{confirmation:'CONFIRM_OFFICIAL_REGISTRATION'})).status,409);
 assert.equal(db.one('SELECT COUNT(*) AS n FROM registrations').n,1,'Commit must be idempotent');
 const queue=await request('GET','/api/student/finance-handoff',bursar);
 assert.equal(queue.status,200);
 assert.equal(queue.payload.items.length,1);
 assert.equal(queue.payload.items[0].unbilled_sections,1);
 assert.equal((await request('GET','/api/student/finance-handoff',lecturer)).status,403);
 assert.ok(db.one('SELECT id FROM audit WHERE action=?','COURSE_PLAN_REGISTERED'));
 assert.equal((await request('GET',endpoint,registrar)).payload.plans.length,0,'Registered plans leave Registrar queue');
 // Fee preview is advisory, Bursar-only, and never posts an invoice.
 assert.equal((await request('GET','/api/student/finance-quote/'+commit.payload.commitId,studentUser)).status,403);
 assert.equal((await request('GET','/api/student/finance-quote/'+commit.payload.commitId,lecturer)).status,403);
 const quote=await request('GET','/api/student/finance-quote/'+commit.payload.commitId,bursar);
 assert.equal(quote.status,200);
 assert.equal(quote.payload.unbilledCount,1);
 assert.equal(quote.payload.indicativeUnbilledCents,30000);
 assert.equal(quote.payload.readyForPosting,false);
 assert.equal(db.one('SELECT COUNT(*) AS n FROM invoices').n,0,'Preview must not post charges');
 assert.equal((await request('GET','/api/student/my-statement',bursar)).status,403);
 const emptyStatement=await request('GET','/api/student/my-statement',studentUser);
 assert.equal(emptyStatement.status,200);
 assert.equal(emptyStatement.payload.invoices.length,0);
 assert.equal((await request('GET','/api/student/my-statement',otherUser)).payload.invoices.length,0);
 // Existing Bursar invoice route is independent of the quote preview.
 const invoice=db.execute({id:bursar,role:'bursar'} as any,'invoice',{
   studentId,termId,dueDate:'2027-02-01'
 });
 assert.equal(invoice.amount_cents,30000);
 const posted=await request('GET','/api/student/my-statement',studentUser);
 assert.equal(posted.status,200);
 assert.equal(posted.payload.invoices.length,1);
 assert.equal(posted.payload.totalBalanceCents,30000);
 assert.equal(posted.payload.invoices[0].lines.length,1);
 assert.equal((await request('GET','/api/student/my-statement',otherUser)).payload.invoices.length,0,'Other student cannot see posted charges');
 const afterInvoice=await request('GET','/api/student/finance-quote/'+commit.payload.commitId,bursar);
 assert.equal(afterInvoice.payload.unbilledCount,0);
 assert.equal(afterInvoice.payload.indicativeUnbilledCents,0);
 assert.equal(afterInvoice.payload.lines[0].invoice_number,invoice.number);


 db.close();
 const reopened=new Operations(dir);
 assert.equal(reopened.one('SELECT status FROM student_course_plans WHERE id=?',planId).status,'approved');
 assert.equal(reopened.one('SELECT COUNT(*) AS n FROM student_course_plan_commits').n,1);
 assert.ok(reopened.exportSnapshot);
 reopened.close();
 // before hook must not close the already closed handle
 db.sql=new Operations(dir).sql;
});
