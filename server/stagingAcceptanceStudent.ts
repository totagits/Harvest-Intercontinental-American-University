import crypto from 'node:crypto';
import {Operations,WorkflowError} from './operations';

const STAGING_HOST='hiau-staging.totag.network';

const configuredHost=()=>{
  try{return new URL(process.env.APP_URL||'https://invalid.local').hostname.toLowerCase();}
  catch{return '';}
};

export type StagingAcceptanceStudentResult={
  staging:boolean;
  created:boolean;
  linked:boolean;
  reason:string;
  studentId?:string;
  studentNumber?:string;
  programTitle?:string;
  termTitle?:string;
};

export function ensureStagingAcceptanceStudent(
  store:Operations,
  accounts:any[],
  options:{requestHost?:string;accountId?:string;auditActor?:any}={},
):StagingAcceptanceStudentResult{
  const activeHost=(options.requestHost||configuredHost()).toLowerCase().split(':')[0];
  if(activeHost!==STAGING_HOST)
    return {staging:false,created:false,linked:false,reason:'not-staging'};

  const account=accounts.find(user=>
    user?.role==='student' &&
    (!options.accountId||user?.id===options.accountId) &&
    /^\s*MICHAEL\s+GWOAH\s*$/i.test(String(user?.name||'')) &&
    typeof user?.id==='string' &&
    typeof user?.email==='string'
  );
  if(!account)
    return {staging:true,created:false,linked:false,reason:'michael-account-not-found'};

  const byIdentity=store.one('SELECT * FROM students WHERE user_id=?',account.id);
  if(byIdentity)
    return {
      staging:true,created:false,linked:true,reason:'already-linked',
      studentId:byIdentity.id,studentNumber:byIdentity.student_number,
    };

  const byEmail=store.one('SELECT * FROM students WHERE email=? COLLATE NOCASE',account.email);
  if(byEmail){
    if(!byEmail.user_id){
      store.transaction(()=>{
        store.run('UPDATE students SET user_id=? WHERE id=? AND user_id IS NULL',account.id,byEmail.id);
        store.audit(options.auditActor||'system','STAGING_ACCEPTANCE_STUDENT_IDENTITY_LINK','student',null,{
          studentId:byEmail.id,userId:account.id,email:account.email,testData:true,
        });
      });
      return {
        staging:true,created:false,linked:true,reason:'linked-existing-email-record',
        studentId:byEmail.id,studentNumber:byEmail.student_number,
      };
    }
    return {staging:true,created:false,linked:false,reason:'email-linked-to-other-account'};
  }

  const candidate=store.one(`SELECT
      p.id AS program_id,p.title AS program_title,p.code AS program_code,
      t.id AS term_id,t.title AS term_title,t.code AS term_code,
      COUNT(DISTINCT s.id) AS section_count
    FROM programs p
    JOIN program_requirements pr ON pr.program_id=p.id
    JOIN sections s ON s.course_id=pr.course_id
    JOIN terms t ON t.id=s.term_id AND t.status='open'
    GROUP BY p.id,p.title,p.code,t.id,t.title,t.code,t.start_date
    ORDER BY section_count DESC,t.start_date DESC,p.code
    LIMIT 1`) || store.one(`SELECT
      p.id AS program_id,p.title AS program_title,p.code AS program_code,
      t.id AS term_id,t.title AS term_title,t.code AS term_code,
      (SELECT COUNT(*) FROM sections s WHERE s.term_id=t.id) AS section_count
    FROM programs p CROSS JOIN terms t
    WHERE t.status='open' AND EXISTS(SELECT 1 FROM sections s WHERE s.term_id=t.id)
    ORDER BY t.start_date DESC,p.code
    LIMIT 1`);

  if(!candidate)
    return {staging:true,created:false,linked:false,reason:'no-open-term-with-sections'};

  const result=store.transaction(()=>{
    const duplicate=store.one('SELECT id FROM students WHERE user_id=? OR email=? COLLATE NOCASE',account.id,account.email);
    if(duplicate)throw new WorkflowError('Staging acceptance student became linked during bootstrap.',409);

    const applicationId=crypto.randomUUID();
    const studentId=crypto.randomUUID();
    const suffix=crypto.randomBytes(3).toString('hex').toUpperCase();
    const year=new Date().getUTCFullYear();
    const studentNumber=`HIAU-STG-${year}-${suffix}`;
    const applicationNumber=`STG-AUTO-${suffix}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const stamp=new Date().toISOString();
    const note='STAGING TEST ONLY — auto-linked admitted academic record for authenticated end-to-end Student PWA acceptance.';

    store.run(`INSERT INTO applications
      (id,number,full_name,email,phone,program_id,status,decision_note,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'admitted',?,?,?)`,
      applicationId,applicationNumber,account.name,account.email,'STAGING TEST',
      candidate.program_id,note,stamp,stamp);

    store.run(`INSERT INTO students
      (id,user_id,application_id,student_number,full_name,email,program_id,admitted_term_id,status,financial_hold,created_at)
      VALUES(?,?,?,?,?,?,?,?, 'active',0,?)`,
      studentId,account.id,applicationId,studentNumber,account.name,account.email,
      candidate.program_id,candidate.term_id,stamp);

    store.audit(options.auditActor||'system','STAGING_ACCEPTANCE_STUDENT_AUTO_LINK','student',null,{
      studentId,userId:account.id,studentNumber,email:account.email,
      programId:candidate.program_id,termId:candidate.term_id,
      sectionCount:Number(candidate.section_count||0),testData:true,
    });

    return {studentId,studentNumber};
  });

  return {
    staging:true,created:true,linked:true,reason:'created',
    studentId:result.studentId,studentNumber:result.studentNumber,
    programTitle:candidate.program_title,termTitle:candidate.term_title,
  };
}
