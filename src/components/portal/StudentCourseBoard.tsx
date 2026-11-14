import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {BookOpen,Building2,CheckCircle2,Clock,MapPin,Monitor,RefreshCcw,Search,ShoppingCart,User,Users} from 'lucide-react';
import type {UserProfile} from '../../types';

type Term={id:string;title:string;max_credits:number;start_date:string;end_date:string;registration_close_date:string;registration_closed?:boolean};
type Section={
 id:string;term_id:string;code:string;capacity:number;delivery_mode:'classroom'|'online'|'hybrid';location:string;classroom:string;online_classroom:string;schedule:string;
 course_id:string;course_code:string;course_title:string;credits:number;lecturer_name?:string|null;enrolled_count:number;program_eligible:number;has_online_classroom:number;setup_complete:number;setup_issue:string;
};
type Registration={registration_id:string;section_id:string;term_id:string;course_id:string;course_code:string;course_title:string;credits:number};
type Cart={term_id:string;addSectionIds:string[];dropRegistrationIds:string[];reason:string;updated_at:string};
type State={linked:boolean;terms:Term[];sections:Section[];registrations:Registration[];carts:Cart[]};

const placeholderValues=new Set(['','tba','tbd','to be announced','to be determined','not assigned','not configured','n/a','na','-','—']);
const cleanValue=(value?:string|null)=>{
 const text=String(value||'').trim();
 return placeholderValues.has(text.toLowerCase())?'':text;
};

async function csrf(){
 const r=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});
 const d=await r.json().catch(()=>({}));
 if(!r.ok||typeof d.csrf!=='string'||!d.csrf)throw new Error('Session verification unavailable. Refresh and sign in again.');
 return d.csrf as string;
}
async function saveCart(payload:{termId:string;addSectionIds:string[];dropRegistrationIds:string[];reason:string}){
 const token=await csrf();
 const r=await fetch('/api/student/add-drop/cart',{method:'PUT',credentials:'same-origin',
  headers:{'Content-Type':'application/json','x-csrf-token':token},body:JSON.stringify(payload)});
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(d.error||'The Add/Drop cart could not be updated.');
 return d;
}

export const StudentCourseBoard:React.FC<{currentUser:UserProfile;onOpenStudentWorkspace:()=>void}>=({currentUser,onOpenStudentWorkspace})=>{
 const [state,setState]=useState<State|null>(null),[termId,setTermId]=useState(''),[query,setQuery]=useState('');
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState('');
 const load=useCallback(async()=>{
  setError('');
  const r=await fetch('/api/student/add-drop',{credentials:'same-origin',cache:'no-store'});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||'Could not load the University Course Board.');
  setState(d);
  if(!termId&&d.terms?.[0]?.id)setTermId(d.terms[0].id);
 },[termId]);
 useEffect(()=>{void load().catch(e=>setError(e instanceof Error?e.message:'Could not load the University Course Board.'));},[load]);

 const activeTerm=state?.terms?.find(t=>t.id===termId);
 const registrationClosed=!!activeTerm?.registration_closed;
 const cart=state?.carts?.find(c=>c.term_id===termId);
 const addIds=cart?.addSectionIds||[];
 const dropIds=cart?.dropRegistrationIds||[];
 const registeredCourseIds=new Set((state?.registrations||[]).filter(r=>r.term_id===termId).map(r=>r.course_id));
 const sections=useMemo(()=>{
  const q=query.trim().toLowerCase();
  return (state?.sections||[]).filter(s=>s.term_id===termId&&(!q||
   s.course_code.toLowerCase().includes(q)||s.course_title.toLowerCase().includes(q)||
   (s.lecturer_name||'').toLowerCase().includes(q)||(s.schedule||'').toLowerCase().includes(q)||
   (s.classroom||'').toLowerCase().includes(q)||(s.online_classroom||'').toLowerCase().includes(q)||
   (s.delivery_mode||'').toLowerCase().includes(q)));
 },[state,termId,query]);
 const selectedSections=(state?.sections||[]).filter(s=>addIds.includes(s.id));

 const updateAddition=async(sectionId:string,remove=false)=>{
  if(!termId||busy)return;
  setBusy(sectionId);setError('');setMessage('');
  try{
   const next=remove?addIds.filter(id=>id!==sectionId):Array.from(new Set([...addIds,sectionId]));
   await saveCart({termId,addSectionIds:next,dropRegistrationIds:dropIds,reason:cart?.reason||''});
   setMessage(remove?'Course removed from your Add/Drop cart.':'Course added to your Add/Drop cart. Review and submit the request from Student Workspace.');
   await load();
  }catch(e){setError(e instanceof Error?e.message:'The Add/Drop cart could not be updated.');}
  finally{setBusy('');}
 };

 if(currentUser.role!=='student')return null;
 return <section className="space-y-5">
  <div className="rounded-2xl border border-[#DED1E3] bg-white p-5 text-[#35103B] shadow-sm">
   <div className="flex flex-wrap items-start justify-between gap-4">
    <div>
     <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8B5C1C]">Academic Planning</p>
     <h2 className="mt-1 flex items-center gap-2 text-2xl font-bold"><BookOpen className="h-6 w-6"/>University Course Board</h2>
     <p className="mt-2 max-w-3xl text-sm text-slate-700">Browse open course sections published for the academic term. Adding a course here places it in your Add/Drop cart; it does not enroll or bill you. Registrar commitment is required before the course becomes part of My Courses.</p>
    </div>
    <button type="button" onClick={()=>void load()} className="inline-flex items-center gap-2 rounded-lg border border-[#D8C8DC] px-3 py-2 text-sm font-semibold text-[#4A1249] hover:bg-[#F4EDF4]"><RefreshCcw className="h-4 w-4"/>Refresh board</button>
   </div>
   {error&&<p role="alert" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{error}</p>}
   {message&&<p role="status" className="mt-4 rounded-lg border border-[#D8C8DC] bg-[#FAF7FB] p-3 text-sm font-medium text-[#4A1249]">{message}</p>}
   {!state?.linked?<p className="mt-4 text-sm text-slate-700">A linked active student record is required before course eligibility can be evaluated.</p>:<>
    <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
     <label className="text-sm font-semibold">Academic term<select value={termId} onChange={e=>setTermId(e.target.value)}
      className="mt-1 block w-full rounded-lg border border-[#D8C8DC] bg-white p-2.5">
      {state.terms.map(t=><option key={t.id} value={t.id}>{t.title} — maximum {t.max_credits} credits{t.registration_closed?' — registration closed':''}</option>)}
     </select></label>
     <label className="text-sm font-semibold">Search course board<div className="relative mt-1"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400"/>
      <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Course code, title, lecturer or schedule"
       className="w-full rounded-lg border border-[#D8C8DC] bg-white py-2.5 pl-9 pr-3"/></div></label>
    </div>
    {activeTerm&&<div className={"mt-4 rounded-lg border p-3 text-sm "+(registrationClosed?'border-rose-200 bg-rose-50 text-rose-800':'border-[#E5D3A6] bg-[#FFF9EA] text-[#6F4F16]')}>
     Registration / Add-Drop closes: <strong>{activeTerm.registration_close_date}</strong>{registrationClosed?' — deadline passed; new Add/Drop changes are blocked.':''}
    </div>}
    <div className="mt-4 rounded-xl border border-[#E6DCE7] bg-[#FAF8FB] p-4">
     <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="flex items-center gap-2 font-bold text-[#4A1249]"><ShoppingCart className="h-5 w-5"/>My Add/Drop Cart</h3>
       <p className="mt-1 text-xs text-slate-600">{addIds.length} course addition{addIds.length===1?'':'s'} selected from the Course Board · {dropIds.length} current course drop{dropIds.length===1?'':'s'} selected in Student Workspace.</p>
       {(addIds.length>0||dropIds.length>0)&&<p className="mt-2 inline-flex rounded-full border border-[#E5D3A6] bg-[#FFF9EA] px-3 py-1 text-xs font-bold text-[#6F4F16]">Cart only — not yet submitted to Registrar</p>}</div>
      <button type="button" onClick={onOpenStudentWorkspace} className="hiau-finance-primary rounded-lg px-4 py-2 text-sm font-semibold">Review & submit Add/Drop request</button>
     </div>
     {selectedSections.length>0&&<div className="mt-3 flex flex-wrap gap-2">{selectedSections.map(s=><span key={s.id} className="rounded-full border border-[#D8C8DC] bg-white px-3 py-1 text-xs font-semibold">{s.course_code} · {s.credits} cr.</span>)}</div>}
    </div>
   </>}
  </div>

  {state?.linked&&<div className="rounded-2xl border border-[#DED1E3] bg-white p-5 text-[#35103B] shadow-sm">
   <div className="flex items-end justify-between gap-3"><div><h3 className="text-xl font-bold">Open Course Sections</h3>
    <p className="mt-1 text-sm text-slate-700">The board is university-wide. Program rules, prerequisites, credit limits, duplicate registration, financial holds and section capacity are revalidated when the request is submitted and again before Registrar commitment.</p></div>
    <span className="text-xs font-semibold text-slate-500">{sections.length} section{sections.length===1?'':'s'}</span></div>
   {!sections.length?<p className="mt-4 rounded border border-dashed border-[#D8C8DC] p-5 text-sm text-slate-600">No open sections match the selected term and search.</p>:
   <div className="mt-4 grid gap-4 lg:grid-cols-2">{sections.map(section=>{
    const already=registeredCourseIds.has(section.course_id);
    const inCart=addIds.includes(section.id);
    const seats=Math.max(0,Number(section.capacity)-Number(section.enrolled_count||0));
    const full=seats<=0;
    const programEligible=Number(section.program_eligible)===1;
    const setupComplete=Number(section.setup_complete)===1;
    const mode=section.delivery_mode||'classroom';
    const modeLabel=mode==='classroom'?'Classroom':mode==='online'?'Online':'Hybrid';
    return <article key={section.id} className="rounded-xl border border-[#E6DCE7] p-4">
     <div className="flex flex-wrap items-start justify-between gap-2"><div>
      <p className="font-mono text-xs font-bold text-[#8B5C1C]">{section.course_code} · Section {section.code}</p>
      <h4 className="mt-1 text-lg font-bold">{section.course_title}</h4></div>
      <div className="flex flex-wrap gap-2"><span className="rounded-full bg-[#FFF6E2] px-3 py-1 text-xs font-bold text-[#8B5C1C]">{modeLabel}</span>
       <span className="rounded-full bg-[#F4EDF4] px-3 py-1 text-xs font-bold text-[#4A1249]">{section.credits} credits</span></div></div>
     <div className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
      <p className="flex items-center gap-2"><Clock className="h-4 w-4 text-[#8B5C1C]"/>{section.schedule||'Schedule to be announced'}</p>
      {mode!=='online'&&<p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-[#8B5C1C]"/>{cleanValue(section.location)||'Campus / location not configured'}</p>}
      {mode!=='online'&&<p className="flex items-center gap-2"><Building2 className="h-4 w-4 text-[#8B5C1C]"/>{cleanValue(section.classroom)?('Classroom '+cleanValue(section.classroom)):'Classroom not assigned'}</p>}
      {mode!=='classroom'&&<p className="flex items-center gap-2"><Monitor className="h-4 w-4 text-[#8B5C1C]"/>
       {already?(cleanValue(section.online_classroom)||'Online classroom not configured'):(Number(section.has_online_classroom)===1?'Online access available after enrollment':'Online classroom not configured')}
      </p>}
      <p className="flex items-center gap-2"><User className="h-4 w-4 text-[#8B5C1C]"/>{section.lecturer_name||'Faculty assignment pending'}</p>
      <p className="flex items-center gap-2"><Users className="h-4 w-4 text-[#8B5C1C]"/>{seats} of {section.capacity} seats available</p>
     </div>
     <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#EEE5F0] pt-3">
      <div className="text-xs">{already?<span className="inline-flex items-center gap-1 font-semibold text-[#4A1249]"><CheckCircle2 className="h-4 w-4"/>In My Courses</span>:
       !setupComplete?<span className="font-semibold text-[#8B5C1C]">Section setup incomplete — not available for registration</span>:
       !programEligible?<span className="font-semibold text-slate-500">Not currently approved for your program</span>:
       registrationClosed?<span className="font-semibold text-rose-700">Registration / Add-Drop deadline passed</span>:
       full?<span className="font-semibold text-rose-700">Section full</span>:
       inCart?<span className="font-semibold text-[#4A1249]">In Add/Drop Cart</span>:
       <span className="text-slate-600">Available to request</span>}</div>
      {!already&&setupComplete&&programEligible&&!registrationClosed&&!full&&(inCart?
       <button type="button" disabled={busy===section.id} onClick={()=>void updateAddition(section.id,true)}
        className="rounded-lg border border-[#4A1249] px-3 py-2 text-xs font-semibold text-[#4A1249] disabled:opacity-50">Remove from cart</button>:
       <button type="button" disabled={busy===section.id} onClick={()=>void updateAddition(section.id)}
        className="hiau-finance-primary rounded-lg px-3 py-2 text-xs font-semibold">{busy===section.id?'Adding…':'Add to Add/Drop Cart'}</button>)}
     </div>
    </article>;
   })}</div>}
  </div>}
 </section>;
};
