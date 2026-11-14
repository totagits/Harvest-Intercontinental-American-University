import type {Express,Response,Request} from 'express';
import express from 'express';
import crypto from 'node:crypto';
import {Operations} from './operations';
import {actorOf} from './identity';
import {sectionSetupComplete,sectionSetupIssue} from './sectionDelivery';

const now=()=>new Date().toISOString();
const uuid=/^[a-f0-9-]{36}$/i;
const STAGING_HOST='hiau-staging.totag.network';
const parseIds=(value:string)=>{try{const x=JSON.parse(value);return Array.isArray(x)?x.filter(v=>typeof v==='string'):[];}catch{return [];}};
const semesterWeek=(start:string)=>{
 const startMs=Date.parse(start+'T00:00:00Z');
 if(!Number.isFinite(startMs))return 99;
 return Math.max(1,Math.floor((Date.now()-startMs)/(7*86400000))+1);
};
const refundRate=(week:number)=>week<=2?1:week<=4?0.5:0;

export function installStudentAddDrop(app:Express,store:Operations){
 store.run(`CREATE TABLE IF NOT EXISTS student_add_drop_requests(
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id),
  term_id TEXT NOT NULL REFERENCES terms(id),
  add_section_ids TEXT NOT NULL DEFAULT '[]',
  drop_registration_ids TEXT NOT NULL DEFAULT '[]',
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN('submitted','approved','returned','rejected','committed')),
  reviewer_note TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  committed_by TEXT REFERENCES users(id),
  committed_at TEXT,
  dropped_credit_cents INTEGER NOT NULL DEFAULT 0,
  added_unbilled_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
 )`);
 store.run('CREATE INDEX IF NOT EXISTS add_drop_review_queue ON student_add_drop_requests(status,created_at)');
 store.run(`CREATE TABLE IF NOT EXISTS student_add_drop_carts(
  student_id TEXT NOT NULL REFERENCES students(id),
  term_id TEXT NOT NULL REFERENCES terms(id),
  add_section_ids TEXT NOT NULL DEFAULT '[]',
  drop_registration_ids TEXT NOT NULL DEFAULT '[]',
  reason TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY(student_id,term_id)
 )`);

 const studentFor=(res:Response)=>{
  const actor=actorOf(res);
  if(!actor||actor.role!=='student')return null;
  return store.one('SELECT * FROM students WHERE user_id=?',actor.id);
 };
 const registrar=(res:Response)=>['super_admin','registrar'].includes(actorOf(res)?.role||'');
 const finance=(res:Response)=>['super_admin','bursar','registrar'].includes(actorOf(res)?.role||'');

 const ensureStagingSection=(req:Request,res:Response)=>{
  const host=String(req.hostname||req.get('host')||'').toLowerCase().split(':')[0];
  if(host!==STAGING_HOST)return;
  const program=store.one("SELECT * FROM programs WHERE code='STG-ACCEPT'");
  const term=store.one("SELECT * FROM terms WHERE code='STG-2026-A'");
  if(!program||!term)return;
  let course=store.one("SELECT * FROM courses WHERE code='STG-104'");
  let created=false;
  if(!course){
   const id=crypto.randomUUID(),stamp=now();
   store.run('INSERT INTO courses(id,code,title,credits,fee_cents,created_at) VALUES(?,?,?,?,?,?)',
    id,'STG-104','Applied Digital Collaboration',3,15000,stamp);
   course=store.one('SELECT * FROM courses WHERE id=?',id);created=true;
  }
  store.run('INSERT OR IGNORE INTO program_requirements(program_id,course_id) VALUES(?,?)',program.id,course.id);
  let section=store.one("SELECT * FROM sections WHERE course_id=? AND term_id=? AND code='A'",course.id,term.id);
  if(!section){
   const instructor=store.one("SELECT id FROM users WHERE role IN('super_admin','dean','lecturer') ORDER BY CASE role WHEN 'lecturer' THEN 0 WHEN 'dean' THEN 1 ELSE 2 END LIMIT 1");
   if(!instructor)return;
   const id=crypto.randomUUID();
   store.run(`INSERT INTO sections(id,course_id,term_id,lecturer_id,code,capacity,delivery_mode,location,classroom,online_classroom,schedule,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,id,course.id,term.id,instructor.id,'A',20,'hybrid','HIAU Staging','Room 104','HIAU Online Classroom — STG-104','Tue/Thu 14:00–15:30',now());
   created=true;
  }
  if(created)store.audit(actorOf(res)||'system','STAGING_ADD_DROP_SECTION_READY','section',null,{courseCode:'STG-104',termCode:'STG-2026-A',testData:true});
 };

 const validate=(student:any,termId:string,addIds:string[],dropIds:string[])=>{
  if(!uuid.test(termId)||addIds.length+dropIds.length<1||addIds.length>10||dropIds.length>10||
    !addIds.every(id=>uuid.test(id))||!dropIds.every(id=>uuid.test(id))||
    new Set(addIds).size!==addIds.length||new Set(dropIds).size!==dropIds.length)
   return {error:'Choose valid unique course additions or drops.'};
  const term=store.one('SELECT * FROM terms WHERE id=?',termId);
  if(!term||term.status!=='open')return {error:'Add/Drop is not open for this academic term.'};
  if(student.status!=='active')return {error:'Only an active student can submit Add/Drop changes.'};
  if(addIds.length&&student.financial_hold)return {error:'New course additions are blocked while a financial hold is active.'};

  const current=store.all(`SELECT r.id AS registration_id,r.section_id,r.status,s.term_id,s.course_id,s.capacity,
    c.code AS course_code,c.title AS course_title,c.credits,c.fee_cents
    FROM registrations r JOIN sections s ON s.id=r.section_id JOIN courses c ON c.id=s.course_id
    WHERE r.student_id=? AND s.term_id=? AND r.status='enrolled'`,student.id,termId);
  const dropSet=new Set(dropIds);
  for(const id of dropIds){
   const row=current.find((r:any)=>r.registration_id===id);
   if(!row)return {error:'A selected drop is not an active registration in this term.'};
   if(store.one("SELECT id FROM grades WHERE registration_id=? AND status='published'",id))
    return {error:'A course with a published grade cannot be changed through Add/Drop.'};
  }

  const additions=addIds.length?store.all(`SELECT s.*,c.code AS course_code,c.title AS course_title,c.credits,c.fee_cents
    FROM sections s JOIN courses c ON c.id=s.course_id WHERE s.id IN (${addIds.map(()=>'?').join(',')})`,...addIds):[];
  if(additions.length!==addIds.length||additions.some((s:any)=>s.term_id!==termId))
   return {error:'Every added section must belong to the selected open term.'};

  const remaining=current.filter((r:any)=>!dropSet.has(r.registration_id));
  const courseIds=new Set(remaining.map((r:any)=>r.course_id));
  for(const section of additions){
   const setupIssue=sectionSetupIssue(section);
   if(setupIssue)return {error:`${section.course_code} is not available because its section setup is incomplete: ${setupIssue}`};
   if(!store.one('SELECT 1 AS ok FROM program_requirements WHERE program_id=? AND course_id=?',student.program_id,section.course_id))
    return {error:`${section.course_code} is not currently approved for this student's academic program.`};
   if(courseIds.has(section.course_id))return {error:'The resulting schedule cannot contain duplicate registrations for the same course.'};
   courseIds.add(section.course_id);
   const enrolled=store.one("SELECT COUNT(*) AS n FROM registrations WHERE section_id=? AND status='enrolled'",section.id);
   if(enrolled.n>=section.capacity)return {error:`${section.course_code} is already at capacity.`};
   const prereqs=store.all('SELECT requires_id FROM course_prerequisites WHERE course_id=?',section.course_id);
   for(const p of prereqs){
    const passed=store.one(`SELECT g.id FROM grades g JOIN registrations r ON r.id=g.registration_id
      JOIN sections s ON s.id=r.section_id WHERE r.student_id=? AND s.course_id=?
      AND g.status='published' AND g.passed=1`,student.id,p.requires_id);
    if(!passed)return {error:`${section.course_code} has an unfulfilled prerequisite.`};
   }
  }
  const resultingCredits=[...remaining,...additions].reduce((sum:any,row:any)=>sum+Number(row.credits||0),0);
  if(resultingCredits>term.max_credits)return {error:`The resulting schedule exceeds the ${term.max_credits}-credit term limit.`};
  if(resultingCredits<1)return {error:'At least one active course must remain after Add/Drop.'};
  const week=semesterWeek(term.start_date),rate=refundRate(week);
  let estimatedDropCredit=0;
  for(const row of current.filter((r:any)=>dropSet.has(r.registration_id))){
   const line=store.one('SELECT amount_cents FROM invoice_lines WHERE registration_id=?',row.registration_id);
   if(line)estimatedDropCredit+=Math.round(line.amount_cents*rate);
  }
  const addedUnbilled=additions.reduce((sum:number,row:any)=>sum+Number(row.credits)*Number(row.fee_cents),0);
  return {term,current,additions,resultingCredits,underloadWarning:resultingCredits<12,
    week,refundPercent:Math.round(rate*100),estimatedDropCredit,addedUnbilled};
 };

 app.get('/api/student/add-drop',(req,res)=>{
  const actor=actorOf(res);if(!actor)return res.sendStatus(401);
  ensureStagingSection(req,res);
  if(actor.role==='student'){
   const student=studentFor(res);
   if(!student)return res.json({linked:false,terms:[],sections:[],registrations:[],requests:[]});
   const terms=store.all("SELECT id,title,status,max_credits,start_date,end_date FROM terms WHERE status='open' ORDER BY start_date");
   const sectionRows=store.all(`SELECT s.id,s.term_id,s.code,s.capacity,s.delivery_mode,s.location,s.classroom,
      CASE WHEN EXISTS(
        SELECT 1 FROM registrations ownr
        WHERE ownr.student_id=? AND ownr.section_id=s.id AND ownr.status='enrolled'
      ) THEN s.online_classroom ELSE '' END AS online_classroom,
      CASE WHEN lower(trim(s.online_classroom)) NOT IN ('','tba','tbd','to be announced','to be determined','not assigned','not configured','n/a','na','-','—') THEN 1 ELSE 0 END AS has_online_classroom,
      s.schedule,s.lecturer_id,
      c.id AS course_id,c.code AS course_code,c.title AS course_title,c.credits,
      u.name AS lecturer_name,
      (SELECT COUNT(*) FROM registrations r WHERE r.section_id=s.id AND r.status='enrolled') AS enrolled_count,
      EXISTS(SELECT 1 FROM program_requirements pr WHERE pr.program_id=? AND pr.course_id=c.id) AS program_eligible
    FROM sections s JOIN courses c ON c.id=s.course_id JOIN terms t ON t.id=s.term_id
    LEFT JOIN users u ON u.id=s.lecturer_id
    WHERE t.status='open' ORDER BY c.code,s.code`,student.id,student.program_id);
   const sections=sectionRows.map((row:any)=>{
    const source=store.one('SELECT delivery_mode,location,classroom,online_classroom FROM sections WHERE id=?',row.id);
    return {...row,setup_complete:sectionSetupComplete(source)?1:0,setup_issue:sectionSetupIssue(source)||''};
   });
   const registrations=store.all(`SELECT r.id AS registration_id,r.section_id,s.term_id,c.id AS course_id,
      c.code AS course_code,c.title AS course_title,c.credits,s.schedule,s.delivery_mode,s.location,s.classroom,s.online_classroom,u.name AS lecturer_name
    FROM registrations r JOIN sections s ON s.id=r.section_id JOIN courses c ON c.id=s.course_id
    LEFT JOIN users u ON u.id=s.lecturer_id
    WHERE r.student_id=? AND r.status='enrolled' ORDER BY c.code`,student.id);
   const requests=store.all(`SELECT * FROM student_add_drop_requests WHERE student_id=? ORDER BY created_at DESC`,student.id)
    .map((r:any)=>({...r,addSectionIds:parseIds(r.add_section_ids),dropRegistrationIds:parseIds(r.drop_registration_ids)}));
   const carts=store.all(`SELECT * FROM student_add_drop_carts WHERE student_id=? ORDER BY updated_at DESC`,student.id)
    .map((r:any)=>({...r,addSectionIds:parseIds(r.add_section_ids),dropRegistrationIds:parseIds(r.drop_registration_ids)}));
   return res.json({linked:true,terms,sections,registrations,requests,carts});
  }
  if(!registrar(res))return res.sendStatus(403);
  const requests=store.all(`SELECT a.*,s.student_number,s.full_name,t.title AS term_title
    FROM student_add_drop_requests a JOIN students s ON s.id=a.student_id JOIN terms t ON t.id=a.term_id
    WHERE a.status IN('submitted','approved') ORDER BY a.created_at`).map((r:any)=>{
     const addSectionIds=parseIds(r.add_section_ids),dropRegistrationIds=parseIds(r.drop_registration_ids);
     const adds=addSectionIds.map((id:string)=>store.one(`SELECT s.id,c.code,c.title,c.credits FROM sections s JOIN courses c ON c.id=s.course_id WHERE s.id=?`,id)).filter(Boolean);
     const drops=dropRegistrationIds.map((id:string)=>store.one(`SELECT r.id,c.code,c.title,c.credits FROM registrations r JOIN sections s ON s.id=r.section_id JOIN courses c ON c.id=s.course_id WHERE r.id=?`,id)).filter(Boolean);
     const student=store.one('SELECT * FROM students WHERE id=?',r.student_id);
     const check=student?validate(student,r.term_id,addSectionIds,dropRegistrationIds):{error:'Student record unavailable.'};
     const currentCredits=Array.isArray((check as any).current)
      ? (check as any).current.reduce((sum:number,row:any)=>sum+Number(row.credits||0),0) : null;
     const addCredits=adds.reduce((sum:number,row:any)=>sum+Number(row.credits||0),0);
     const dropCredits=drops.reduce((sum:number,row:any)=>sum+Number(row.credits||0),0);
     return {
      ...r,addSectionIds,dropRegistrationIds,adds,drops,
      reviewSummary:'error'in check?{valid:false,error:check.error}:{valid:true,currentCredits,addCredits,dropCredits,
       resultingCredits:check.resultingCredits,underloadWarning:check.underloadWarning,
       addedUnbilledCents:check.addedUnbilled,estimatedDropCreditCents:check.estimatedDropCredit}
     };
    });
  return res.json({requests});
 });

 app.put('/api/student/add-drop/cart',express.json({limit:'12kb'}),(req,res)=>{
  const student=studentFor(res);if(!student)return res.status(403).json({error:'A linked Student account is required.'});
  ensureStagingSection(req,res);
  const termId=req.body?.termId,addIds=req.body?.addSectionIds,dropIds=req.body?.dropRegistrationIds;
  const reason=typeof req.body?.reason==='string'?req.body.reason:'';
  if(typeof termId!=='string'||!uuid.test(termId)||!Array.isArray(addIds)||!Array.isArray(dropIds)||
     addIds.length>10||dropIds.length>10||!addIds.every((id:any)=>typeof id==='string'&&uuid.test(id))||
     !dropIds.every((id:any)=>typeof id==='string'&&uuid.test(id))||
     new Set(addIds).size!==addIds.length||new Set(dropIds).size!==dropIds.length||reason.length>1000)
    return res.status(400).json({error:'Choose valid Add/Drop cart items.'});
  const term=store.one("SELECT id FROM terms WHERE id=? AND status='open'",termId);
  if(!term)return res.status(409).json({error:'The selected academic term is not open.'});
  if(addIds.length){
    const additions=store.all(`SELECT s.*,c.code AS course_code
      FROM sections s JOIN courses c ON c.id=s.course_id
      WHERE s.term_id=? AND s.id IN (${addIds.map(()=>'?').join(',')})`,termId,...addIds);
    if(additions.length!==addIds.length)return res.status(409).json({error:'Every course added to the cart must be an open-term section.'});
    for(const section of additions){
      const setupIssue=sectionSetupIssue(section);
      if(setupIssue)return res.status(409).json({error:`${section.course_code} is not yet available because its section setup is incomplete.`});
      if(!store.one('SELECT 1 AS ok FROM program_requirements WHERE program_id=? AND course_id=?',student.program_id,section.course_id))
        return res.status(409).json({error:`${section.course_code} is not currently approved for your academic program.`});
      if(store.one("SELECT COUNT(*) AS n FROM registrations WHERE section_id=? AND status='enrolled'",section.id).n>=section.capacity)
        return res.status(409).json({error:`${section.course_code} is full and cannot be added to your Add/Drop cart.`});
      if(store.one(`SELECT r.id FROM registrations r JOIN sections s ON s.id=r.section_id
        WHERE r.student_id=? AND r.status='enrolled' AND s.term_id=? AND s.course_id=?`,student.id,termId,section.course_id))
        return res.status(409).json({error:`${section.course_code} is already in your current courses.`});
    }
  }
  if(dropIds.length){
    const n=store.one(`SELECT COUNT(*) AS n FROM registrations r JOIN sections s ON s.id=r.section_id
      WHERE r.student_id=? AND r.status='enrolled' AND s.term_id=? AND r.id IN (${dropIds.map(()=>'?').join(',')})`,
      student.id,termId,...dropIds).n;
    if(n!==dropIds.length)return res.status(409).json({error:'Every drop item must be one of your active courses in this term.'});
  }
  if(!addIds.length&&!dropIds.length&&!reason.trim()){
    store.run('DELETE FROM student_add_drop_carts WHERE student_id=? AND term_id=?',student.id,termId);
    return res.json({saved:true,cleared:true,termId,addSectionIds:[],dropRegistrationIds:[],reason:''});
  }
  store.run(`INSERT INTO student_add_drop_carts(student_id,term_id,add_section_ids,drop_registration_ids,reason,updated_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(student_id,term_id) DO UPDATE SET
    add_section_ids=excluded.add_section_ids,drop_registration_ids=excluded.drop_registration_ids,
    reason=excluded.reason,updated_at=excluded.updated_at`,
    student.id,termId,JSON.stringify(addIds),JSON.stringify(dropIds),reason,now());
  store.audit(actorOf(res)!,'ADD_DROP_CART_UPDATED',student.id,null,{termId,addCount:addIds.length,dropCount:dropIds.length});
  return res.json({saved:true,termId,addSectionIds:addIds,dropRegistrationIds:dropIds,reason});
 });

 app.post('/api/student/add-drop',express.json({limit:'12kb'}),(req,res)=>{
  const student=studentFor(res);if(!student)return res.status(403).json({error:'A linked Student account is required.'});
  ensureStagingSection(req,res);
  const termId=req.body?.termId,addIds=req.body?.addSectionIds,dropIds=req.body?.dropRegistrationIds,reason=req.body?.reason;
  if(typeof termId!=='string'||!Array.isArray(addIds)||!Array.isArray(dropIds)||typeof reason!=='string'||reason.trim().length<20||reason.length>1000)
   return res.status(400).json({error:'Select Add/Drop changes and provide a reason of 20–1,000 characters.'});
  const check=validate(student,termId,addIds,dropIds);if('error'in check)return res.status(409).json({error:check.error});
  const pending=store.one("SELECT id FROM student_add_drop_requests WHERE student_id=? AND term_id=? AND status IN('submitted','approved')",student.id,termId);
  if(pending)return res.status(409).json({error:'An Add/Drop request is already awaiting Registrar action for this term.'});
  const id=crypto.randomUUID(),stamp=now();
  store.run(`INSERT INTO student_add_drop_requests
   (id,student_id,term_id,add_section_ids,drop_registration_ids,reason,status,created_at,updated_at)
   VALUES(?,?,?,?,?,?,'submitted',?,?)`,id,student.id,termId,JSON.stringify(addIds),JSON.stringify(dropIds),reason.trim(),stamp,stamp);
  store.run('DELETE FROM student_add_drop_carts WHERE student_id=? AND term_id=?',student.id,termId);
  store.audit(actorOf(res)!,'ADD_DROP_SUBMITTED',id,null,{studentId:student.id,termId,addCount:addIds.length,dropCount:dropIds.length,resultingCredits:check.resultingCredits});
  return res.status(201).json({id,status:'submitted',resultingCredits:check.resultingCredits,underloadWarning:check.underloadWarning,
   estimatedDropCreditCents:check.estimatedDropCredit,addedUnbilledCents:check.addedUnbilled});
 });

 app.post('/api/student/add-drop/:id/review',express.json({limit:'8kb'}),(req,res)=>{
  if(!registrar(res)||!uuid.test(req.params.id))return res.sendStatus(403);
  const decision=req.body?.decision,note=req.body?.note;
  if(!['approved','returned','rejected'].includes(decision)||typeof note!=='string'||note.trim().length<10||note.length>1200)
   return res.status(400).json({error:'Choose a review decision and enter a note of at least 10 characters.'});
  const request=store.one('SELECT * FROM student_add_drop_requests WHERE id=?',req.params.id);
  if(!request)return res.sendStatus(404);
  if(request.status!=='submitted')return res.status(409).json({error:'Only a submitted Add/Drop request can be reviewed.'});
  const student=store.one('SELECT * FROM students WHERE id=?',request.student_id);
  const check=validate(student,request.term_id,parseIds(request.add_section_ids),parseIds(request.drop_registration_ids));
  if(decision==='approved'&&'error'in check)return res.status(409).json({error:check.error});
  store.run('UPDATE student_add_drop_requests SET status=?,reviewer_note=?,reviewed_by=?,reviewed_at=?,updated_at=? WHERE id=?',
   decision,note.trim(),actorOf(res)!.id,now(),now(),request.id);
  store.audit(actorOf(res)!,'ADD_DROP_REVIEWED',request.id,{status:'submitted'},{status:decision,note:note.trim()});
  return res.json({id:request.id,status:decision});
 });

 app.post('/api/student/add-drop/:id/commit',express.json({limit:'4kb'}),(req,res)=>{
  if(!registrar(res)||!uuid.test(req.params.id))return res.sendStatus(403);
  if(req.body?.confirmation!=='CONFIRM_ADD_DROP')return res.status(400).json({error:'Confirm the approved Add/Drop request before committing registration changes.'});
  try{
   const result=store.transaction(()=>{
    const request=store.one('SELECT * FROM student_add_drop_requests WHERE id=?',req.params.id);
    if(!request)return {error:'Add/Drop request not found.',status:404};
    if(request.status!=='approved')return {error:'Registrar approval is required before Add/Drop can be committed.',status:409};
    const student=store.one('SELECT * FROM students WHERE id=?',request.student_id);
    const addIds=parseIds(request.add_section_ids),dropIds=parseIds(request.drop_registration_ids);
    const check=validate(student,request.term_id,addIds,dropIds);
    if('error'in check)return {error:check.error,status:409};
    let droppedCredit=0;
    for(const registrationId of dropIds){
     store.run("UPDATE registrations SET status='dropped',updated_at=? WHERE id=?",now(),registrationId);
     const line=store.one('SELECT * FROM invoice_lines WHERE registration_id=?',registrationId);
     if(line&&check.refundPercent>0&&!store.one('SELECT id FROM credit_notes WHERE registration_id=?',registrationId)){
      const credit=Math.round(line.amount_cents*(check.refundPercent/100));
      if(credit>0){
       store.run('INSERT INTO credit_notes VALUES(?,?,?,?,?,?,?)',crypto.randomUUID(),line.invoice_id,registrationId,credit,
        `Add/Drop ${check.refundPercent}% tuition adjustment — ${request.reason}`,actorOf(res)!.id,now());
       droppedCredit+=credit;
      }
     }
    }
    const addedRegistrationIds:string[]=[];
    for(const sectionId of addIds){
     const id=crypto.randomUUID();addedRegistrationIds.push(id);
     store.run('INSERT INTO registrations(id,student_id,section_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      id,student.id,sectionId,'enrolled',now(),now());
    }
    store.run(`UPDATE student_add_drop_requests SET status='committed',committed_by=?,committed_at=?,
      dropped_credit_cents=?,added_unbilled_cents=?,updated_at=? WHERE id=?`,
      actorOf(res)!.id,now(),droppedCredit,check.addedUnbilled,now(),request.id);
    store.audit(actorOf(res)!,'ADD_DROP_COMMITTED',request.id,{status:'approved'},
     {status:'committed',studentId:student.id,termId:request.term_id,addSectionIds:addIds,dropRegistrationIds:dropIds,
      addedRegistrationIds,droppedCreditCents:droppedCredit,addedUnbilledCents:check.addedUnbilled,refundPercent:check.refundPercent});
    if(student.user_id)store.notify(student.user_id,'academic','Add/Drop completed',
     'Your approved Add/Drop request has been committed. Review your enrollments and financial statement for any posted adjustments.');
    return {id:request.id,status:'committed',studentId:student.id,termId:request.term_id,
     addedRegistrations:addedRegistrationIds.length,droppedRegistrations:dropIds.length,
     droppedCreditCents:droppedCredit,addedUnbilledCents:check.addedUnbilled,refundPercent:check.refundPercent};
   });
   if('error'in result)return res.status(typeof result.status==='number'?result.status:409).json({error:result.error});
   return res.json(result);
  }catch(error){console.error('Add/Drop commit failed',error);return res.status(500).json({error:'Add/Drop could not be committed; no partial change was saved.'});}
 });

 app.get('/api/student/add-drop/finance',(req,res)=>{
  if(!finance(res))return res.sendStatus(403);
  const rows=store.all(`SELECT a.*,s.student_number,s.full_name,t.title AS term_title
    FROM student_add_drop_requests a JOIN students s ON s.id=a.student_id JOIN terms t ON t.id=a.term_id
    WHERE a.status='committed' ORDER BY a.committed_at DESC LIMIT 100`).map((row:any)=>({
     ...row,
     currentBalanceCents:store.balance(row.student_id),
     unbilledRegistrations:store.all(`SELECT r.id,c.code,c.title,c.credits*c.fee_cents AS amount_cents
      FROM registrations r JOIN sections s ON s.id=r.section_id JOIN courses c ON c.id=s.course_id
      LEFT JOIN invoice_lines l ON l.registration_id=r.id
      WHERE r.student_id=? AND s.term_id=? AND r.status='enrolled' AND l.id IS NULL`,row.student_id,row.term_id),
    }));
  return res.json({items:rows});
 });
}
