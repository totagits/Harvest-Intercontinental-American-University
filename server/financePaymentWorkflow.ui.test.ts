import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Finance payment UI records and independently reconciles payments with HIAU branding',()=>{
  const ui=readFileSync(new URL('../src/components/portal/FinancePaymentWorkflow.tsx',import.meta.url),'utf8');
  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  const assistance=readFileSync(new URL('../src/components/portal/StudentAssistanceRequests.tsx',import.meta.url),'utf8');

  assert.match(ui,/action\('payment'/);
  assert.match(ui,/action\('reconcilePayment'/);
  assert.match(ui,/x-csrf-token/);
  assert.match(ui,/Independent reconciliation required/);
  assert.match(ui,/External transaction reference/);
  assert.match(ui,/HIAU payment reference/);
  assert.match(ui,/automatically generate the official HIAU payment reference/);
  assert.match(ui,/method!=='cash'/);
  assert.match(ui,/payment\.recorded_by===currentUser\.id/);
  assert.match(ui,/bg-\[#4A1249\]/);
  assert.match(app,/FinancePaymentWorkflow/);
  assert.match(assistance,/border-\[#D8C8DC\] bg-\[#FAF7FB\]/);
  assert.doesNotMatch(assistance,/border-emerald-200 bg-emerald-50/);
});
