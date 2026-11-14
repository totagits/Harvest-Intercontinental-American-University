import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Operations} from './operations';

test('payments receive sequential HIAU references and keep external references separate',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hiau-payment-reference-'));
 const db=new Operations(directory);
 const bursar:any={id:'bursar-ref',role:'bursar'};
 const stamp='2026-11-14T00:00:00.000Z';
 try{
  db.saveUsers([{id:bursar.id,name:'Bursar',email:'bursar-ref@example.test',role:'bursar'}]);
  db.run('INSERT INTO programs(id,code,title,required_credits,created_at) VALUES(?,?,?,?,?)','p1','PAYREF','Payment Ref Program',120,stamp);
  db.run("INSERT INTO terms(id,code,title,start_date,end_date,status,max_credits,created_at) VALUES(?,?,?,?,?,'open',?,?)",
   't1','PAYREF-2026','Payment Ref Term','2026-11-01','2027-03-31',18,stamp);
  db.run("INSERT INTO applications(id,number,full_name,email,phone,program_id,status,decision_note,created_at,updated_at) VALUES(?,?,?,?,?,?,'admitted','',?,?)",
   'a1','APP-PAYREF','Test Student','student-payref@example.test','','p1',stamp,stamp);
  db.run("INSERT INTO students(id,user_id,application_id,student_number,full_name,email,program_id,admitted_term_id,status,financial_hold,created_at) VALUES(?,NULL,?,?,?,?,?,?,'active',0,?)",
   's1','a1','STU-PAYREF','Test Student','student-payref@example.test','p1','t1',stamp);
  db.run('INSERT INTO invoices(id,student_id,term_id,number,amount_cents,due_date,posted_by,created_at) VALUES(?,?,?,?,?,?,?,?)',
   'i1','s1','t1','INV-PAYREF',50000,'2026-12-15',bursar.id,stamp);

  const cash:any=db.execute(bursar,'payment',{
   invoiceId:'i1',amount:'100.00',method:'cash',externalReference:'',receivedDate:'2026-11-14'
  });
  assert.equal(cash.reference,'HIAU-PAY-2026-000001');
  assert.equal(cash.external_reference,'');

  assert.throws(()=>db.execute(bursar,'payment',{
   invoiceId:'i1',amount:'50.00',method:'bank',externalReference:'',receivedDate:'2026-11-14'
  }),/require an external transaction reference/i);

  const bank:any=db.execute(bursar,'payment',{
   invoiceId:'i1',amount:'50.00',method:'bank',externalReference:'BANK-SLIP-9988',receivedDate:'2026-11-14'
  });
  assert.equal(bank.reference,'HIAU-PAY-2026-000002');
  assert.equal(bank.external_reference,'BANK-SLIP-9988');

  const nextYear:any=db.execute(bursar,'payment',{
   invoiceId:'i1',amount:'25.00',method:'mobile_money',externalReference:'MTN-2027-ABC',receivedDate:'2027-01-02'
  });
  assert.equal(nextYear.reference,'HIAU-PAY-2027-000001');
  assert.equal(db.one('SELECT external_reference FROM payments WHERE id=?',bank.id).external_reference,'BANK-SLIP-9988');
 }finally{
  db.close();
  fs.rmSync(directory,{recursive:true,force:true});
 }
});
