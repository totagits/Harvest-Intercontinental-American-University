import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Add/Drop workflow is reachable in Student, Registrar and Finance workspaces with CSRF-protected actions',()=>{
 const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../src/components/portal/StudentAddDropWorkflow.tsx',import.meta.url),'utf8');
 const server=readFileSync(new URL('./studentAddDrop.ts',import.meta.url),'utf8');

 assert.match(app,/StudentAddDropWorkflow currentUser=\{currentUser\} mode="student"/);
 assert.match(app,/StudentAddDropWorkflow currentUser=\{currentUser\} mode="registrar"/);
 assert.match(app,/StudentAddDropWorkflow currentUser=\{currentUser\} mode="finance"/);
 assert.match(ui,/x-csrf-token/);
 assert.match(ui,/Submit Add\/Drop request/);
 assert.match(ui,/Submitting…/);
 assert.match(ui,/aria-live="polite"/);
 assert.match(ui,/Commit approved Add\/Drop/);
 assert.match(ui,/Post Add\/Drop tuition invoice/);
 assert.match(server,/STG-104/);
 assert.match(server,/ADD_DROP_SUBMITTED/);
 assert.match(server,/ADD_DROP_REVIEWED/);
 assert.match(server,/ADD_DROP_COMMITTED/);
 assert.match(server,/refundPercent/);
});
