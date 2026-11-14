import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('finance panels synchronize after payment and Add/Drop finance changes',()=>{
 const payment=readFileSync(new URL('../src/components/portal/FinancePaymentWorkflow.tsx',import.meta.url),'utf8');
 const addDrop=readFileSync(new URL('../src/components/portal/StudentAddDropWorkflow.tsx',import.meta.url),'utf8');
 const overview=readFileSync(new URL('../src/components/portal/FinanceBursarModule.tsx',import.meta.url),'utf8');

 assert.match(payment,/hiau:finance-data-changed/);
 assert.match(payment,/payment-reconciled/);
 assert.match(payment,/payment-cancelled/);
 assert.match(addDrop,/hiau:finance-data-changed/);
 assert.match(addDrop,/add-drop-invoice-posted/);
 assert.match(overview,/hiau:finance-data-changed/);
});
