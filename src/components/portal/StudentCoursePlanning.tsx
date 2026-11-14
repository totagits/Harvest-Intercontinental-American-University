import React,{useEffect,useMemo,useState} from 'react';
import type {UserProfile} from '../../types';

type Term={id:string;title:string;status:string;max_credits:number};
type Section={id:string;term_id:string;code:string;course_code:string;course_title:string;credits:number;capacity:number};
type Plan={id:string;student_id:string;term_id:string;sectionIds:string[];student_note:string;reviewer_note:string;
 status:'draft'|'submitted'|'returned'|'approved'|'rejected';full_name?:string;student_number?:string;term_title?:string;committed_at?:string|null};
const parse=async(r:Response)=>{const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');return data;};
const send=async(url:string,body:object)=>{
 const auth=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});
 const session=await auth.json().catch(()=>({}));
 if(!auth.ok||typeof session.csrf!=='string'||!session.csrf)
  throw Error('Session verification unavailable. Refresh and sign in again.');
 return parse(await fetch(url,{method:'POST',credentials:'same-origin',
  headers:{'Content-Type':'application/json','x-csrf-token':session.csrf},
  body:JSON.stringify(body)}));
};
export const StudentCoursePlanning:React.FC<{currentUser:UserProfile}>=({currentUser})=>{
 const [terms,setTerms]=useState<Term[]>([]),[sections,setSections]=useState<Section[]>([]);
 const [plans,setPlans]=useState<Plan[]>([]),[linked,setLinked]=useState(true);
 const [termId,setTermId]=useState(''),[chosen,setChosen]=useState<string[]>([]),[note,setNote]=useState('');
 const [reviewNotes,setReviewNotes]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const isStudent=currentUser.role==='student';
 const isRegistrar=['registrar','super_admin'].includes(currentUser.role);
 const refresh=async()=>{
  const data=await parse(await fetch('/api/student/course-plans',{credentials:'same-origin',cache:'no-store'}));
  setPlans(data.plans||[]);setTerms(data.terms||[]);setSections(data.sections||[]);
  setLinked(data.linked!==false);
 };
 useEffect(()=>{if(isStudent||isRegistrar)void refresh().catch(e=>setError(e.message));},[currentUser.id,currentUser.role]);
 const saved=plans.find(p=>p.term_id===termId);
 const editable=!saved||saved.status==='draft'||saved.status==='returned';
 useEffect(()=>{
  if(!isStudent||!termId)return;
  const p=plans.find(x=>x.term_id===termId);
  setChosen(p?.sectionIds||[]);setNote(p?.student_note||'');
 },[termId,plans,isStudent]);
 const options=useMemo(()=>sections.filter(x=>x.term_id===termId),[sections,termId]);
 const totalCredits=options.filter(x=>chosen.includes(x.id)).reduce((n,x)=>n+x.credits,0);
 const change=async(kind:'save'|'submit'|'review'|'register',id?:string,decision?:string)=>{
  if(busy)return;
  if(kind==='register'&&!window.confirm('Commit all courses in this approved plan as official registration? This cannot be undone here and will be audited. Finance billing remains separate.'))return;
  setBusy(true);setError('');setMessage('');
  try{
   if(kind==='save'){
    await send('/api/student/course-plans',{termId,sectionIds:chosen,note});
    setMessage('Private course plan saved. No enrollment or tuition bill has been created.');
   } else if(kind==='submit'&&id){
    await send('/api/student/course-plans/'+id+'/submit',{});
    setMessage('Course plan submitted for Registrar review. Enrollment and billing are not yet activated.');
   }else if(kind==='review'&&id&&decision){
    await send('/api/student/course-plans/'+id+'/review',{decision,note:reviewNotes[id]||''});
    setMessage('Registrar decision saved and audited. Approval does not automatically enroll or bill the student.');
   }else if(kind==='register'&&id){
    await send('/api/student/course-plans/'+id+'/register',{confirmation:'CONFIRM_OFFICIAL_REGISTRATION'});
    setMessage('Official registration completed. The enrolled sections are now in the Finance billing review queue; no invoice was posted automatically.');
   }
   await refresh();
  }catch(e){setError(e instanceof Error?e.message:'Request failed');}finally{setBusy(false);}
 };
 if(!isStudent&&!isRegistrar)return null;
 return <section className="mt-5 rounded-xl border border-purple-200 bg-white p-4 text-slate-800 sm:p-6" aria-label="Student course planning">
  <h2 className="text-xl font-bold text-[#4A1249]">{isStudent?'My Course Plan':'Registrar — Course Plan Review'}</h2>
  <p className="mt-2 text-sm text-slate-600">Draft course selection and academic review. This is not an approved registration, financial bill, scholarship decision, or payment service.</p>
  {!!error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  {!!message&&<p role="status" className="mt-3 text-sm text-green-800">{message}</p>}
  {isStudent&&(!linked?<p className="mt-4 rounded border border-amber-200 bg-amber-50 p-4 text-sm">An admitted student record must first be linked by the Registrar before course planning is available.</p>:
   <div className="mt-4 space-y-4">
    <label className="block text-sm font-semibold">Academic term
     <select value={termId} onChange={e=>setTermId(e.target.value)} className="mt-1 block w-full rounded border p-2">
      <option value="">Select an open academic term</option>
      {terms.map(t=><option key={t.id} value={t.id}>{t.title} — limit {t.max_credits} credits</option>)}
     </select>
    </label>
    {!!termId&&<>
     <div className="grid gap-2 sm:grid-cols-2">{options.map(section=><label key={section.id}
       className="flex items-start gap-2 rounded border border-purple-100 p-3 text-sm">
        <input type="checkbox" disabled={!editable} checked={chosen.includes(section.id)}
          onChange={e=>setChosen(current=>e.target.checked?[...current,section.id]:current.filter(x=>x!==section.id))}
          className="mt-1"/>
        <span><strong>{section.course_code} — {section.course_title}</strong>
         <span className="block text-xs text-slate-600">{section.code} · {section.credits} credits</span></span>
       </label>)}</div>
     {!options.length&&<p className="text-sm text-slate-600">No open sections available in this term.</p>}
     <p className="text-sm font-semibold">Planned credits: {totalCredits}</p>
     <label className="block text-sm font-semibold">Note for Registrar<textarea maxLength={1000} rows={3}
        disabled={!editable} value={note} onChange={e=>setNote(e.target.value)} className="mt-1 block w-full rounded border p-2"/></label>
     <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy||!editable||!chosen.length} onClick={()=>void change('save')}
       className="hiau-brand-action rounded bg-[#4A1249] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Save private plan</button>
      {saved&&editable&&<button type="button" disabled={busy} onClick={()=>void change('submit',saved.id)}
       className="rounded border border-[#4A1249] px-4 py-2 text-sm font-bold text-[#4A1249]">Submit saved plan to Registrar</button>}
     </div>
     {saved&&<p className="text-xs text-slate-600">Current plan status: <strong className="capitalize">{saved.committed_at?'Officially registered':saved.status}</strong>
       {saved.reviewer_note&&<> · Registrar: {saved.reviewer_note}</>}</p>}
    </>}
   </div>)}
  {isRegistrar&&<div className="mt-4 space-y-3">{plans.length===0?
   <p className="rounded border border-dashed p-4 text-sm text-slate-600">No submitted or approved course plans awaiting Registrar action.</p>:
   plans.map(plan=><article key={plan.id} className="rounded-lg border border-purple-200 p-4">
    <h3 className="font-semibold">{plan.student_number} — {plan.full_name}</h3>
    <p className="mt-1 text-sm text-slate-600">{plan.term_title} · {plan.sectionIds.length} sections · <strong className="capitalize">{plan.status}</strong></p>
    <p className="mt-2 text-sm">{plan.student_note||'No student note.'}</p>
    <label className="mt-3 block text-sm font-semibold">Decision note
     <textarea rows={2} maxLength={1200} value={reviewNotes[plan.id]||''}
       onChange={e=>setReviewNotes(prev=>({...prev,[plan.id]:e.target.value}))}
       className="mt-1 block w-full rounded border p-2"/></label>
    <div className="mt-3 flex flex-wrap gap-2">
     {plan.status==='submitted'&&(['approved','returned','rejected'] as const).map(decision=><button key={decision} type="button"
      disabled={busy||((decision!=='approved')&&!reviewNotes[plan.id]?.trim())}
      onClick={()=>void change('review',plan.id,decision)}
      className="rounded border border-[#4A1249] px-3 py-2 text-xs font-semibold capitalize text-[#4A1249] disabled:opacity-50">{decision}</button>)}
     {plan.status==='approved'&&<button type="button" disabled={busy}
       onClick={()=>void change('register',plan.id)}
       className="hiau-brand-action rounded bg-[#4A1249] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
       Commit official registration
     </button>}
    </div>
   </article>)}</div>}
 </section>;
};
