import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Account & Integrations uses HIAU purple and gold instead of legacy green',()=>{
  const component=readFileSync(new URL('../src/components/portal/AccountCenter.tsx',import.meta.url),'utf8');
  const css=readFileSync(new URL('../src/styles/campus.css',import.meta.url),'utf8');
  assert.match(component,/hiau-account-center/);
  assert.match(css,/\.hiau-erp-site \.hiau-account-center/);
  assert.match(css,/--campus-accent:#4a1249/);
  assert.match(css,/--campus-text:#35103b/);
  assert.match(css,/--campus-gold:#c39a53/);
  assert.match(css,/background:#4a1249/);
  assert.match(css,/background:#c39a53/);
});
