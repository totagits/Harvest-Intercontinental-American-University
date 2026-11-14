import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Operations, money } from './operations';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import {installWorkspaces} from './workspaces';

test('workspace API hides other students and rejects spoofed privileged actions', async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'gu-operations-test-'));
 const db=new Operations(directory);db.saveUsers([{id:'one',name:'Student One',email:'one@example.test',role:'student'},{id:'two',name:'Student Two',email:'two@example.test',role:'student'}]);
 const app=express();app.use(express.json());app.use((_req,res,next)=>{res.locals.actor={id:'one',name:'Student One',role:'student'};next();});installWorkspaces(app,db);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const port=(server.address() as any).port;
 try{const state=await (await fetch(`http://127.0.0.1:${port}/api/workspaces/state`)).json();assert.equal(state.users.length,1);assert.equal(state.users[0].id,'one');assert.equal(state.permissions.finance,false);const response=await fetch(`http://127.0.0.1:${port}/api/workspaces/action`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'program',data:{role:'super_admin',code:'NO',title:'Spoofed',requiredCredits:3}})});assert.equal(response.status,403);assert.equal(db.all('SELECT * FROM programs').length,0);}
 finally{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();if(path.dirname(directory)===os.tmpdir()&&path.basename(directory).startsWith('gu-operations-test-'))fs.rmSync(directory,{recursive:true,force:true});}
});

test('clean-start archives legacy records and preserves activated accounts without importing sample operations', () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'gu-operations-test-'),
  );
  const legacy = JSON.stringify({
    users: [
      {
        id: 'active',
        name: 'Existing owner',
        email: 'active@example.test',
        role: 'super_admin',
      },
      {
        id: 'seed',
        name: 'Unused sample',
        email: 'seed@example.test',
        role: 'student',
      },
    ],
    courses: [{ id: 'sample' }],
  });
  fs.writeFileSync(path.join(directory, 'university-db.json'), legacy);
  const identity = new DatabaseSync(path.join(directory, 'identity.sqlite'));
  identity.exec(
    "CREATE TABLE accounts(id TEXT,email TEXT,role TEXT,password TEXT);CREATE TABLE invites(user_id TEXT,used INTEGER,expires INTEGER);INSERT INTO accounts VALUES('active','active@example.test','super_admin','existing-hash'),('seed','seed@example.test','student',NULL);",
  );
  identity.close();
  const db = new Operations(directory);
  try {
    db.migrateLegacy();
    assert.deepEqual(
      db.users().map((u) => u.id),
      ['active'],
    );
    assert.equal(db.all('SELECT * FROM courses').length, 0);
    assert.equal(
      fs.readFileSync(path.join(directory, 'university-db.json'), 'utf8'),
      legacy,
    );
    const archives = fs.readdirSync(path.join(directory, 'migration-archive'));
    assert.equal(archives.length, 1);
    assert.equal(
      fs.readFileSync(
        path.join(
          directory,
          'migration-archive',
          archives[0],
          'university-db.json',
        ),
        'utf8',
      ),
      legacy,
    );
    db.migrateLegacy();
    assert.equal(
      fs.readdirSync(path.join(directory, 'migration-archive')).length,
      1,
    );
  } finally {
    db.close();
    if (
      path.dirname(directory) === os.tmpdir() &&
      path.basename(directory).startsWith('gu-operations-test-')
    )
      fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('clean relational workflow enforces billing, review, publication and graduation', () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'gu-operations-test-'),
  );
  const db = new Operations(directory);
  try {
    db.migrateLegacy();
    assert.equal(db.all('SELECT * FROM students').length, 0);
    assert.equal(db.all('SELECT * FROM courses').length, 0);
    const root: any = { id: 'admin', role: 'super_admin' },
      student: any = { id: 'student', role: 'student' },
      faculty: any = { id: 'faculty', role: 'lecturer' },
      bursar: any = { id: 'bursar', role: 'bursar' };
    db.saveUsers(
      [root, student, faculty, bursar].map((u) => ({
        ...u,
        email: u.id + '@example.test',
        name: u.id,
      })),
    );
    const run = (action: string, data: any) => db.execute(root, action, data);
    const program = run('program', {
      code: 'TEST',
      title: 'Test program',
      requiredCredits: 3,
    });
    const term = run('term', {
      code: 'T1',
      title: 'Test term',
      startDate: '2026-01-01',
      endDate: '2026-05-01',
      status: 'open',
      maxCredits: 12,
    });
    const course = run('course', {
      code: 'C1',
      title: 'Test course',
      credits: 3,
      feePerCredit: '12.34',
      programId: program.id,
    });
    const section = run('section', {
      courseId: course.id,
      termId: term.id,
      lecturerId: faculty.id,
      code: 'A',
      capacity: 1,
      deliveryMode: 'classroom',
      location: 'Main Campus',
      classroom: 'Room',
      schedule: 'Monday',
    });
    const application = run('application', {
      fullName: 'Test student',
      email: 'student@example.test',
      programId: program.id,
    });
    assert.throws(
      () =>
        run('admit', {
          applicationId: application.id,
          studentNumber: 'S1',
          termId: term.id,
        }),
      /approved/,
    );
    run('reviewApplication', {
      id: application.id,
      status: 'approved',
      note: 'Reviewed',
    });
    const profile = run('admit', {
      applicationId: application.id,
      studentNumber: 'S1',
      termId: term.id,
    });
    assert.equal(profile.user_id, student.id);
    assert.equal(db.eligibility(profile.id).earnedCredits, 0);
    assert.throws(
      () => db.execute(student, 'register', { sectionId: section.id }),
      /role/,
      'A student cannot bypass the Registrar-reviewed planning workflow.',
    );
    const registration = run('register', {
      studentId: profile.id,
      sectionId: section.id,
    });
    assert.throws(
      () => run('register', { studentId: profile.id, sectionId: section.id }),
      /capacity|already/,
    );
    assert.throws(
      () => db.studentFor({ ...student, id: 'other' }, profile.id),
      /accessible/,
    );
    assert.throws(
      () => db.execute(student, 'invoice', { studentId: profile.id }),
      /role/,
    );
    const invoice = run('invoice', {
      studentId: profile.id,
      termId: term.id,
      dueDate: '2026-02-01',
    });
    assert.equal(invoice.amount_cents, 3702);
    assert.throws(
      () =>
        run('invoice', {
          studentId: profile.id,
          termId: term.id,
          dueDate: '2026-02-01',
        }),
      /unbilled/,
    );
    const receipt = db.execute(bursar, 'payment', {
      invoiceId: invoice.id,
      amount: '37.02',
      externalReference: 'TEST-BANK-RECEIPT',
      method: 'bank',
      receivedDate: '2026-01-05',
    });
    assert.equal(receipt.reference,'HIAU-PAY-2026-000001');
    assert.equal(receipt.external_reference,'TEST-BANK-RECEIPT');
    assert.equal(db.balance(profile.id), 3702);
    assert.throws(
      () =>
        db.execute(bursar, 'reconcilePayment', {
          id: receipt.id,
          status: 'reconciled',
          note: 'Checked',
        }),
      /second/,
    );
    run('reconcilePayment', {
      id: receipt.id,
      status: 'reconciled',
      note: 'Statement checked',
    });
    assert.equal(db.balance(profile.id), 0);
    const grade = db.execute(faculty, 'grade', {
      registrationId: registration.id,
      score: 80,
      submit: true,
    });
    assert.throws(() => run('publishGrade', { id: grade.id }), /grading scale/);
    run('gradeScheme', {
      title: 'Approved test scale',
      definition: [
        { min: 50, letter: 'P', points: 4, passed: true },
        { min: 0, letter: 'F', points: 0, passed: false },
      ],
    });
    run('publishGrade', { id: grade.id });
    assert.equal(db.eligibility(profile.id).earnedCredits, 3);
    assert.throws(
      () =>
        db.execute(faculty, 'grade', {
          registrationId: registration.id,
          score: 90,
        }),
      /locked/,
    );
    assert.throws(
      () => run('drop', { id: registration.id, reason: 'Test' }),
      /published/,
    );
    const review = db.execute(student, 'graduationRequest', {});
    run('graduationReview', {
      id: review.id,
      status: 'approved',
      note: 'Requirements verified',
    });
    assert.equal(
      db.one('SELECT status FROM students WHERE id=?', profile.id).status,
      'graduated',
    );
    const snapshot = db.exportSnapshot();
    db.importSnapshot(snapshot);
    assert.equal(db.eligibility(profile.id).earnedCredits, 3);
    assert.throws(() => db.run('DELETE FROM audit'), /cannot be removed/);
    const before = db.all('SELECT * FROM courses').length;
    assert.throws(() =>
      run('course', {
        code: 'BAD',
        title: 'Invalid reference',
        credits: 3,
        feePerCredit: '0',
        programId: 'missing',
      }),
    );
    assert.equal(db.all('SELECT * FROM courses').length, before);
    db.migrateLegacy();
    assert.equal(db.all('SELECT * FROM students').length, 1);
    assert.throws(
      () =>
        run('term', {
          code: 'BAD',
          title: 'Bad date',
          startDate: '2026-99-99',
          endDate: '2026-12-01',
          maxCredits: 12,
        }),
      /valid date/,
    );
  } finally {
    db.close();
    if (
      path.dirname(directory) === os.tmpdir() &&
      path.basename(directory).startsWith('gu-operations-test-')
    )
      fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('currency uses exact cents and rejects ambiguous amounts', () => {
  assert.equal(money('0.29'), 29);
  assert.equal(money('100.01'), 10001);
  assert.throws(() => money('1.001'));
  assert.throws(() => money('-1'));
});


test('student activity endpoint is scoped, redacted, and inaccessible to staff', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-activity-test-'));
  const db = new Operations(directory);
  db.saveUsers([
    { id: 'student-one', name: 'Student One', email: 'one@example.test', role: 'student' },
    { id: 'student-two', name: 'Student Two', email: 'two@example.test', role: 'student' },
    { id: 'admin-one', name: 'Administrator', email: 'admin@example.test', role: 'super_admin' },
  ]);
  db.audit('student-one', 'register', 'enrollment-1', null, { secret: 'private-one' });
  db.audit('student-one', 'task', 'task-1', null, { secret: 'internal-only' });
  db.audit('student-two', 'transcriptRequest', 'request-2', null, { secret: 'private-two' });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const id = String(req.get('x-test-user') || 'student-one');
    const role = id === 'admin-one' ? 'super_admin' : 'student';
    res.locals.actor = { id, name: id, role };
    next();
  });
  installWorkspaces(app, db);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const response = await fetch(base + '/api/workspaces/student-activity', { headers: { 'x-test-user': 'student-one' } });
    assert.equal(response.status, 200);
    const activity = await response.json();
    assert.equal(activity.activities.length, 1);
    assert.equal(activity.activities[0].action, 'register');
    assert.deepEqual(Object.keys(activity.activities[0]).sort(), ['action', 'created_at', 'id']);
    assert.equal(JSON.stringify(activity).includes('private-one'), false);
    assert.equal(JSON.stringify(activity).includes('private-two'), false);
    assert.equal(JSON.stringify(activity).includes('internal-only'), false);

    const state = await (await fetch(base + '/api/workspaces/state', { headers: { 'x-test-user': 'student-one' } })).json();
    assert.ok(state.audit.length > 0);
    assert.equal(Object.prototype.hasOwnProperty.call(state.audit[0], 'after_json'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(state.audit[0], 'before_json'), false);

    const other = await (await fetch(base + '/api/workspaces/student-activity', { headers: { 'x-test-user': 'student-two' } })).json();
    assert.equal(other.activities.length, 1);
    assert.equal(other.activities[0].action, 'transcriptRequest');
    const forbidden = await fetch(base + '/api/workspaces/student-activity', { headers: { 'x-test-user': 'admin-one' } });
    assert.equal(forbidden.status, 403);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
    if (path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('gu-activity-test-'))
      fs.rmSync(directory, { recursive: true, force: true });
  }
});


test('recipient notifications are persisted, private, and read state is isolated', async () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hiau-notifications-test-'));
  const db=new Operations(directory);
  db.saveUsers([
    {id:'staff-one',name:'Staff One',email:'staff@example.test',role:'registrar'},
    {id:'staff-two',name:'Staff Two',email:'other@example.test',role:'lecturer'},
  ]);
  const staff={id:'staff-one',name:'Staff One',role:'registrar'} as any;
  const other={id:'staff-two',name:'Staff Two',role:'lecturer'} as any;
  const app=express();
  app.use(express.json());
  app.use((req,res,next)=>{
    const id=req.get('x-test-user')||'staff-one';
    res.locals.actor={id,role:id==='staff-one'?'registrar':'lecturer',name:id};
    next();
  });
  installWorkspaces(app,db);
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const task=db.execute(staff,'task',{title:'Review curriculum',description:'Check approved records',assigneeId:'staff-two',dueDate:'2027-06-01'});
    const first=db.notificationsFor(other);
    assert.equal(first.length,1);
    assert.equal(first[0].title,'New task assigned');
    assert.equal(db.notificationsFor(staff).length,0);
    const visible=await (await fetch(base+'/api/notifications',{headers:{'x-test-user':'staff-two'}})).json();
    assert.equal(visible.notifications.length,1);
    assert.equal(visible.unreadCount,1);
    const forbidden=await fetch(base+'/api/notifications/'+first[0].id+'/read',{
      method:'PATCH',headers:{'x-test-user':'staff-one'}
    });
    assert.equal(forbidden.status,404);
    assert.equal(db.notificationsFor(other)[0].read_at,null);
    const read=await fetch(base+'/api/notifications/'+first[0].id+'/read',{
      method:'PATCH',headers:{'x-test-user':'staff-two'}
    });
    assert.equal(read.status,200);
    assert.ok(db.notificationsFor(other)[0].read_at);
    db.execute(other,'taskStatus',{id:task.id,status:'in_progress'});
    assert.equal(db.notificationsFor(staff)[0].title,'Task status changed');
    assert.equal(db.notificationsFor(other).length,1);
    const snapshot=db.exportSnapshot();
    assert.equal(snapshot.notifications.length,2);
    db.importSnapshot(snapshot);
    assert.equal(db.notificationsFor(staff).length,1);
    assert.equal(db.notificationsFor(other).length,1);
    const all=await fetch(base+'/api/notifications/read-all',{method:'POST',headers:{'x-test-user':'staff-one'}});
    assert.equal(all.status,200);
    assert.ok(db.notificationsFor(staff)[0].read_at);
  } finally {
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    db.close();
    if(path.dirname(directory)===os.tmpdir()&&path.basename(directory).startsWith('hiau-notifications-test-'))
      fs.rmSync(directory,{recursive:true,force:true});
  }
});
