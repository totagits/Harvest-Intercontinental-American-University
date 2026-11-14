import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Operations} from './operations';
import {ensureStagingAcceptanceStudent} from './stagingAcceptanceStudent';

test('staging bootstrap links MICHAEL to one admitted active record with a usable open term',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hiau-auto-link-'));
  const previousAppUrl=process.env.APP_URL;
  const store=new Operations(directory);
  const michaelId=crypto.randomUUID();
  const adminId=crypto.randomUUID();
  const programId=crypto.randomUUID();
  const termId=crypto.randomUUID();
  const courseId=crypto.randomUUID();
  const sectionId=crypto.randomUUID();
  const stamp=new Date().toISOString();

  try{
    store.saveUsers([
      {id:adminId,name:'University Administrator',email:'admin@hiau.example',role:'super_admin',title:'',department:''},
      {id:michaelId,name:'MICHAEL GWOAH',email:'michael.staging@example.com',role:'student',title:'Staging Student',department:''},
    ]);
    store.run('INSERT INTO programs(id,code,title,required_credits,created_at) VALUES(?,?,?,?,?)',
      programId,'STG-BSC','Staging Bachelor Program',120,stamp);
    store.run('INSERT INTO terms(id,code,title,start_date,end_date,status,max_credits,created_at) VALUES(?,?,?,?,?,?,?,?)',
      termId,'STG-TERM','Staging Acceptance Term','2026-01-01','2099-12-31','open',18,stamp);
    store.run('INSERT INTO courses(id,code,title,credits,fee_cents,created_at) VALUES(?,?,?,?,?,?)',
      courseId,'STG-101','Staging Foundations',3,10000,stamp);
    store.run('INSERT INTO program_requirements(program_id,course_id) VALUES(?,?)',programId,courseId);
    store.run('INSERT INTO sections(id,course_id,term_id,lecturer_id,code,capacity,location,schedule,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      sectionId,courseId,termId,adminId,'A',30,'Online','TBA',stamp);

    process.env.APP_URL='https://hiau.totag.network';
    const blocked=ensureStagingAcceptanceStudent(store,store.users());
    assert.equal(blocked.staging,false);
    assert.equal(store.one('SELECT COUNT(*) AS n FROM students').n,0);

    process.env.APP_URL='https://hiau-staging.totag.network';
    const created=ensureStagingAcceptanceStudent(store,store.users());
    assert.equal(created.created,true);
    assert.equal(created.linked,true);
    assert.equal(created.programTitle,'Staging Bachelor Program');
    assert.equal(created.termTitle,'Staging Acceptance Term');

    const student=store.one('SELECT * FROM students WHERE user_id=?',michaelId);
    assert.ok(student);
    assert.equal(student.status,'active');
    assert.equal(student.financial_hold,0);
    assert.equal(student.program_id,programId);
    assert.equal(student.admitted_term_id,termId);
    assert.match(student.student_number,/^HIAU-STG-\d{4}-[0-9A-F]{6}$/);

    const application=store.one('SELECT * FROM applications WHERE id=?',student.application_id);
    assert.equal(application.status,'admitted');
    assert.match(application.decision_note,/STAGING TEST ONLY/);

    for(const table of ['registrations','grades','invoices','payments','student_course_plans','student_assistance_requests'])
      assert.equal(store.one(`SELECT COUNT(*) AS n FROM ${table}`).n,0);

    assert.equal(
      store.one("SELECT COUNT(*) AS n FROM audit WHERE action='STAGING_ACCEPTANCE_STUDENT_AUTO_LINK'").n,
      1,
    );

    const repeated=ensureStagingAcceptanceStudent(store,store.users());
    assert.equal(repeated.created,false);
    assert.equal(repeated.linked,true);
    assert.equal(repeated.reason,'already-linked');
    assert.equal(store.one('SELECT COUNT(*) AS n FROM students').n,1);
  }finally{
    process.env.APP_URL=previousAppUrl;
    store.close();
    fs.rmSync(directory,{recursive:true,force:true});
  }
});
