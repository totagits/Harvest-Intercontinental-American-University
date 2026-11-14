import test from 'node:test';
import assert from 'node:assert/strict';
import {filterVerifiedStudentItems,verifiedStudentItems} from '../components/portal/StudentUnifiedSearchFilter';

test('search only indexes supplied authorized academic rows',()=>{
  const entries=verifiedStudentItems({
    registrations:[
      {id:'r1',student_id:'s1',course_code:'ITCB 201',course_title:'IT Fundamentals',status:'enrolled',term_title:'2027 First Term'},
    ],
    grades:[
      {id:'g1',registration_id:'r1',status:'published',letter:'A',score:90},
      {id:'g2',registration_id:'r2',status:'draft',letter:'B',score:80},
    ],
    invoices:[{id:'i1',number:'INV-0001',amount_cents:12000,balance_cents:5000,term_title:'2027 First Term'}],
    payments:[
      {id:'p1',invoice_number:'INV-0001',reference:'HIAU-PAY-2027-000001',amount_cents:7000,status:'reconciled',received_date:'2027-01-10',method:'cash'},
      {id:'p2',invoice_number:'INV-0001',reference:'HIAU-PAY-2027-000002',amount_cents:1000,status:'recorded',received_date:'2027-01-11',method:'cash'},
    ],
  });
  assert.equal(entries.length,4);
  assert.equal(entries.filter(x=>x.kind==='grade').length,1);
  assert.ok(entries.every(x=>!JSON.stringify(x).includes('g2')));
  assert.deepEqual(filterVerifiedStudentItems(entries,'itcb 201','all').map(x=>x.kind),['course','grade']);
  assert.deepEqual(filterVerifiedStudentItems(entries,'inv-0001','invoice').map(x=>x.kind),['invoice']);
  assert.deepEqual(filterVerifiedStudentItems(entries,'hiau-pay-2027-000001','receipt').map(x=>x.kind),['receipt']);
  assert.equal(entries.filter(x=>x.kind==='receipt').length,1,'Only reconciled payments become official searchable receipts');
  assert.equal(filterVerifiedStudentItems(entries,'not in permitted records','all').length,0);
});

test('no synthetic university curriculum or library data is added when student records are empty',()=>{
  assert.deepEqual(verifiedStudentItems({registrations:[],grades:[],invoices:[],payments:[]}),[]);
});
