import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {ArrowDownCircle,BookOpen,RefreshCcw,ShoppingCart} from 'lucide-react';
import type {UserProfile} from '../../types';

const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((cents||0)/100);
async function csrf(){
 const r=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});
 const d=await r.json().catch(()=>({}));
 if(!r.ok||typeof d.csrf!=='string'||!d.csrf)throw new Error('Session verification unavailable. Refresh and sign in again.');
 return d.csrf as string;
}
async function post(url:string,body:object){
 const token=await csrf();
 const r=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-csrf-token':token},body:JSON.stringify(body)});
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(d.error||'Add/Drop action failed.');
 return d;
}
async function putCart(body:object){
 const token=await csrf();
 const r=await fetch('/api/student/add-drop/cart',{method:'PUT',credentials:'same-origin',
  headers:{'Content-Type':'application/json','x-csrf-token':token},body:JSON.stringify(body)});
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(d.error||'The Add/Drop cart could not be saved.');
 return d;
}
type StudentState={
 linked:boolean;
 terms:{id:string;title:string;max_credits:number;registration_close_date:string;registration_closed?:boolean}[];
 sections:{id:string;term_id:string;course_id:string;course_code:string;course_title:string;credits:number;schedule?:string;delivery_mode?:'classroom'|'online'|'hybrid';location?:string;classroom?:string;online_classroom?:string;has_online_classroom?:number}[];
 registrations:{registration_id:string;section_id:string;term_id:string;course_id:string;course_code:string;course_title:string;credits:number;schedule?:string;delivery_mode?:'classroom'|'online'|'hybrid';location?:string;classroom?:string;online_classroom?:string}[];
 requests:any[];
 carts:{term_id:string;addSectionIds:string[];dropRegistrationIds:string[];reason:string;updated_at:string}[];
};
const statusLabel=(s:string)=>s.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
const placeholderValues=new Set(['','tba','tbd','to be announced','to be determined','not assigned','not configured','n/a','na','-','—']);
const cleanValue=(value:any)=>{
 const text=String(value||'').trim();
 return placeholderValues.has(text.toLowerCase())?'':text;
};
const sectionAccess=(section:any)=>{
 const mode=section.delivery_mode||'classroom';
 const online=cleanValue(section.online_classroom)||
  (Number(section.has_online_classroom)===1?'Online access after enrollment':'Online classroom not configured');
 const classroom=cleanValue(section.classroom);
 if(mode==='online')return `Online · ${online}`;
 if(mode==='hybrid')return `Hybrid · ${classroom?('Classroom '+classroom):'Classroom not assigned'} · ${online}`;
 return `Classroom · ${classroom?('Classroom '+classroom):'Classroom not assigned'}`;
};

export const StudentAddDropWorkflow:React.FC<{currentUser:UserProfile;mode:'student'|'registrar'|'finance';onOpenCourseBoard?:()=>void}>=({currentUser,mode,onOpenCourseBoard})=>{
 const isStudent=mode==='student'&&currentUser.role==='student';
 const isRegistrar=mode==='registrar'&&['super_admin','registrar'].includes(currentUser.role);
 const isFinance=mode==='finance'&&['super_admin','bursar','registrar'].includes(currentUser.role);
 const [data,setData]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [termId,setTermId]=useState(''),[adds,setAdds]=useState<string[]>([]),[drops,setDrops]=useState<string[]>([]),[reason,setReason]=useState('');
 const [notes,setNotes]=useState<Record<string,string>>({}),[dueDates,setDueDates]=useState<Record<string,string>>({});
 const [refundNotes,setRefundNotes]=useState<Record<string,string>>({});
 const [refundMethods,setRefundMethods]=useState<Record<string,'cash'|'bank'|'mobile_money'>>({});
 const [refundExternalRefs,setRefundExternalRefs]=useState<Record<string,string>>({});

 const endpoint=isFinance?'/api/student/add-drop/finance':'/api/student/add-drop';
 const load=useCallback(async()=>{
  setError('');
  const r=await fetch(endpoint,{credentials:'same-origin',cache:'no-store'});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||'Could not load Add/Drop workflow.');
  setData(d);
  if(isStudent){
   const activeTerm=termId||d.terms?.[0]?.id||'';
   if(activeTerm&&!termId)setTermId(activeTerm);
   const cart=d.carts?.find((item:any)=>item.term_id===activeTerm);
   setAdds(cart?.addSectionIds||[]);
   setDrops(cart?.dropRegistrationIds||[]);
   setReason(cart?.reason||'');
  }
 },[endpoint,isStudent,termId]);
 useEffect(()=>{void load().catch(e=>setError(e instanceof Error?e.message:'Could not load Add/Drop workflow.'));},[load]);
 useEffect(()=>{
  if(!isFinance)return;
  const refresh=()=>{void load().catch(e=>setError(e instanceof Error?e.message:'Could not refresh Finance Add/Drop data.'));};
  window.addEventListener('hiau:finance-data-changed',refresh);
  return()=>window.removeEventListener('hiau:finance-data-changed',refresh);
 },[isFinance,load]);

 const student=data as StudentState|null;
 const activeTerm=isStudent?student?.terms?.find(t=>t.id===termId):null;
 const registrationClosed=!!activeTerm?.registration_closed;
 const currentRegs=useMemo(()=>isStudent?(student?.registrations||[]).filter(r=>r.term_id===termId):[],[isStudent,student,termId]);
 const selectedAdditions=useMemo(()=>isStudent?(student?.sections||[]).filter(s=>s.term_id===termId&&adds.includes(s.id)):[],[isStudent,student,termId,adds]);
 const currentCredits=currentRegs.reduce((n,r)=>n+Number(r.credits||0),0);
 const droppedCredits=currentRegs.filter(r=>drops.includes(r.registration_id)).reduce((n,r)=>n+Number(r.credits||0),0);
 const addedCredits=selectedAdditions.reduce((n,s)=>n+Number(s.credits||0),0);
 const resultingCredits=currentCredits-droppedCredits+addedCredits;

 const saveStudentCart=async(nextAdds:string[],nextDrops:string[],nextReason=reason)=>{
  if(!termId)return;
  await putCart({termId,addSectionIds:nextAdds,dropRegistrationIds:nextDrops,reason:nextReason});
 };
 const toggleDrop=async(registrationId:string,checked:boolean)=>{
  if(busy||registrationClosed)return;
  const next=checked?Array.from(new Set([...drops,registrationId])):drops.filter(id=>id!==registrationId);
  setBusy(true);setError('');setMessage('');
  try{await saveStudentCart(adds,next,reason);setDrops(next);
   setMessage(checked?'Course added to the drop side of your Add/Drop cart.':'Course removed from the drop side of your Add/Drop cart.');
  }catch(e){setError(e instanceof Error?e.message:'The Add/Drop cart could not be updated.');}
  finally{setBusy(false);}
 };
 const removeAddition=async(sectionId:string)=>{
  if(busy)return;
  const next=adds.filter(id=>id!==sectionId);
  setBusy(true);setError('');setMessage('');
  try{await saveStudentCart(next,drops,reason);setAdds(next);setMessage('Course removed from your Add/Drop cart.');}
  catch(e){setError(e instanceof Error?e.message:'The Add/Drop cart could not be updated.');}
  finally{setBusy(false);}
 };

 const submit=async()=>{
  if(busy||registrationClosed)return;setBusy(true);setError('');setMessage('');
  try{
   await saveStudentCart(adds,drops,reason);
   const r=await post('/api/student/add-drop',{termId,addSectionIds:adds,dropRegistrationIds:drops,reason});
   setMessage('Add/Drop request submitted for Registrar review. No registration or billing change has occurred yet.');
   setAdds([]);setDrops([]);setReason('');await load();
   if(r.underloadWarning)setMessage(m=>'Your request was submitted. Resulting load is below 12 credits and requires Registrar judgment. No registration or billing change has occurred yet.');
  }catch(e){setError(e instanceof Error?e.message:'Add/Drop request could not be submitted.');}
  finally{setBusy(false);}
 };
 const review=async(id:string,decision:string)=>{
  if(busy)return;setBusy(true);setError('');setMessage('');
  try{await post('/api/student/add-drop/'+id+'/review',{decision,note:notes[id]||''});setMessage('Registrar Add/Drop decision saved and audited.');await load();}
  catch(e){setError(e instanceof Error?e.message:'Review could not be saved.');}finally{setBusy(false);}
 };
 const commit=async(id:string)=>{
  if(busy||!window.confirm('Commit this approved Add/Drop request to the official registration record?'))return;
  setBusy(true);setError('');setMessage('');
  try{const r=await post('/api/student/add-drop/'+id+'/commit',{confirmation:'CONFIRM_ADD_DROP'});
   setMessage('Add/Drop committed: '+r.addedRegistrations+' added, '+r.droppedRegistrations+' dropped. Finance will review any resulting tuition adjustment.');
   await load();
  }catch(e){setError(e instanceof Error?e.message:'Add/Drop could not be committed.');}finally{setBusy(false);}
 };
 const reviewRefund=async(id:string,decision:'approved'|'cancelled')=>{
  if(busy)return;setBusy(true);setError('');setMessage('');
  try{
   await post('/api/student/add-drop/refunds/'+id+'/review',{decision,note:refundNotes[id]||''});
   setMessage(decision==='approved'?'Student refund approved. An independent Finance account must record the payout.':'Student refund cancelled and audited.');
   await load();window.dispatchEvent(new CustomEvent('hiau:finance-data-changed',{detail:{source:'refund-reviewed',refundId:id}}));
  }catch(e){setError(e instanceof Error?e.message:'Refund review could not be saved.');}finally{setBusy(false);}
 };
 const payRefund=async(id:string)=>{
  if(busy)return;setBusy(true);setError('');setMessage('');
  try{
   const method=refundMethods[id]||'cash';
   const result=await post('/api/student/add-drop/refunds/'+id+'/pay',{method,externalReference:refundExternalRefs[id]||''});
   setMessage('Refund '+result.reference+' paid, audited, and applied to the student account.');
   await load();window.dispatchEvent(new CustomEvent('hiau:finance-data-changed',{detail:{source:'refund-paid',refundId:id}}));
  }catch(e){setError(e instanceof Error?e.message:'Refund payout could not be recorded.');}finally{setBusy(false);}
 };

 const postInvoice=async(item:any)=>{
  const due=dueDates[item.id]||'';if(!due){setError('Choose an invoice due date.');return;}
  setBusy(true);setError('');setMessage('');
  try{
   const token=await csrf();
   const r=await fetch('/api/workspaces/action',{method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json','x-csrf-token':token},
    body:JSON.stringify({action:'invoice',data:{studentId:item.student_id,termId:item.term_id,dueDate:due}})});
   const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Add/Drop invoice could not be posted.');
   setMessage('Add/Drop tuition invoice posted and audited.');await load();
   window.dispatchEvent(new CustomEvent('hiau:finance-data-changed',{detail:{source:'add-drop-invoice-posted'}}));
  }catch(e){setError(e instanceof Error?e.message:'Add/Drop invoice could not be posted.');}finally{setBusy(false);}
 };

 if(isStudent)return <section className="rounded-2xl border border-[#DED1E3] bg-white p-5 text-[#35103B] shadow-sm">
  <div className="flex flex-wrap items-start justify-between gap-3"><div>
   <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8B5C1C]">Student Workspace</p>
   <h2 className="mt-1 flex items-center gap-2 text-xl font-bold"><ShoppingCart className="h-5 w-5"/>My Add/Drop Cart</h2>
   <p className="mt-1 max-w-3xl text-sm text-slate-700">Courses to add come from the University Course Board in Academic Planning. Courses to drop come only from My Courses below. Nothing changes in your official enrollment or tuition until the Registrar approves and commits the request.</p>
  </div><div className="flex flex-wrap gap-2">
   {onOpenCourseBoard&&<button type="button" onClick={onOpenCourseBoard} className="inline-flex items-center gap-2 rounded-lg border border-[#4A1249] px-3 py-2 text-sm font-semibold text-[#4A1249]"><BookOpen className="h-4 w-4"/>Browse Course Board</button>}
   <button type="button" onClick={()=>void load()} className="rounded-lg border border-[#D8C8DC] px-3 py-2 text-sm font-semibold text-[#4A1249]"><RefreshCcw className="mr-2 inline h-4 w-4"/>Refresh cart</button>
  </div></div>
  {error&&<p className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm">{error}</p>}
  {message&&<p className="mt-3 rounded border border-[#D8C8DC] bg-[#FAF7FB] p-3 text-sm font-medium text-[#4A1249]">{message}</p>}
  {!student?.linked?<p className="mt-4 text-sm">A linked active student record is required.</p>:<>
   <div className="mt-4"><label className="text-sm font-semibold">Academic term<select value={termId} onChange={e=>{
     const next=e.target.value;setTermId(next);
     const cart=student.carts?.find(item=>item.term_id===next);setAdds(cart?.addSectionIds||[]);setDrops(cart?.dropRegistrationIds||[]);setReason(cart?.reason||'');
    }} className="mt-1 block w-full rounded-lg border border-[#D8C8DC] p-2.5">
    {student.terms.map(t=><option key={t.id} value={t.id}>{t.title} — limit {t.max_credits} credits{t.registration_closed?' — registration closed':''}</option>)}</select></label>
    {activeTerm&&<p className={"mt-2 rounded border p-2 text-xs "+(registrationClosed?'border-rose-200 bg-rose-50 text-rose-800':'border-[#E5D3A6] bg-[#FFF9EA] text-[#6F4F16]')}>
     Registration / Add-Drop closes: <strong>{activeTerm.registration_close_date}</strong>{registrationClosed?' — deadline passed; no new Add/Drop request can be submitted.':''}
    </p>}</div>

   <div className="mt-5 grid gap-5 lg:grid-cols-2">
    <div className="rounded-xl border border-[#E6DCE7] p-4"><div className="flex items-center justify-between gap-3">
     <div><h3 className="flex items-center gap-2 font-bold text-[#4A1249]"><BookOpen className="h-5 w-5"/>Add from Course Board</h3>
      <p className="mt-1 text-xs text-slate-600">These courses were selected from the university-wide Course Board.</p></div>
     {onOpenCourseBoard&&<button type="button" onClick={onOpenCourseBoard} className="text-xs font-semibold text-[#4A1249] underline">Browse courses</button>}
    </div>
    <div className="mt-3 space-y-2">{selectedAdditions.length?selectedAdditions.map(s=><div key={s.id} className="flex items-start justify-between gap-3 rounded-lg bg-[#FAF8FB] p-3">
     <span><strong>{s.course_code}</strong> — {s.course_title}<br/><span className="text-xs text-slate-600">{s.credits} credits · {s.schedule||'Schedule pending'} · {sectionAccess(s)}</span></span>
     <button type="button" disabled={busy} onClick={()=>void removeAddition(s.id)} className="shrink-0 rounded border border-[#4A1249] px-2 py-1 text-xs font-semibold text-[#4A1249] disabled:opacity-50">Remove</button>
    </div>):<p className="rounded border border-dashed border-[#D8C8DC] p-3 text-sm text-slate-600">No additions selected. Use Academic Planning → University Course Board to add a course to this cart.</p>}</div>
    </div>

    <div className="rounded-xl border border-[#E6DCE7] p-4"><h3 className="flex items-center gap-2 font-bold text-[#4A1249]"><ArrowDownCircle className="h-5 w-5"/>Drop from My Courses</h3>
     <p className="mt-1 text-xs text-slate-600">Only courses already in your official current enrollment can be selected for drop.</p>
     <div className="mt-3 space-y-2">{currentRegs.length?currentRegs.map(r=><label key={r.registration_id} className="flex gap-3 rounded-lg bg-[#FAF8FB] p-3">
      <input type="checkbox" checked={drops.includes(r.registration_id)} disabled={busy||registrationClosed} onChange={e=>void toggleDrop(r.registration_id,e.target.checked)}/>
      <span><strong>{r.course_code}</strong> — {r.course_title}<br/><span className="text-xs text-slate-600">{r.credits} credits · {r.schedule||'Schedule pending'} · {sectionAccess(r)}</span></span></label>):<p className="text-sm text-slate-600">No active registrations in this term.</p>}</div>
    </div>
   </div>

   <div className="mt-5 rounded-xl border border-[#D8C8DC] bg-[#FAF7FB] p-4">
    <h3 className="font-bold text-[#4A1249]">Request summary</h3>
    {(adds.length>0||drops.length>0)&&<p className="mt-2 rounded-lg border border-[#E5D3A6] bg-[#FFF9EA] p-3 text-sm font-semibold text-[#6F4F16]">Your selections are still only in the Add/Drop cart. They will not appear for the Registrar until you enter a reason and click “Submit Add/Drop request to Registrar.”</p>}
    <p className="mt-2 text-sm">Current credits: <strong>{currentCredits}</strong> · Add: <strong>{addedCredits}</strong> · Drop: <strong>{droppedCredits}</strong> · Resulting credits: <strong>{resultingCredits}</strong></p>
    {resultingCredits>0&&resultingCredits<12&&<p className="mt-2 rounded border border-[#E5D3A6] bg-[#FFF9EA] p-3 text-xs text-[#6F4F16]">This change would leave fewer than 12 credits. The Registrar must review the underload impact before committing it.</p>}
    <label className="mt-3 block text-sm font-semibold">Reason for Add/Drop<textarea value={reason} onChange={e=>setReason(e.target.value)}
     rows={3} maxLength={1000} className="mt-1 block w-full rounded-lg border border-[#D8C8DC] bg-white p-2.5" placeholder="Explain the requested registration change (minimum 20 characters)"/></label>
    <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
     <span className={reason.trim().length<20?'font-semibold text-[#8B5C1C]':'font-semibold text-[#4A1249]'}>
      {reason.trim().length<20?(20-reason.trim().length)+' more character'+((20-reason.trim().length)===1?'':'s')+' required before submission.':'Reason requirement satisfied.'}
     </span>
     <span className="text-slate-500">{reason.length}/1000 characters</span>
    </div>
    <button disabled={busy||registrationClosed||(!adds.length&&!drops.length)||reason.trim().length<20} onClick={()=>void submit()} title={reason.trim().length<20?'Enter at least 20 characters in the reason field before submitting.':undefined} className="hiau-finance-primary mt-3 rounded-lg px-4 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50">Submit Add/Drop request to Registrar</button>
   </div>

   <div className="mt-6"><h3 className="font-bold">My Add/Drop requests</h3>{student.requests?.length?<div className="mt-2 space-y-2">{student.requests.map((r:any)=><div key={r.id} className="rounded-lg border border-[#E6DCE7] p-3 text-sm">
    <strong>{statusLabel(r.status)}</strong> · {r.addSectionIds.length} add · {r.dropRegistrationIds.length} drop<p className="mt-1 text-slate-600">{r.reason}</p>{r.reviewer_note&&<p className="mt-1 text-slate-600">Registrar: {r.reviewer_note}</p>}</div>)}</div>:
    <p className="mt-2 rounded border border-dashed border-[#D8C8DC] p-3 text-sm text-slate-600">{(adds.length||drops.length)?'No request has been submitted yet. Your current selections remain in the cart above.':'No Add/Drop requests yet.'}</p>}</div>
  </>}
 </section>;

 if(isRegistrar){
  const requests=data?.requests||[];
  return <section className="rounded-2xl border border-[#DED1E3] bg-white p-5 text-[#35103B] shadow-sm">
   <h2 className="text-xl font-bold">Registrar — Add / Drop Review</h2><p className="mt-1 text-sm text-slate-700">Review requested registration changes before they affect the official record or Finance.</p>
   {error&&<p className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm">{error}</p>}{message&&<p className="mt-3 rounded border border-[#D8C8DC] bg-[#FAF7FB] p-3 text-sm">{message}</p>}
   {!requests.length?<p className="mt-4 rounded border border-dashed p-4 text-sm text-slate-600">No Add/Drop requests are awaiting Registrar action.</p>:
   <div className="mt-4 space-y-4">{requests.map((r:any)=><article key={r.id} className="rounded-xl border border-[#E6DCE7] p-4">
    <h3 className="font-bold">{r.student_number} — {r.full_name}</h3><p className="text-sm text-slate-600">{r.term_title} · Status {statusLabel(r.status)}</p>
    <p className="mt-2 text-sm">{r.reason}</p>
    {r.reviewSummary?.valid&&<div className="mt-3 grid gap-2 rounded-lg border border-[#E6DCE7] bg-[#FAF8FB] p-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
     <p>Current load<br/><strong>{r.reviewSummary.currentCredits} cr.</strong></p>
     <p>Add<br/><strong>{r.reviewSummary.addCredits} cr.</strong></p>
     <p>Drop<br/><strong>{r.reviewSummary.dropCredits} cr.</strong></p>
     <p>Resulting load<br/><strong>{r.reviewSummary.resultingCredits} cr.</strong></p>
     <p>Added tuition estimate<br/><strong>{money(r.reviewSummary.addedUnbilledCents)}</strong></p>
     {r.reviewSummary.underloadWarning&&<p className="sm:col-span-2 lg:col-span-5 rounded border border-[#E5D3A6] bg-[#FFF9EA] p-2 text-xs text-[#6F4F16]">Resulting load is below 12 credits and requires Registrar judgment.</p>}
    </div>}
    {r.reviewSummary&&!r.reviewSummary.valid&&<p className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Current validation issue: {r.reviewSummary.error}</p>}
    <div className="mt-3 grid gap-3 md:grid-cols-2"><div><strong className="text-sm">Add</strong>{r.adds?.length?r.adds.map((x:any)=><p key={x.id} className="text-sm">{x.code} — {x.title} ({x.credits} cr.)</p>):<p className="text-sm text-slate-500">None</p>}</div>
     <div><strong className="text-sm">Drop</strong>{r.drops?.length?r.drops.map((x:any)=><p key={x.id} className="text-sm">{x.code} — {x.title} ({x.credits} cr.)</p>):<p className="text-sm text-slate-500">None</p>}</div></div>
    {r.status==='submitted'&&<><textarea rows={2} value={notes[r.id]||''} onChange={e=>setNotes(v=>({...v,[r.id]:e.target.value}))} className="mt-3 w-full rounded-lg border border-[#D8C8DC] p-2.5" placeholder="Registrar decision note"/>
     <div className="mt-2 flex flex-wrap gap-2"><button disabled={busy||(notes[r.id]||'').trim().length<10} onClick={()=>void review(r.id,'approved')} className="hiau-finance-primary rounded px-3 py-2 text-sm font-semibold">Approve</button>
      <button disabled={busy||(notes[r.id]||'').trim().length<10} onClick={()=>void review(r.id,'returned')} className="rounded border border-[#4A1249] px-3 py-2 text-sm">Return</button>
      <button disabled={busy||(notes[r.id]||'').trim().length<10} onClick={()=>void review(r.id,'rejected')} className="rounded border border-[#4A1249] px-3 py-2 text-sm">Reject</button></div></>}
    {r.status==='approved'&&<button disabled={busy} onClick={()=>void commit(r.id)} className="hiau-finance-primary mt-3 rounded px-4 py-2 text-sm font-semibold">Commit approved Add/Drop</button>}
   </article>)}</div>}
  </section>;
 }

 if(isFinance){
  const items=data?.items||[];
  const refunds=data?.refunds||[];
  const canRefund=['super_admin','bursar'].includes(currentUser.role);
  return <section className="rounded-2xl border border-[#DED1E3] bg-white p-5 text-[#35103B] shadow-sm">
   <h2 className="text-xl font-bold">Add / Drop — Finance Adjustment</h2><p className="mt-1 text-sm text-slate-700">Review committed registration changes. Drop credits are already posted according to the term refund window; added registrations remain unbilled until Finance posts them.</p>
   {error&&<p className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm">{error}</p>}{message&&<p className="mt-3 rounded border border-[#D8C8DC] bg-[#FAF7FB] p-3 text-sm">{message}</p>}
   {!items.length?<p className="mt-4 text-sm text-slate-600">No committed Add/Drop adjustments are available.</p>:<div className="mt-4 space-y-4">{items.map((item:any)=><article key={item.id} className="rounded-xl border border-[#E6DCE7] p-4">
    <h3 className="font-bold">{item.student_number} — {item.full_name}</h3><p className="text-sm text-slate-600">{item.term_title}</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-3 text-sm"><p>Drop credit posted: <strong>{money(item.dropped_credit_cents)}</strong></p><p>{item.unbilledRegistrations?.length?'Added unbilled estimate':'Added tuition posted'}: <strong>{money(item.added_unbilled_cents)}</strong></p><p>Current account balance: <strong>{money(item.currentBalanceCents)}</strong></p></div>
    {item.unbilledRegistrations?.length?<div className="mt-3 rounded-lg bg-[#FAF7FB] p-3"><p className="font-semibold">Unbilled added registrations</p>{item.unbilledRegistrations.map((x:any)=><p key={x.id} className="text-sm">{x.code} — {x.title}: {money(x.amount_cents)}</p>)}
     <label className="mt-3 block text-sm font-semibold">Invoice due date<input type="date" value={dueDates[item.id]||''} onChange={e=>setDueDates(v=>({...v,[item.id]:e.target.value}))} className="mt-1 block rounded border border-[#D8C8DC] p-2"/></label>
     <button disabled={busy||!dueDates[item.id]} onClick={()=>void postInvoice(item)} className="hiau-finance-primary mt-3 rounded px-4 py-2 text-sm font-semibold">Post Add/Drop tuition invoice</button>
    </div>:<p className="mt-3 text-sm font-medium text-[#4A1249]">No unbilled added registrations remain.</p>}
   </article>)}</div>}
   <div className="mt-6 border-t border-[#E6DCE7] pt-5">
    <h3 className="text-lg font-bold">Student Refund Queue</h3>
    <p className="mt-1 text-sm text-slate-700">Refunds are created only when a committed drop produces a refundable overpayment from actual reconciled student funds. Credits without an overpayment do not create cash refunds.</p>
    {!refunds.length?<p className="mt-3 rounded border border-dashed border-[#D8C8DC] p-4 text-sm text-slate-600">No student refunds are awaiting Finance action.</p>:
     <div className="mt-3 space-y-3">{refunds.map((refund:any)=><article key={refund.id} className="rounded-xl border border-[#E6DCE7] p-4">
      <h4 className="font-bold">{refund.student_number} — {refund.full_name}</h4>
      <p className="mt-1 text-sm">{refund.course_code} — {refund.course_title} · Invoice {refund.invoice_number}</p>
      <p className="mt-2 text-sm">Refund due: <strong>{money(refund.amount_cents)}</strong> · Status: <strong>{statusLabel(refund.status)}</strong></p>
      <p className="mt-1 text-xs text-slate-600">{refund.reason}</p>
      {refund.status==='pending'&&canRefund&&<>
       <textarea rows={2} value={refundNotes[refund.id]||''} onChange={e=>setRefundNotes(v=>({...v,[refund.id]:e.target.value}))}
        placeholder="Finance refund review note (minimum 10 characters)" className="mt-3 w-full rounded-lg border border-[#D8C8DC] p-2.5 text-sm"/>
       <div className="mt-2 flex flex-wrap gap-2">
        <button disabled={busy||(refundNotes[refund.id]||'').trim().length<10} onClick={()=>void reviewRefund(refund.id,'approved')} className="hiau-finance-primary rounded px-3 py-2 text-sm font-semibold">Approve refund</button>
        <button disabled={busy||(refundNotes[refund.id]||'').trim().length<10} onClick={()=>void reviewRefund(refund.id,'cancelled')} className="rounded border border-[#4A1249] px-3 py-2 text-sm">Cancel refund</button>
       </div>
      </>}
      {refund.status==='approved'&&canRefund&&<div className="mt-3 rounded-lg bg-[#FAF7FB] p-3">
       <p className="text-sm font-semibold">Record approved refund payout</p>
       <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-semibold">Refund method<select value={refundMethods[refund.id]||'cash'} onChange={e=>setRefundMethods(v=>({...v,[refund.id]:e.target.value as 'cash'|'bank'|'mobile_money'}))} className="mt-1 w-full rounded border border-[#D8C8DC] bg-white p-2">
         <option value="cash">Cash</option><option value="bank">Bank</option><option value="mobile_money">Mobile Money</option>
        </select></label>
        <label className="text-xs font-semibold">External transaction reference
         <input value={refundExternalRefs[refund.id]||''} onChange={e=>setRefundExternalRefs(v=>({...v,[refund.id]:e.target.value}))} maxLength={120}
          placeholder={(refundMethods[refund.id]||'cash')==='cash'?'Optional for cash':'Required bank / Mobile Money reference'} className="mt-1 w-full rounded border border-[#D8C8DC] bg-white p-2"/>
        </label>
       </div>
       <button disabled={busy||refund.approved_by===currentUser.id||((refundMethods[refund.id]||'cash')!=='cash'&&!(refundExternalRefs[refund.id]||'').trim())} onClick={()=>void payRefund(refund.id)}
        className="hiau-finance-primary mt-3 rounded px-4 py-2 text-sm font-semibold disabled:opacity-50">Record refund paid</button>
       {refund.approved_by===currentUser.id&&<p className="mt-2 text-xs text-[#6F4F16]">Independent payout required: the account that approved this refund cannot mark it paid.</p>}
      </div>}
     </article>)}</div>}
   </div>
  </section>;
 }
 return null;
};
