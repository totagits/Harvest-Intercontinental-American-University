import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Finance payment action buttons use hardened HIAU contrast class',()=>{
  const ui=readFileSync(new URL('../src/components/portal/FinancePaymentWorkflow.tsx',import.meta.url),'utf8');
  assert.match(ui,/hiau-finance-primary rounded-lg px-4 py-2\.5 text-sm font-bold/);
  assert.match(ui,/hiau-finance-primary rounded-lg px-4 py-2 text-sm font-semibold/);
  assert.doesNotMatch(ui,/Record payment[\s\S]{0,200}disabled:opacity-50/);
});
