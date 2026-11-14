import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('student finance PDFs use HIAU branding and only reconciled payments receive receipts',()=>{
 const docs=readFileSync(new URL('../src/utils/studentFinanceDocuments.ts',import.meta.url),'utf8');
 const statement=readFileSync(new URL('../src/components/portal/StudentFinancialStatement.tsx',import.meta.url),'utf8');
 const api=readFileSync(new URL('./studentPlanning.ts',import.meta.url),'utf8');
 const workspace=readFileSync(new URL('../src/components/portal/SecureStudentWorkspace.tsx',import.meta.url),'utf8');

 assert.match(docs,/HARVEST INTERCONTINENTAL/);
 assert.match(docs,/AMERICAN UNIVERSITY/);
 assert.doesNotMatch(docs,/Gwoah's University/);
 assert.match(docs,/OFFICIAL TUITION INVOICE/);
 assert.match(docs,/OFFICIAL PAYMENT RECEIPT/);
 assert.match(docs,/payment\.status!=='reconciled'/);
 assert.match(statement,/Download invoice PDF/);
 assert.match(statement,/Download official receipt/);
 assert.match(statement,/payment\.status==='reconciled'/);
 assert.match(api,/p\.id,p\.reference,p\.amount_cents/);
 assert.match(api,/studentName:student\.full_name/);
 assert.match(workspace,/timeZone:'UTC'/);
 assert.match(workspace,/reconciled-payment receipts/);
});
