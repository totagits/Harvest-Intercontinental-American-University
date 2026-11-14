import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Finance handoff distinguishes fee preview from already-posted invoice state',()=>{
 const ui=readFileSync(new URL('../src/components/portal/FinanceRegistrationHandoff.tsx',import.meta.url),'utf8');
 const api=readFileSync(new URL('./studentPlanning.ts',import.meta.url),'utf8');
 assert.match(ui,/Posted invoice status/);
 assert.match(ui,/official payable amount is the posted invoice balance/);
 assert.match(api,/All registered sections in this plan are already linked to a posted invoice/);
 assert.match(api,/readyForPosting:unbilled\.length>0/);
});
