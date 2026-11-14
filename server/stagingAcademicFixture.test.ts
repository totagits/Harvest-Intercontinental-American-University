import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Operations} from './operations';
import {ensureStagingAcademicFixture} from './stagingAcademicFixture';
import {ensureStagingAcceptanceStudent} from './stagingAcceptanceStudent';

test('empty staging operations can prepare a real course-planning fixture then link MICHAEL',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hiau-staging-academic-'));
  const store=new Operations(directory);
  const adminId=crypto.randomUUID();
  const michaelId=crypto.randomUUID();
  try{
    store.saveUsers([
      {id:adminId,name:'University Administrator',email:'admin@hiau.example',role:'super_admin',title:'',department:''},
      {id:michaelId,name:'MICHAEL GWOAH',email:'michael.staging@example.com',role:'student',title:'Staging Student',department:''},
    ]);

    const blocked=ensureStagingAcademicFixture(store,store.users(),{
      requestHost:'hiau.totag.network',
    });
    assert.equal(blocked.ready,false);
    assert.equal(store.one('SELECT COUNT(*) AS n FROM terms').n,0);

    const fixture=ensureStagingAcademicFixture(store,store.users(),{
      requestHost:'hiau-staging.totag.network',
      auditActor:{id:michaelId},
    });
    assert.equal(fixture.ready,true);
    assert.equal(fixture.created,true);
    assert.equal(fixture.programTitle,'HIAU Staging Acceptance Program');
    assert.equal(fixture.termTitle,'Staging Acceptance Term 2026');
    assert.equal(fixture.sectionIds?.length,3);

    const term=store.one("SELECT * FROM terms WHERE code='STG-2026-A'");
    assert.equal(term.status,'open');
    assert.equal(term.max_credits,18);
    assert.equal(store.one("SELECT COUNT(*) AS n FROM courses WHERE code LIKE 'STG-%'").n,3);
    assert.equal(store.one('SELECT COUNT(*) AS n FROM sections WHERE term_id=?',term.id).n,3);
    assert.equal(store.one('SELECT COUNT(*) AS n FROM program_requirements WHERE program_id=?',fixture.programId).n,3);
    assert.equal(
      store.one("SELECT COUNT(*) AS n FROM audit WHERE action='STAGING_ACCEPTANCE_ACADEMIC_FIXTURE'").n,
      1,
    );

    const linked=ensureStagingAcceptanceStudent(store,store.users(),{
      requestHost:'hiau-staging.totag.network',
      accountId:michaelId,
      auditActor:{id:michaelId},
    });
    assert.equal(linked.linked,true);
    assert.equal(linked.created,true);
    assert.equal(linked.programTitle,'HIAU Staging Acceptance Program');
    assert.equal(linked.termTitle,'Staging Acceptance Term 2026');

    const student=store.one('SELECT * FROM students WHERE user_id=?',michaelId);
    assert.equal(student.program_id,fixture.programId);
    assert.equal(student.admitted_term_id,fixture.termId);
    assert.equal(student.status,'active');
    assert.equal(student.financial_hold,0);

    for(const table of ['registrations','grades','invoices','payments','student_course_plans','student_assistance_requests'])
      assert.equal(store.one(`SELECT COUNT(*) AS n FROM ${table}`).n,0);

    const again=ensureStagingAcademicFixture(store,store.users(),{
      requestHost:'hiau-staging.totag.network',
      auditActor:{id:michaelId},
    });
    assert.equal(again.ready,true);
    assert.equal(again.created,false);
    assert.equal(store.one('SELECT COUNT(*) AS n FROM sections WHERE term_id=?',fixture.termId).n,3);
  }finally{
    store.close();
    fs.rmSync(directory,{recursive:true,force:true});
  }
});
