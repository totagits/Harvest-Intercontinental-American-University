import crypto from 'node:crypto';
import {Operations} from './operations';

const STAGING_HOST='hiau-staging.totag.network';

export type StagingAcademicFixtureResult={
  staging:boolean;
  ready:boolean;
  created:boolean;
  reason:string;
  programId?:string;
  programTitle?:string;
  termId?:string;
  termTitle?:string;
  sectionIds?:string[];
};

export function ensureStagingAcademicFixture(
  store:Operations,
  accounts:any[],
  options:{requestHost:string;auditActor?:any},
):StagingAcademicFixtureResult{
  const requestHost=String(options.requestHost||'').toLowerCase().split(':')[0];
  if(requestHost!==STAGING_HOST)
    return {staging:false,ready:false,created:false,reason:'not-staging'};

  const existing=store.one(`SELECT
      p.id AS program_id,p.title AS program_title,
      t.id AS term_id,t.title AS term_title,
      COUNT(DISTINCT s.id) AS section_count
    FROM programs p
    JOIN program_requirements pr ON pr.program_id=p.id
    JOIN sections s ON s.course_id=pr.course_id
    JOIN terms t ON t.id=s.term_id AND t.status='open'
    GROUP BY p.id,p.title,t.id,t.title,t.start_date
    HAVING COUNT(DISTINCT s.id)>0
    ORDER BY section_count DESC,t.start_date DESC
    LIMIT 1`);
  if(existing)
    return {
      staging:true,ready:true,created:false,reason:'existing-open-term',
      programId:existing.program_id,programTitle:existing.program_title,
      termId:existing.term_id,termTitle:existing.term_title,
      sectionIds:store.all('SELECT id FROM sections WHERE term_id=? ORDER BY code',existing.term_id).map((row:any)=>row.id),
    };

  const instructor=accounts.find(user=>
    ['super_admin','registrar','dean','lecturer'].includes(String(user?.role||'')) &&
    typeof user?.id==='string'
  );
  if(!instructor)
    return {staging:true,ready:false,created:false,reason:'no-staff-instructor'};

  const stamp=new Date().toISOString();
  const created=store.transaction(()=>{
    let program=store.one("SELECT * FROM programs WHERE code='STG-ACCEPT'");
    if(!program){
      const id=crypto.randomUUID();
      store.run('INSERT INTO programs(id,code,title,required_credits,created_at) VALUES(?,?,?,?,?)',
        id,'STG-ACCEPT','HIAU Staging Acceptance Program',120,stamp);
      program=store.one('SELECT * FROM programs WHERE id=?',id);
    }

    let term=store.one("SELECT * FROM terms WHERE code='STG-2026-A'");
    if(!term){
      const id=crypto.randomUUID();
      store.run(`INSERT INTO terms(id,code,title,start_date,end_date,status,max_credits,created_at)
        VALUES(?,?,?,?,?,'open',?,?)`,
        id,'STG-2026-A','Staging Acceptance Term 2026','2026-11-01','2027-03-31',18,stamp);
      term=store.one('SELECT * FROM terms WHERE id=?',id);
    }else if(term.status!=='open'){
      store.run("UPDATE terms SET status='open',start_date=?,end_date=?,max_credits=? WHERE id=?",
        '2026-11-01','2027-03-31',18,term.id);
      term=store.one('SELECT * FROM terms WHERE id=?',term.id);
    }

    const definitions=[
      {code:'STG-101',title:'University Foundations',credits:3,fee:15000,schedule:'Mon/Wed 09:00–10:30'},
      {code:'STG-102',title:'Digital Research & Communication',credits:3,fee:15000,schedule:'Tue/Thu 11:00–12:30'},
      {code:'STG-103',title:'Quantitative Reasoning',credits:3,fee:15000,schedule:'Fri 09:00–12:00'},
    ];
    const sectionIds:string[]=[];
    for(const definition of definitions){
      let course=store.one('SELECT * FROM courses WHERE code=?',definition.code);
      if(!course){
        const id=crypto.randomUUID();
        store.run('INSERT INTO courses(id,code,title,credits,fee_cents,created_at) VALUES(?,?,?,?,?,?)',
          id,definition.code,definition.title,definition.credits,definition.fee,stamp);
        course=store.one('SELECT * FROM courses WHERE id=?',id);
      }
      store.run('INSERT OR IGNORE INTO program_requirements(program_id,course_id) VALUES(?,?)',
        program.id,course.id);
      let section=store.one("SELECT * FROM sections WHERE course_id=? AND term_id=? AND code='A'",
        course.id,term.id);
      if(!section){
        const id=crypto.randomUUID();
        store.run(`INSERT INTO sections
          (id,course_id,term_id,lecturer_id,code,capacity,location,schedule,created_at)
          VALUES(?,?,?,?,?,?,?,?,?)`,
          id,course.id,term.id,instructor.id,'A',30,'HIAU Staging / Hybrid',definition.schedule,stamp);
        section=store.one('SELECT * FROM sections WHERE id=?',id);
      }
      sectionIds.push(section.id);
    }

    store.audit(options.auditActor||'system','STAGING_ACCEPTANCE_ACADEMIC_FIXTURE','academic_setup',null,{
      programId:program.id,termId:term.id,sectionIds,instructorId:instructor.id,testData:true,
      note:'STAGING TEST ONLY — isolated course-planning acceptance fixture.',
    });
    return {program,term,sectionIds};
  });

  return {
    staging:true,ready:true,created:true,reason:'created',
    programId:created.program.id,programTitle:created.program.title,
    termId:created.term.id,termTitle:created.term.title,
    sectionIds:created.sectionIds,
  };
}
