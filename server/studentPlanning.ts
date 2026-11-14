import type {Express,Response} from 'express';
import express from 'express';
import crypto from 'node:crypto';
import {Operations} from './operations';
import {actorOf} from './identity';

const now=()=>new Date().toISOString();
type PlanStatus='draft'|'submitted'|'returned'|'approved'|'rejected';
const states=new Set<PlanStatus>(['draft','submitted','returned','approved','rejected']);
const numberPattern=/^[a-f0-9-]{36}$/i;
const inspect=(row:any)=>row?({...row,sectionIds:JSON.parse(row.section_ids)}):null;
export function installStudentPlanning(app:Express,store:Operations){
  store.run(`CREATE TABLE IF NOT EXISTS student_course_plans(
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES students(id),
    term_id TEXT NOT NULL REFERENCES terms(id),
    section_ids TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL CHECK(status IN('draft','submitted','returned','approved','rejected')),
    student_note TEXT NOT NULL DEFAULT '',
    reviewer_note TEXT NOT NULL DEFAULT '',
    reviewed_by TEXT REFERENCES users(id),
    submitted_at TEXT,
    reviewed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(student_id,term_id)
  )`);
  const studentFor=(res:Response)=>{
    const actor=actorOf(res);
    if(!actor||actor.role!=='student')return null;
    return store.one('SELECT * FROM students WHERE user_id=?',actor.id);
  };
  const registrar=(res:Response)=>['super_admin','registrar'].includes(actorOf(res)?.role||'');
  const validateSections=(student:any,termId:string,sectionIds:string[])=>{
    if(!numberPattern.test(termId)||sectionIds.length<1||sectionIds.length>20||
       new Set(sectionIds).size!==sectionIds.length||!sectionIds.every(id=>numberPattern.test(id)))
      return 'Select one to twenty unique term sections.';
    const term=store.one('SELECT * FROM terms WHERE id=?',termId);
    if(!term||term.status!=='open')return 'Course planning is not open for this term.';
    if(student.status!=='active'||student.financial_hold)return 'Student must be active without an academic finance hold.';
    const placeholders=sectionIds.map(()=>'?').join(',');
    const sections=store.all(`SELECT s.*,c.credits,c.code AS course_code,t.max_credits
      FROM sections s JOIN courses c ON c.id=s.course_id JOIN terms t ON t.id=s.term_id
      WHERE s.id IN (${placeholders})`,...sectionIds);
    if(sections.length!==sectionIds.length||sections.some(s=>s.term_id!==termId))
      return 'All chosen sections must belong to the selected term.';
    if(new Set(sections.map(s=>s.course_id)).size!==sections.length)
      return 'The same course cannot be planned twice in one term.';
    const credits=sections.reduce((n,s)=>n+s.credits,0);
    if(credits>term.max_credits)return 'The plan exceeds the term credit maximum.';
    for(const section of sections){
      const registered=store.one(`SELECT r.id FROM registrations r JOIN sections s ON s.id=r.section_id
        WHERE r.student_id=? AND s.term_id=? AND s.course_id=? AND r.status='enrolled'`,
        student.id,termId,section.course_id);
      if(registered)return 'One selected course is already registered for the term.';
      const enrolled=store.one("SELECT count(*) AS n FROM registrations WHERE section_id=? AND status='enrolled'",section.id);
      if(enrolled.n>=section.capacity)return 'A selected section is already at capacity.';
      const prerequisites=store.all('SELECT requires_id FROM course_prerequisites WHERE course_id=?',section.course_id);
      for(const prerequisite of prerequisites){
        const passed=store.one(`SELECT g.id FROM grades g
          JOIN registrations r ON r.id=g.registration_id JOIN sections s ON s.id=r.section_id
          WHERE r.student_id=? AND s.course_id=? AND r.status='enrolled'
            AND g.status='published' AND g.passed=1`,student.id,prerequisite.requires_id);
        if(!passed)return 'A selected course has an unfulfilled prerequisite.';
      }
    }
    return null;
  };
  app.get('/api/student/course-plans',(req,res)=>{
    const actor=actorOf(res);
    if(!actor)return res.sendStatus(401);
    const record=studentFor(res);
    if(actor.role==='student'){
      if(!record)return res.json({plans:[],linked:false,terms:[],sections:[]});
      const plans=store.all(`SELECT p.*,x.created_at AS committed_at
        FROM student_course_plans p LEFT JOIN student_course_plan_commits x ON x.plan_id=p.id
        WHERE p.student_id=? ORDER BY p.updated_at DESC`,record.id).map(inspect);
      const terms=store.all("SELECT id,title,status,max_credits FROM terms WHERE status='open' ORDER BY start_date");
      const sections=store.all(`SELECT s.id,s.term_id,s.code,s.capacity,c.code AS course_code,c.title AS course_title,c.credits
        FROM sections s JOIN terms t ON t.id=s.term_id JOIN courses c ON c.id=s.course_id WHERE t.status='open'`);
      return res.json({plans,linked:true,terms,sections});
    }
    if(!registrar(res))return res.sendStatus(403);
    const plans=store.all(`SELECT p.*,s.student_number,s.full_name,s.email,t.title AS term_title
      FROM student_course_plans p JOIN students s ON p.student_id=s.id
      JOIN terms t ON t.id=p.term_id WHERE p.status IN ('submitted','approved')
      AND NOT EXISTS(SELECT 1 FROM student_course_plan_commits c WHERE c.plan_id=p.id)
      ORDER BY p.submitted_at`).map(inspect);
    return res.json({plans});
  });
  app.post('/api/student/course-plans',express.json({limit:'12kb'}),(req,res)=>{
    const student=studentFor(res);
    if(!student)return res.status(403).json({error:'A linked Student account is required.'});
    const termId=req.body?.termId,ids=req.body?.sectionIds,note=req.body?.note;
    if(typeof termId!=='string'||!Array.isArray(ids)||ids.length>20||
      !ids.every((x:unknown)=>typeof x==='string')||typeof note!=='string'||note.length>1000)
      return res.status(400).json({error:'Select a term, sections and a note (maximum 1,000 characters).'});
    const message=validateSections(student,termId,ids);
    if(message)return res.status(400).json({error:message});
    const actor=actorOf(res)!;
    try{
      const result=store.transaction(()=>{
        const old=store.one('SELECT * FROM student_course_plans WHERE student_id=? AND term_id=?',student.id,termId);
        if(old&&old.status!=='draft'&&old.status!=='returned')
          return {error:'A submitted or decided plan cannot be overwritten.',status:409};
        const time=now(),planId=old?.id??crypto.randomUUID();
        if(old)store.run(`UPDATE student_course_plans SET section_ids=?,student_note=?,status='draft',
          reviewer_note='',reviewed_by=NULL,reviewed_at=NULL,updated_at=? WHERE id=?`,JSON.stringify(ids),note,time,planId);
        else store.run(`INSERT INTO student_course_plans(id,student_id,term_id,section_ids,status,
          student_note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`,
          planId,student.id,termId,JSON.stringify(ids),'draft',note,time,time);
        store.audit(actor,'COURSE_PLAN_DRAFT',planId,null,{studentId:student.id,termId,sectionCount:ids.length});
        return {id:planId,status:'draft'};
      });
      if('error' in result)return res.status(typeof result.status==='number'?result.status:400).json({error:result.error});
      return res.status(201).json(result);
    }catch(error){console.error('Course plan draft persistence failure',error);return res.status(500).json({error:'Could not save course plan.'});}
  });
  app.post('/api/student/course-plans/:id/submit',express.json({limit:'4kb'}),(_req,res)=>{
    const student=studentFor(res);
    if(!student)return res.sendStatus(403);
    const planId=_req.params.id;
    if(!numberPattern.test(planId))return res.sendStatus(404);
    try{
      const result=store.transaction(()=>{
        const plan=store.one('SELECT * FROM student_course_plans WHERE id=? AND student_id=?',planId,student.id);
        if(!plan)return {error:'Plan not found.',status:404};
        if(!['draft','returned'].includes(plan.status))return {error:'Plan has already been submitted or decided.',status:409};
        const problem=validateSections(student,plan.term_id,JSON.parse(plan.section_ids));
        if(problem)return {error:problem,status:409};
        store.run(`UPDATE student_course_plans SET status='submitted',submitted_at=?,updated_at=? WHERE id=?`,now(),now(),planId);
        store.audit(actorOf(res)!,'COURSE_PLAN_SUBMITTED',planId,{status:plan.status},{status:'submitted'});
        return {id:planId,status:'submitted'};
      });
      if('error' in result)return res.status(typeof result.status==='number'?result.status:400).json({error:result.error});
      return res.json(result);
    }catch{return res.status(500).json({error:'Could not submit course plan.'});}
  });
  // Finance can inspect a *registered* cohort, but nothing here bills a
  // student. Invoice posting remains an explicit Bursar operation after the
  // fee schedule has been approved and verified by Finance.
  app.get('/api/student/finance-handoff',(_req,res)=>{
    const role=actorOf(res)?.role;
    if(!['super_admin','bursar','registrar'].includes(role||''))return res.sendStatus(403);
    const rows=store.all(`SELECT x.id AS commit_id,x.plan_id,x.student_id,x.term_id,
      x.created_at AS registered_at,s.student_number,s.full_name,t.title AS term_title,
      COUNT(r.id) AS registered_sections,
      SUM(CASE WHEN l.id IS NULL THEN 1 ELSE 0 END) AS unbilled_sections
      FROM student_course_plan_commits x
      JOIN students s ON s.id=x.student_id JOIN terms t ON t.id=x.term_id
      JOIN student_course_plans p ON p.id=x.plan_id
      JOIN registrations r ON r.student_id=x.student_id AND r.status='enrolled'
        AND r.section_id IN (SELECT value FROM json_each(p.section_ids))
      LEFT JOIN invoice_lines l ON l.registration_id=r.id
      GROUP BY x.id,x.plan_id,x.student_id,x.term_id,x.created_at,s.student_number,s.full_name,t.title
      ORDER BY x.created_at DESC LIMIT 100`);
    return res.json({items:rows,advisory:'Course fees require verified institutional approval; no invoice is generated by this queue.'});
  });
  // ERP-STUDENT-01C: this is a NON-POSTING quote. Course fee fields are
  // existing operational values, not proof of an approved fee schedule.
  // Only a linked, Registrar-committed plan is eligible for Finance review.
  app.get('/api/student/finance-quote/:commitId',(req,res)=>{
    if(!['super_admin','bursar','registrar'].includes(actorOf(res)?.role||''))return res.sendStatus(403);
    if(!numberPattern.test(req.params.commitId))return res.sendStatus(404);
    const commit=store.one(`SELECT x.*,s.student_number,s.full_name,t.title AS term_title,
      p.section_ids FROM student_course_plan_commits x
      JOIN students s ON s.id=x.student_id JOIN terms t ON t.id=x.term_id
      JOIN student_course_plans p ON p.id=x.plan_id WHERE x.id=?`,req.params.commitId);
    if(!commit)return res.status(404).json({error:'Registered course plan was not found.'});
    const lines=store.all(`SELECT r.id AS registration_id,c.code AS course_code,c.title AS course_title,
      c.credits,c.fee_cents AS fee_per_credit_cents,c.credits*c.fee_cents AS line_cents,
      l.invoice_id,i.number AS invoice_number FROM registrations r
      JOIN sections sec ON sec.id=r.section_id JOIN courses c ON c.id=sec.course_id
      LEFT JOIN invoice_lines l ON l.registration_id=r.id
      LEFT JOIN invoices i ON i.id=l.invoice_id
      WHERE r.student_id=? AND r.status='enrolled'
        AND r.section_id IN (SELECT value FROM json_each(?))
      ORDER BY c.code,r.id`,commit.student_id,commit.section_ids);
    const unbilled=lines.filter(line=>!line.invoice_id);
    const quote=unbilled.reduce((sum,line)=>sum+line.line_cents,0);
    return res.json({
      commitId:commit.id,studentNumber:commit.student_number,studentName:commit.full_name,
      term:commit.term_title,currency:'USD',lines,
      unbilledCount:unbilled.length,indicativeUnbilledCents:quote,
      readyForPosting:false,
      notice:'Indicative only: current course fee fields are not an approved institutional fee schedule. No invoice, waiver, scholarship, payment or debt has been created by this preview.'
    });
  });
  // Authenticated student's OWN posted statement. No unposted estimates,
  // draft aid requests, or records belonging to other students are exposed.
  app.get('/api/student/my-statement',(_req,res)=>{
    const actor=actorOf(res);
    if(actor?.role!=='student')return res.sendStatus(403);
    const student=store.one('SELECT id,student_number,full_name FROM students WHERE user_id=?',actor.id);
    if(!student)return res.json({linked:false,currency:'USD',invoices:[],totalBalanceCents:0});
    const invoices=store.all(`SELECT i.id,i.number,i.term_id,i.amount_cents,i.due_date,i.created_at,
      t.title AS term_title FROM invoices i JOIN terms t ON t.id=i.term_id
      WHERE i.student_id=? ORDER BY i.created_at DESC`,student.id).map(invoice=>{
      const lines=store.all(`SELECT l.description,l.amount_cents FROM invoice_lines l
        WHERE l.invoice_id=? ORDER BY l.description`,invoice.id);
      const credits=[
        ...store.all(`SELECT c.amount_cents,c.reason,c.created_at,'credit_note' AS source
          FROM credit_notes c WHERE c.invoice_id=?`,invoice.id),
        ...store.all(`SELECT a.amount_cents,
          CASE a.kind WHEN 'scholarship' THEN 'Scholarship award'
            WHEN 'financial_aid' THEN 'Financial aid award'
            ELSE 'Tuition waiver' END || ' — ' || a.note AS reason,
          a.created_at,'assistance_award' AS source
          FROM student_assistance_awards a WHERE a.invoice_id=?`,invoice.id),
      ].sort((a:any,b:any)=>String(a.created_at).localeCompare(String(b.created_at)));
      const payments=store.all(`SELECT p.reference,p.amount_cents,p.method,p.received_date,
        p.status FROM payments p WHERE p.invoice_id=? ORDER BY p.received_date`,invoice.id);
      return {...invoice,lines,credits,payments,balance_cents:store.invoiceBalance(invoice.id)};
    });
    return res.json({linked:true,studentNumber:student.student_number,currency:'USD',
      invoices,totalBalanceCents:store.balance(student.id)});
  });
  app.post('/api/student/course-plans/:id/register',express.json({limit:'4kb'}),(req,res)=>{
    if(!registrar(res))return res.sendStatus(403);
    const planId=req.params.id;
    if(!numberPattern.test(planId)||req.body?.confirmation!=='CONFIRM_OFFICIAL_REGISTRATION')
      return res.status(400).json({error:'Confirm the exact approved plan before official registration.'});
    try{
      const result=store.transaction(()=>{
        const plan=store.one('SELECT * FROM student_course_plans WHERE id=?',planId);
        if(!plan)return {error:'Approved plan was not found.',status:404};
        if(plan.status!=='approved')return {error:'A reviewed and approved plan is required.',status:409};
        if(store.one('SELECT id FROM student_course_plan_commits WHERE plan_id=?',planId))
          return {error:'This plan has already been officially registered.',status:409};
        const student=store.one('SELECT * FROM students WHERE id=?',plan.student_id);
        if(!student)return {error:'Student record is not available.',status:404};
        const sectionIds:unknown=JSON.parse(plan.section_ids);
        if(!Array.isArray(sectionIds)||!sectionIds.every(x=>typeof x==='string'))
          return {error:'Invalid stored course selections.',status:409};
        // Recheck term window, financial hold, capacity, credits, duplicate
        // registration and prerequisites in a single IMMEDIATE transaction.
        const conflict=validateSections(student,plan.term_id,sectionIds);
        if(conflict)return {error:conflict,status:409};
        const time=now();
        for(const sectionId of sectionIds){
          store.run('INSERT INTO registrations(id,student_id,section_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?)',
            crypto.randomUUID(),student.id,sectionId,'enrolled',time,time);
        }
        const commitId=crypto.randomUUID();
        store.run(`INSERT INTO student_course_plan_commits
          (id,plan_id,student_id,term_id,registered_by,section_count,created_at)
          VALUES(?,?,?,?,?,?,?)`,commitId,planId,student.id,plan.term_id,
          actorOf(res)!.id,sectionIds.length,time);
        store.audit(actorOf(res)!,'COURSE_PLAN_REGISTERED',planId,
          {status:'approved',enrollment:false},
          {status:'approved',enrollment:true,studentId:student.id,termId:plan.term_id,
            sections:sectionIds,commitId});
        if(student.user_id)store.notify(student.user_id,'academic',
          'Course registration confirmed','Your approved course plan has been officially registered. Finance will review any applicable tuition charges.');
        return {planId,commitId,studentId:student.id,termId:plan.term_id,
          registeredSections:sectionIds.length,billingStatus:'awaiting_finance_review'};
      });
      if('error' in result)return res.status(typeof result.status==='number'?result.status:400).json({error:result.error});
      return res.status(201).json(result);
    }catch(error){
      console.error('Registrar course registration failed',error);
      return res.status(500).json({error:'Course registration failed; no partial enrollment was saved.'});
    }
  });
  app.post('/api/student/course-plans/:id/review',express.json({limit:'8kb'}),(req,res)=>{
    if(!registrar(res))return res.sendStatus(403);
    const decision=req.body?.decision,note=req.body?.note;
    if(!['approved','returned','rejected'].includes(decision)||typeof note!=='string'||note.length>1200||
      (decision!=='approved'&&!note.trim())||!numberPattern.test(req.params.id))
      return res.status(400).json({error:'Provide a valid Registrar decision and rationale.'});
    try{
      const result=store.transaction(()=>{
        const plan=store.one('SELECT * FROM student_course_plans WHERE id=?',req.params.id);
        if(!plan)return {error:'Plan not found.',status:404};
        if(plan.status!=='submitted')return {error:'Only submitted plans may be reviewed.',status:409};
        const student=store.one('SELECT * FROM students WHERE id=?',plan.student_id);
        if(decision==='approved'){
          const error=validateSections(student,plan.term_id,JSON.parse(plan.section_ids));
          if(error)return {error,status:409};
        }
        const time=now();
        store.run(`UPDATE student_course_plans SET status=?,reviewer_note=?,reviewed_by=?,reviewed_at=?,updated_at=?
          WHERE id=?`,decision,note,actorOf(res)!.id,time,time,plan.id);
        store.audit(actorOf(res)!,'COURSE_PLAN_REVIEW',plan.id,{status:'submitted'},
          {status:decision,sectionCount:JSON.parse(plan.section_ids).length});
        return {id:plan.id,status:decision};
      });
      if('error' in result)return res.status(typeof result.status==='number'?result.status:400).json({error:result.error});
      return res.json(result);
    }catch{return res.status(500).json({error:'Could not review course plan.'});}
  });
}
