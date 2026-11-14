import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Operations} from './operations';

test('existing section table migrates safely and classroom can be assigned to published sections',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hiau-classroom-migration-'));
 const dbPath=path.join(directory,'operations.sqlite');
 const legacy=new DatabaseSync(dbPath);
 legacy.exec(`CREATE TABLE sections(
   id TEXT PRIMARY KEY,
   course_id TEXT NOT NULL,
   term_id TEXT NOT NULL,
   lecturer_id TEXT NOT NULL,
   code TEXT NOT NULL,
   capacity INTEGER NOT NULL CHECK(capacity>0),
   location TEXT NOT NULL,
   schedule TEXT NOT NULL,
   created_at TEXT NOT NULL,
   UNIQUE(course_id,term_id,code)
 );`);
 legacy.close();

 const store=new Operations(directory);
 const columns=store.all('PRAGMA table_info(sections)').map((row:any)=>row.name);
 assert.ok(columns.includes('classroom'));
 assert.ok(columns.includes('delivery_mode'));
 assert.ok(columns.includes('online_classroom'));

 const admin={id:crypto.randomUUID(),email:'admin@example.test',name:'University Administrator',role:'super_admin',title:''} as any;
 const lecturer={id:crypto.randomUUID(),email:'lecturer@example.test',name:'Faculty Member',role:'lecturer',title:'',department:''};
 store.saveUsers([admin,lecturer]);
 const program=store.execute(admin,'program',{code:'ROOM',title:'Room Test Program',requiredCredits:120});
 const term=store.execute(admin,'term',{code:'ROOM-2026',title:'Room Test Term',startDate:'2026-11-01',endDate:'2027-03-01',status:'open',maxCredits:18});
 const course=store.execute(admin,'course',{code:'ROOM-101',title:'Room Test Course',credits:3,feePerCredit:'100.00',programId:program.id,prerequisites:[]});
 const section=store.execute(admin,'section',{
   courseId:course.id,termId:term.id,lecturerId:lecturer.id,code:'A',capacity:20,
   deliveryMode:'online',onlineClassroom:'HIAU LMS / ROOM-101',schedule:'Mon/Wed 10:00–11:30'
 });
 assert.equal(section.delivery_mode,'online');
 assert.equal(section.classroom,'');

 const updated=store.execute(admin,'sectionSettings',{
   id:section.id,capacity:20,deliveryMode:'hybrid',location:'Main Campus',
   classroom:'Room 201',onlineClassroom:'HIAU LMS / ROOM-101'
 });
 assert.equal(updated.delivery_mode,'hybrid');
 assert.equal(updated.classroom,'Room 201');
 assert.equal(updated.online_classroom,'HIAU LMS / ROOM-101');
 assert.equal(store.one('SELECT classroom FROM sections WHERE id=?',section.id).classroom,'Room 201');

 store.close();fs.rmSync(directory,{recursive:true,force:true});
});
