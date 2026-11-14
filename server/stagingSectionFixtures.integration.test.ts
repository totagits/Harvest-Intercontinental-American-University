import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Operations} from './operations';

test('staging acceptance sections receive complete delivery fixtures exactly once',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hiau-staging-section-fixtures-'));
 const dbPath=path.join(directory,'operations.sqlite');
 const db=new DatabaseSync(dbPath);
 db.exec(`
  CREATE TABLE programs(id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,title TEXT NOT NULL,required_credits INTEGER NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE terms(id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,title TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,status TEXT NOT NULL,max_credits INTEGER NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE courses(id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,title TEXT NOT NULL,credits INTEGER NOT NULL,fee_cents INTEGER NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE sections(
   id TEXT PRIMARY KEY,course_id TEXT NOT NULL,term_id TEXT NOT NULL,lecturer_id TEXT NOT NULL,code TEXT NOT NULL,
   capacity INTEGER NOT NULL,delivery_mode TEXT NOT NULL DEFAULT 'classroom',location TEXT NOT NULL DEFAULT '',
   classroom TEXT NOT NULL DEFAULT '',online_classroom TEXT NOT NULL DEFAULT '',schedule TEXT NOT NULL,created_at TEXT NOT NULL,
   UNIQUE(course_id,term_id,code)
  );
 `);
 const programId=crypto.randomUUID(),termId=crypto.randomUUID(),stamp=new Date().toISOString();
 db.prepare('INSERT INTO programs VALUES(?,?,?,?,?)').run(programId,'STG-ACCEPT','Staging Acceptance Program',120,stamp);
 db.prepare('INSERT INTO terms VALUES(?,?,?,?,?,?,?,?)').run(termId,'STG-2026-A','Staging Acceptance Term 2026','2026-11-01','2027-03-31','open',18,stamp);
 for(const [index,code] of ['STG-101','STG-102','STG-103','STG-104'].entries()){
  const courseId=crypto.randomUUID();
  db.prepare('INSERT INTO courses VALUES(?,?,?,?,?,?)').run(courseId,code,'Fixture '+code,3,15000,stamp);
  db.prepare('INSERT INTO sections VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(
   crypto.randomUUID(),courseId,termId,'legacy-faculty','A',index===3?20:30,'hybrid','HIAU Staging','','','TBA',stamp
  );
 }
 db.close();

 let store=new Operations(directory);
 const rows=store.all(`SELECT c.code,s.delivery_mode,s.location,s.classroom,s.online_classroom
  FROM sections s JOIN courses c ON c.id=s.course_id
  WHERE s.term_id=? ORDER BY c.code`,termId);
 assert.deepEqual(rows.map((row:any)=>[row.code,row.delivery_mode,row.location,row.classroom,row.online_classroom]),[
  ['STG-101','hybrid','HIAU Staging','Room 101','HIAU Online Classroom — STG-101'],
  ['STG-102','hybrid','HIAU Staging','Room 102','HIAU Online Classroom — STG-102'],
  ['STG-103','hybrid','HIAU Staging','Room 103','HIAU Online Classroom — STG-103'],
  ['STG-104','hybrid','HIAU Staging','Room 104','HIAU Online Classroom — STG-104'],
 ]);
 assert.ok(store.one("SELECT value FROM settings WHERE key='staging_section_delivery_fixtures_v1'"));
 assert.ok(store.one("SELECT id FROM audit WHERE action='STAGING_SECTION_DELIVERY_FIXTURES'"));
 store.run(`UPDATE sections SET classroom='Custom Collaboration Lab',online_classroom='Custom LMS Space'
  WHERE course_id=(SELECT id FROM courses WHERE code='STG-104')`);
 store.close();

 store=new Operations(directory);
 const preserved=store.one(`SELECT classroom,online_classroom FROM sections
  WHERE course_id=(SELECT id FROM courses WHERE code='STG-104')`);
 assert.equal(preserved.classroom,'Custom Collaboration Lab');
 assert.equal(preserved.online_classroom,'Custom LMS Space');
 store.close();
 fs.rmSync(directory,{recursive:true,force:true});
});
