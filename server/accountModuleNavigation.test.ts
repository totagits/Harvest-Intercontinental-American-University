import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('current portal exposes Account & Integrations to Super Admin only',()=>{
  const registry=readFileSync(new URL('../src/portal/moduleRegistry.ts',import.meta.url),'utf8');
  const sidebar=readFileSync(new URL('../src/components/portal/PortalSidebar.tsx',import.meta.url),'utf8');
  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');

  assert.match(registry,/{ id: 'accounts', label: 'Account & Integrations', group: 'primary' }/);
  assert.match(sidebar,/accounts: Settings/);
  assert.match(app,/import \{ AccountCenter \}/);
  assert.match(app,/activePortalTab === 'accounts'/);
  assert.match(app,/<AccountCenter user=\{currentUser\}/);

  for(const role of ['registrar','dean','lecturer','bursar','admissions_officer','student','partner_representative','alumni'])
    assert.doesNotMatch(registry,new RegExp(role+":[^\n]*accounts"));
});
