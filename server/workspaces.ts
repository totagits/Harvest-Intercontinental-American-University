import crypto from 'node:crypto';
import type { Express, Response } from 'express';
import { Operations, WorkflowError } from './operations';
import { actorOf } from './identity';
import {ensureStagingAcceptanceStudent} from './stagingAcceptanceStudent';
import {ensureStagingAcademicFixture} from './stagingAcademicFixture';

export function workspacePermissions(role: string) {
  return {
    setup: ['super_admin', 'registrar'].includes(role),
    admissions: ['super_admin', 'registrar', 'admissions_officer'].includes(
      role,
    ),
    registrar: ['super_admin', 'registrar'].includes(role),
    faculty: ['super_admin', 'lecturer', 'dean'].includes(role),
    finance: ['super_admin', 'bursar'].includes(role),
    student: role === 'student',
    alumni: role === 'alumni',
    audit: ['super_admin', 'registrar'].includes(role),
    accounts: role === 'super_admin',
  };
}
export function installWorkspaces(app: Express, store: Operations) {
  const state = (res: Response) => {
    const actor = actorOf(res)!;
    const permission = workspacePermissions(actor.role);
    const own = store.one('SELECT * FROM students WHERE user_id=?', actor.id);
    const studentScope =
      permission.registrar || permission.finance
        ? '1=1'
        : permission.faculty
          ? 'EXISTS(SELECT 1 FROM registrations r JOIN sections z ON r.section_id=z.id WHERE r.student_id=s.id AND z.lecturer_id=?)'
          : 's.user_id=?';
    const scopeParams = studentScope === '1=1' ? [] : [actor.id];
    const students = store
      .all(
        `SELECT s.*,p.title AS program_title FROM students s JOIN programs p ON p.id=s.program_id WHERE ${studentScope} ORDER BY s.full_name`,
        ...scopeParams,
      )
      .map((s) => ({
        ...s,
        balance_cents:
          permission.finance || permission.registrar || s.user_id === actor.id
            ? store.balance(s.id)
            : null,
      }));
    const studentIds = students.map((s) => s.id);
    const marks = studentIds.map(() => '?').join(',') || 'NULL';
    const registrations = store.all(
      `SELECT r.*,s.term_id,s.lecturer_id,c.code AS course_code,c.title AS course_title,c.credits,t.title AS term_title,s.code AS section_code FROM registrations r JOIN sections s ON r.section_id=s.id JOIN courses c ON c.id=s.course_id JOIN terms t ON t.id=s.term_id WHERE r.student_id IN(${marks})${permission.faculty && !permission.registrar ? ' AND s.lecturer_id=?' : ''} ORDER BY r.created_at DESC`,
      ...studentIds,
      ...(permission.faculty && !permission.registrar ? [actor.id] : []),
    );
    const ids = registrations.map((r) => r.id);
    const gradeIds = ids.map(() => '?').join(',') || 'NULL';
    const grades =
      permission.finance && !permission.registrar
        ? []
        : store.all(
            `SELECT * FROM grades WHERE registration_id IN(${gradeIds})${permission.registrar || permission.faculty ? '' : " AND status='published'"}`,
            ...ids,
          );
    const financeAllowed = permission.finance || permission.registrar || !!own;
    const invoices = financeAllowed
      ? store
          .all(
            `SELECT i.*,s.full_name,s.student_number,t.title AS term_title FROM invoices i JOIN students s ON i.student_id=s.id JOIN terms t ON i.term_id=t.id WHERE i.student_id IN(${marks}) ORDER BY i.created_at DESC`,
            ...studentIds,
          )
          .map((i) => ({ ...i, balance_cents: store.invoiceBalance(i.id) }))
      : [];
    const invoiceIds = invoices.map((i) => i.id);
    const invoiceMarks = invoiceIds.map(() => '?').join(',') || 'NULL';
    const payments = financeAllowed
      ? store.all(
          `SELECT p.*,i.number AS invoice_number,s.full_name FROM payments p JOIN invoices i ON p.invoice_id=i.id JOIN students s ON i.student_id=s.id WHERE p.invoice_id IN(${invoiceMarks}) ORDER BY p.created_at DESC`,
          ...invoiceIds,
        )
      : [];
    const transcripts = permission.registrar
      ? store.all(
          'SELECT t.*,s.full_name FROM transcript_requests t JOIN students s ON t.student_id=s.id ORDER BY t.created_at DESC',
        )
      : own
        ? store.all(
            'SELECT * FROM transcript_requests WHERE student_id=? ORDER BY created_at DESC',
            own.id,
          )
        : [];
    const graduation = permission.registrar
      ? store.all(
          'SELECT g.*,s.full_name,s.student_number FROM graduation_reviews g JOIN students s ON g.student_id=s.id ORDER BY g.created_at DESC',
        )
      : own
        ? store.all(
            'SELECT * FROM graduation_reviews WHERE student_id=?',
            own.id,
          )
        : [];
    const users = store
      .users()
      .filter((u) => !['student', 'alumni'].includes(actor.role) || u.id === actor.id || !['student', 'alumni'].includes(u.role))
      .map((u) =>
        permission.accounts || permission.registrar
          ? u
          : { id: u.id, name: u.name, role: u.role },
      );
    return {
      actor,
      permissions: permission,
      users,
      programs: store.all('SELECT * FROM programs ORDER BY code'),
      terms: store.all('SELECT * FROM terms ORDER BY start_date DESC'),
      courses: store.all('SELECT * FROM courses ORDER BY code'),
      prerequisites: store.all('SELECT * FROM course_prerequisites'),
      requirements: store.all('SELECT * FROM program_requirements'),
      sections: store.all(
        "SELECT s.*,c.code AS course_code,c.title AS course_title,c.credits,t.title AS term_title,t.status AS term_status,u.name AS lecturer_name,(SELECT COUNT(*) FROM registrations r WHERE r.section_id=s.id AND r.status='enrolled') AS enrolled FROM sections s JOIN courses c ON c.id=s.course_id JOIN terms t ON t.id=s.term_id JOIN users u ON u.id=s.lecturer_id ORDER BY t.start_date DESC,c.code",
      ),
      applications: permission.admissions
        ? store.all(
            'SELECT a.*,p.title AS program_title FROM applications a JOIN programs p ON a.program_id=p.id ORDER BY a.created_at DESC',
          )
        : [],
      students,
      ownStudent: own ? { ...own, balance_cents: store.balance(own.id) } : null,
      registrations,
      grades,
      invoices,
      payments,
      invoiceLines: financeAllowed
        ? store.all(
            `SELECT * FROM invoice_lines WHERE invoice_id IN(${invoiceMarks})`,
            ...invoiceIds,
          )
        : [],
      creditNotes: financeAllowed
        ? store.all(
            `SELECT * FROM credit_notes WHERE invoice_id IN(${invoiceMarks})`,
            ...invoiceIds,
          )
        : [],
      gradeSchemes: permission.registrar
        ? store.all('SELECT * FROM grade_schemes ORDER BY approved_at DESC')
        : [],
      graduation: graduation.map((g) => ({
        ...g,
        eligibility: store.eligibility(g.student_id),
      })),
      transcripts,
      eligibility: own ? store.eligibility(own.id) : null,
      alumniProfile:
        store.one('SELECT * FROM alumni_profiles WHERE user_id=?', actor.id) ||
        null,
      tasks: store.all(
        'SELECT t.*,u.name AS assignee_name FROM tasks t JOIN users u ON t.assignee_id=u.id WHERE t.assignee_id=? OR t.created_by=? OR ? ORDER BY t.created_at DESC',
        actor.id,
        actor.id,
        permission.registrar ? 1 : 0,
      ),
      audit: permission.audit
        ? store.all(
            'SELECT a.*,u.name AS actor_name FROM audit a LEFT JOIN users u ON a.actor_id=u.id ORDER BY a.created_at DESC,a.rowid DESC LIMIT 300',
          )
        : store.all(
            // Non-auditor roles must never receive before_json/after_json snapshots.
            'SELECT id,action,entity,created_at FROM audit WHERE actor_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30',
            actor.id,
          ),
      storage: { engine: 'SQLite', schemaVersion: 1, singleInstance: true },
      counts: {
        programs: store.one('SELECT COUNT(*) AS n FROM programs').n,
        courses: store.one('SELECT COUNT(*) AS n FROM courses').n,
        students:
          permission.registrar || permission.finance
            ? store.one(
                "SELECT COUNT(*) AS n FROM students WHERE status='active'",
              ).n
            : students.length,
        sections: store.one('SELECT COUNT(*) AS n FROM sections').n,
      },
    };
  };
  // Recipient scope is always taken from the authenticated server session.
  app.get('/api/notifications', (_req, res) => {
    const actor = actorOf(res);
    if (!actor) return res.sendStatus(401);
    try {
      const notifications = store.notificationsFor(actor);
      return res.json({ notifications, unreadCount: notifications.filter(n => !n.read_at).length });
    } catch {
      return res.status(500).json({ error: 'Notifications are temporarily unavailable.' });
    }
  });
  app.patch('/api/notifications/:id/read', (req, res) => {
    const actor = actorOf(res);
    if (!actor) return res.sendStatus(401);
    try {
      return res.json(store.readNotification(actor, req.params.id));
    } catch (e: any) {
      return res.status(e instanceof WorkflowError ? e.status : 500).json({
        error: e instanceof WorkflowError ? e.message : 'Unable to update notification.'
      });
    }
  });
  app.post('/api/notifications/read-all', (_req, res) => {
    const actor = actorOf(res);
    if (!actor) return res.sendStatus(401);
    try { return res.json(store.readAllNotifications(actor)); }
    catch { return res.status(500).json({ error: 'Unable to update notifications.' }); }
  });

  app.get('/api/workspaces/student-activity', (_req, res) => {
    const actor = actorOf(res);
    if (!actor || actor.role !== 'student')
      return res.status(403).json({ error: 'Student account required.' });
    try {
      // Deliberately narrow: no raw audit snapshots and no staff/internal records.
      // This is a history of the student's OWN actions, not a general activity feed.
      const activities = store.all(
        "SELECT id,action,created_at FROM audit WHERE actor_id=? AND action IN ('register','drop','graduationRequest','transcriptRequest') ORDER BY created_at DESC,rowid DESC LIMIT 40",
        actor.id,
      );
      return res.json({ activities });
    } catch {
      return res.status(500).json({ error: 'Activity history unavailable.' });
    }
  });

  app.get('/api/workspaces/state', (_req, res) => {
    try {
      return res.json(state(res));
    } catch {
      return res
        .status(500)
        .json({ error: 'Could not load workspace records.' });
    }
  });
  const stagingRequest=(req:any)=>{
    const requestHost=String(req.hostname||req.get?.('host')||'').toLowerCase().split(':')[0];
    let configuredHost='';
    try{configuredHost=new URL(process.env.APP_URL||'https://invalid.local').hostname.toLowerCase();}catch{}
    return requestHost==='hiau-staging.totag.network'||configuredHost==='hiau-staging.totag.network';
  };
  app.post('/api/workspaces/staging-student-self-link',(req,res)=>{
    const actor=actorOf(res);
    if(!actor||actor.role!=='student')
      return res.status(403).json({error:'Student authorization required.'});
    const requestHost=String(req.hostname||req.get?.('host')||'').toLowerCase().split(':')[0];
    if(requestHost!=='hiau-staging.totag.network')
      return res.status(404).json({error:'Staging acceptance utility is unavailable.'});
    if(!/^\s*MICHAEL\s+GWOAH\s*$/i.test(actor.name||''))
      return res.status(403).json({error:'This staging acceptance action is restricted to the designated test student.'});
    try{
      let result=ensureStagingAcceptanceStudent(store,store.users(),{
        requestHost,accountId:actor.id,auditActor:actor,
      });
      let academicFixture:any=null;
      if(!result.linked&&result.reason==='no-open-term-with-sections'){
        academicFixture=ensureStagingAcademicFixture(store,store.users(),{
          requestHost,auditActor:actor,
        });
        if(academicFixture.ready){
          result=ensureStagingAcceptanceStudent(store,store.users(),{
            requestHost,accountId:actor.id,auditActor:actor,
          });
        }
      }
      if(!result.linked){
        const messages:Record<string,string>={
          'no-open-term-with-sections':academicFixture?.reason==='no-staff-instructor'
            ?'The staging term could not be prepared because no authorized staff instructor account is available.'
            :'The staging academic term and course sections could not be prepared.',
          'email-linked-to-other-account':'This email is already attached to a different student record.',
          'michael-account-not-found':'The designated MICHAEL GWOAH Student account was not found.',
        };
        return res.status(409).json({
          error:messages[result.reason]||'The staging student record could not be linked.',
          result,academicFixture,
        });
      }
      return res.status(result.created?201:200).json({
        success:true,result,academicFixture,
        message:result.created
          ?(academicFixture?.created
            ?'Staging acceptance term, course sections and student record were prepared and linked. Refreshing your Student Workspace now.'
            :'Staging test student record created and linked. Refreshing your Student Workspace now.')
          :'Your staging Student account is already linked.',
      });
    }catch(error:any){
      return res.status(error instanceof WorkflowError?error.status:500).json({
        error:error instanceof WorkflowError?error.message:'Could not complete the staging student link.',
      });
    }
  });
  // Explicit staging-only acceptance fixture. This is intentionally NOT part
  // of the production admissions workflow. It creates no grades, registration,
  // invoice, aid, payment or credit records and is hard-blocked outside the
  // HIAU staging hostname.
  app.get('/api/workspaces/staging-student-setup',(req,res)=>{
    const actor=actorOf(res);
    if(!actor||actor.role!=='super_admin')return res.status(403).json({error:'Super Administrator authorization required.'});
    if(!stagingRequest(req))return res.status(404).json({error:'Staging acceptance utility is unavailable.'});
    const linked=new Set(store.all('SELECT user_id FROM students WHERE user_id IS NOT NULL').map((r:any)=>r.user_id));
    const accounts=store.users().filter(u=>u.role==='student'&&!linked.has(u.id)).map(u=>({
      id:u.id,name:u.name,email:u.email,
    }));
    const programs=store.all('SELECT id,code,title FROM programs ORDER BY code');
    const terms=store.all("SELECT id,code,title,start_date,end_date,status,max_credits FROM terms WHERE status='open' ORDER BY start_date DESC");
    return res.json({accounts,programs,terms});
  });
  app.post('/api/workspaces/staging-student-setup',(req,res)=>{
    const actor=actorOf(res);
    if(!actor||actor.role!=='super_admin')return res.status(403).json({error:'Super Administrator authorization required.'});
    if(!stagingRequest(req))return res.status(404).json({error:'Staging acceptance utility is unavailable.'});
    const accountId=typeof req.body?.accountId==='string'?req.body.accountId:'';
    const programId=typeof req.body?.programId==='string'?req.body.programId:'';
    const termId=typeof req.body?.termId==='string'?req.body.termId:'';
    if(!/^[a-f0-9-]{36}$/i.test(accountId)||!/^[a-f0-9-]{36}$/i.test(programId)||!/^[a-f0-9-]{36}$/i.test(termId))
      return res.status(400).json({error:'Choose an existing student login, program and open term.'});
    try{
      const result=store.transaction(()=>{
        const account=store.one("SELECT id,name,email,role FROM users WHERE id=? AND role='student'",accountId);
        const program=store.one('SELECT id,code,title FROM programs WHERE id=?',programId);
        const term=store.one("SELECT id,code,title,status FROM terms WHERE id=? AND status='open'",termId);
        if(!account||!program||!term)throw new WorkflowError('Selected account, program or open term is no longer available.',409);
        if(store.one('SELECT id FROM students WHERE user_id=? OR email=? COLLATE NOCASE',account.id,account.email))
          throw new WorkflowError('This student login or email is already linked to an academic record.',409);
        const applicationId=crypto.randomUUID(),studentId=crypto.randomUUID();
        const suffix=crypto.randomBytes(3).toString('hex').toUpperCase();
        const year=new Date().getUTCFullYear();
        const studentNumber=`HIAU-STG-${year}-${suffix}`;
        const applicationNumber=`STG-APP-${suffix}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
        const stamp=new Date().toISOString();
        const note='STAGING TEST ONLY — admitted academic record created for authenticated end-to-end Student PWA acceptance.';
        store.run(`INSERT INTO applications
          (id,number,full_name,email,phone,program_id,status,decision_note,created_at,updated_at)
          VALUES(?,?,?,?,?,?,'admitted',?,?,?)`,
          applicationId,applicationNumber,account.name,account.email,'STAGING TEST',program.id,note,stamp,stamp);
        store.run(`INSERT INTO students
          (id,user_id,application_id,student_number,full_name,email,program_id,admitted_term_id,status,financial_hold,created_at)
          VALUES(?,?,?,?,?,?,?,?, 'active',0,?)`,
          studentId,account.id,applicationId,studentNumber,account.name,account.email,program.id,term.id,stamp);
        store.audit(actor,'STAGING_TEST_STUDENT_LINK','student',null,{
          studentId,userId:account.id,studentNumber,email:account.email,programId:program.id,termId:term.id,
          testData:true,
        });
        return {studentId,studentNumber,fullName:account.name,email:account.email,
          programTitle:program.title,termTitle:term.title,status:'active',testData:true};
      });
      return res.status(201).json({success:true,student:result,
        message:'Staging test student record created and linked. No grades, registrations, invoices or payments were created.'});
    }catch(error:any){
      return res.status(error instanceof WorkflowError?error.status:500).json({
        error:error instanceof WorkflowError?error.message:'Could not create the staging test student record. No partial change was saved.',
      });
    }
  });

  // Registrar-controlled linking of an EXISTING admitted academic record to
  // an activated student identity. Do not create a record or invent admission.
  app.get('/api/workspaces/student-links', (_req,res)=>{
    const actor=actorOf(res);
    if(!actor||!workspacePermissions(actor.role).registrar)
      return res.status(403).json({error:'Registrar authorization required.'});
    const students=store.all(`SELECT s.id,s.student_number,s.full_name,s.email,s.user_id,
      a.status AS application_status FROM students s
      JOIN applications a ON a.id=s.application_id
      WHERE s.user_id IS NULL ORDER BY s.full_name LIMIT 100`);
    const accounts=store.users().filter(u=>u.role==='student').map(u=>({
      id:u.id,name:u.name,email:u.email
    }));
    return res.json({students,accounts});
  });
  app.post('/api/workspaces/student-links', (req,res)=>{
    const actor=actorOf(res);
    if(!actor||!workspacePermissions(actor.role).registrar)
      return res.status(403).json({error:'Registrar authorization required.'});
    const studentId=req.body?.studentId,userId=req.body?.studentAccountId;
    if(typeof studentId!=='string'||typeof userId!=='string'||
       !/^[a-f0-9-]{36}$/.test(studentId)||!/^[a-f0-9-]{36}$/.test(userId))
      return res.status(400).json({error:'Select an existing student record and student account.'});
    try{
      const result=store.transaction(()=>{
        const record=store.one(`SELECT s.*,a.status AS admission_status
          FROM students s JOIN applications a ON a.id=s.application_id WHERE s.id=?`,studentId);
        const account=store.one('SELECT id,email,role FROM users WHERE id=?',userId);
        if(!record||!account)return {error:'Student record or account was not found.',status:404};
        if(record.admission_status!=='admitted'||record.user_id!==null||account.role!=='student')
          return {error:'Only an admitted, unlinked student record can be linked to a student-role account.',status:409};
        if(record.email.trim().toLowerCase()!==account.email.trim().toLowerCase())
          return {error:'Email addresses do not match. Refer this identity discrepancy to the Registrar.',status:409};
        if(store.one('SELECT id FROM students WHERE user_id=?',userId))
          return {error:'This student login is already linked to an academic record.',status:409};
        const update=store.run('UPDATE students SET user_id=? WHERE id=? AND user_id IS NULL',userId,studentId);
        if(update.changes!==1)return {error:'Student record changed during linking. Refresh and retry.',status:409};
        store.audit(actor,'STUDENT_IDENTITY_LINK',studentId,
          {linked:false},{linked:true,userId,studentNumber:record.student_number});
        return {studentNumber:record.student_number,linked:true};
      });
      if('error' in result)return res.status(result.status ?? 400).json({error:result.error});
      return res.json(result);
    }catch{
      return res.status(500).json({error:'Could not complete the link. No record was changed.'});
    }
  });
  app.post('/api/workspaces/action', (req, res) => {
    try {
      const result = store.execute(
        actorOf(res)!,
        req.body.action,
        req.body.data || {},
      );
      return res.json({ success: true, result });
    } catch (error: any) {
      if (error instanceof WorkflowError)
        return res.status(error.status).json({ error: error.message });
      if (/UNIQUE constraint/.test(error.message || ''))
        return res
          .status(409)
          .json({
            error:
              'A record with that identifier already exists. No changes were committed.',
          });
      if (/FOREIGN KEY constraint/.test(error.message || ''))
        return res
          .status(400)
          .json({
            error:
              'A referenced record does not exist. Refresh the workspace and choose a valid record.',
          });
      return res
        .status(500)
        .json({
          error:
            'The transaction could not be committed. No partial changes were saved.',
        });
    }
  });
  app.get('/api/workspaces/transcript/:id', (req, res) => {
    try {
      const actor = actorOf(res)!;
      if (
        !['super_admin', 'registrar', 'student', 'alumni'].includes(actor.role)
      )
        throw new WorkflowError('Not authorized.', 403);
      const student = store.studentFor(actor, req.params.id);
      const rows = store.all(
        "SELECT c.code,c.title,c.credits,t.title AS term,g.score,g.letter,g.points,g.passed,g.updated_at FROM grades g JOIN registrations r ON g.registration_id=r.id JOIN sections s ON r.section_id=s.id JOIN courses c ON s.course_id=c.id JOIN terms t ON s.term_id=t.id WHERE r.student_id=? AND r.status='enrolled' AND g.status='published' ORDER BY t.start_date,c.code",
        student.id,
      );
      return res.json({
        student,
        program: store.one(
          'SELECT * FROM programs WHERE id=?',
          student.program_id,
        ),
        grades: rows,
        eligibility: store.eligibility(student.id),
        issuedRequests: store.all(
          "SELECT id,created_at,note FROM transcript_requests WHERE student_id=? AND status='issued'",
          student.id,
        ),
      });
    } catch (e: any) {
      return res
        .status(e.status || 400)
        .json({ error: e.message || 'Could not load academic record.' });
    }
  });
}
