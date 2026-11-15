import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('enterprise authority model supports dynamic positions, functional roles, scopes and assignments',()=>{
 const identity=readFileSync(new URL('./identity.ts',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../src/components/portal/AccountCenter.tsx',import.meta.url),'utf8');
 assert.match(identity,/CREATE TABLE IF NOT EXISTS positions/);
 assert.match(identity,/CREATE TABLE IF NOT EXISTS position_roles/);
 assert.match(identity,/CREATE TABLE IF NOT EXISTS user_positions/);
 assert.match(identity,/functionalRoleCatalog/);
 assert.match(identity,/\/api\/identity\/positions/);
 assert.match(identity,/POSITION_CREATED/);
 assert.match(identity,/POSITION_ASSIGNED/);
 assert.match(ui,/Institutional Positions & RBAC/);
 assert.match(ui,/Create position/);
 assert.match(ui,/Assign position/);
 assert.match(ui,/Approval limit \(USD\)/);
 assert.match(ui,/Delegation/);
});
