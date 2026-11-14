import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {BookOpen,Plus,RefreshCcw,Save,Users} from 'lucide-react';
import type {UserProfile} from '../../types';

type Term={id:string;code:string;title:string;status:'draft'|'open'|'closed'};
type Course={id:string;code:string;title:string;credits:number};
type Staff={id:string;name:string;role:string};
type Section={
 id:string;course_id:string;term_id:string;lecturer_id:string;code:string;capacity:number;
 location:string;classroom:string;schedule:string;course_code:string;course_title:string;credits:number;
 term_title:string;term_status:string;lecturer_name:string;enrolled:number;
};
type State={terms:Term[];courses:Course[];users:Staff[];sections:Section[]};

async function csrf(){
 const r=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});
 const d=await r.json().catch(()=>({}));
 if(!r.ok||typeof d.csrf!=='string'||!d.csrf)throw new Error('Session verification unavailable. Refresh and sign in again.');
 return d.csrf as string;
}
async function action(name:string,data:object){
 const token=await csrf();
 const r=await fetch('/api/workspaces/action',{method:'POST',credentials:'same-origin',
  headers:{'Content-Type':'application/json','x-csrf-token':token},
  body:JSON.stringify({action:name,data})});
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(d.error||'Academic section action failed.');
 return d.result;
}

export const CourseSectionManagement:React.FC<{currentUser:UserProfile}>=({currentUser})=>{
 const canManage=['super_admin','registrar'].includes(currentUser.role);
 const [state,setState]=useState<State|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [courseId,setCourseId]=useState(''),[termId,setTermId]=useState(''),[lecturerId,setLecturerId]=useState('');
 const [code,setCode]=useState('A'),[capacity,setCapacity]=useState('20'),[location,setLocation]=useState(''),[classroom,setClassroom]=useState(''),[schedule,setSchedule]=useState('');
 const [capacityDrafts,setCapacityDrafts]=useState<Record<string,string>>({});
 const [classroomDrafts,setClassroomDrafts]=useState<Record<string,string>>({});

 const load=useCallback(async()=>{
  setError('');
  const r=await fetch('/api/workspaces/state',{credentials:'same-origin',cache:'no-store'});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||'Could not load course sections.');
  setState(d);
  if(!courseId&&d.courses?.[0]?.id)setCourseId(d.courses[0].id);
  const usableTerms=(d.terms||[]).filter((t:Term)=>t.status!=='closed');
  if(!termId&&usableTerms[0]?.id)setTermId(usableTerms[0].id);
  const faculty=(d.users||[]).filter((u:Staff)=>['lecturer','dean','super_admin'].includes(u.role));
  if(!lecturerId&&faculty[0]?.id)setLecturerId(faculty[0].id);
  const drafts:Record<string,string>={},roomDrafts:Record<string,string>={};
  for(const s of d.sections||[]){drafts[s.id]=String(s.capacity);roomDrafts[s.id]=String(s.classroom||'');}
  setCapacityDrafts(drafts);setClassroomDrafts(roomDrafts);
 },[courseId,termId,lecturerId]);

 React.useEffect(()=>{if(canManage)void load().catch(e=>setError(e instanceof Error?e.message:'Could not load course sections.'));},[canManage,load]);

 const terms=useMemo(()=>state?.terms.filter(t=>t.status!=='closed')||[],[state]);
 const faculty=useMemo(()=>state?.users.filter(u=>['lecturer','dean','super_admin'].includes(u.role))||[],[state]);
 const sections=useMemo(()=>state?.sections||[],[state]);

 const create=async()=>{
  if(busy)return;
  setBusy(true);setError('');setMessage('');
  try{
   await action('section',{courseId,termId,lecturerId,code:code.trim(),capacity,location:location.trim(),classroom:classroom.trim(),schedule:schedule.trim()});
   setMessage('Course section created and audited. It appears on the student Course Board whenever its academic term is open.');
   setCode('A');setCapacity('20');setLocation('');setClassroom('');setSchedule('');
   await load();
  }catch(e){setError(e instanceof Error?e.message:'Course section could not be created.');}
  finally{setBusy(false);}
 };

 const updateSection=async(section:Section)=>{
  if(busy)return;
  setBusy(true);setError('');setMessage('');
  try{
   const nextCapacity=capacityDrafts[section.id]||'';
   const nextClassroom=classroomDrafts[section.id]||'';
   await action('sectionSettings',{id:section.id,capacity:nextCapacity,classroom:nextClassroom});
   setMessage(`${section.course_code} section ${section.code} settings updated and audited.`);
   await load();
  }catch(e){setError(e instanceof Error?e.message:'Section settings could not be updated.');}
  finally{setBusy(false);}
 };

 if(!canManage)return null;
 return <section className="space-y-5 rounded-2xl border border-[#DED1E3] bg-white p-5 text-[#35103B] shadow-sm">
  <div className="flex flex-wrap items-start justify-between gap-3">
   <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8B5C1C]">Academic Planning · Registrar Control</p>
    <h2 className="mt-1 flex items-center gap-2 text-xl font-bold"><BookOpen className="h-5 w-5"/>Course Section Management</h2>
    <p className="mt-1 max-w-4xl text-sm text-slate-700">Create class sections and set the maximum number of students permitted in each section. A section in an open term is visible on the University Course Board. Students cannot request a full section, and capacity is checked again before Registrar commitment.</p></div>
   <button type="button" onClick={()=>void load()} className="inline-flex items-center gap-2 rounded-lg border border-[#D8C8DC] px-3 py-2 text-sm font-semibold text-[#4A1249]"><RefreshCcw className="h-4 w-4"/>Refresh sections</button>
  </div>

  {error&&<p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{error}</p>}
  {message&&<p role="status" className="rounded-lg border border-[#D8C8DC] bg-[#FAF7FB] p-3 text-sm font-medium text-[#4A1249]">{message}</p>}

  <div className="rounded-xl border border-[#E6DCE7] bg-[#FAF8FB] p-4">
   <h3 className="flex items-center gap-2 font-bold text-[#4A1249]"><Plus className="h-5 w-5"/>Create university course section</h3>
   <p className="mt-1 text-xs text-slate-600">Example: Section A with a capacity of 20 means only 20 active enrollments may be committed to that section.</p>
   <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
    <label className="text-sm font-semibold">Course
     <select value={courseId} onChange={e=>setCourseId(e.target.value)} className="mt-1 w-full rounded-lg border border-[#D8C8DC] bg-white p-2.5">
      <option value="">Select course</option>{state?.courses.map(c=><option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}
     </select>
    </label>
    <label className="text-sm font-semibold">Academic term
     <select value={termId} onChange={e=>setTermId(e.target.value)} className="mt-1 w-full rounded-lg border border-[#D8C8DC] bg-white p-2.5">
      <option value="">Select term</option>{terms.map(t=><option key={t.id} value={t.id}>{t.title} · {t.status}</option>)}
     </select>
    </label>
    <label className="text-sm font-semibold">Lecturer / faculty
     <select value={lecturerId} onChange={e=>setLecturerId(e.target.value)} className="mt-1 w-full rounded-lg border border-[#D8C8DC] bg-white p-2.5">
      <option value="">Select faculty</option>{faculty.map(u=><option key={u.id} value={u.id}>{u.name} · {u.role.replaceAll('_',' ')}</option>)}
     </select>
    </label>
    <label className="text-sm font-semibold">Section code
     <input value={code} onChange={e=>setCode(e.target.value)} maxLength={30} placeholder="A"
      className="mt-1 w-full rounded-lg border border-[#D8C8DC] bg-white p-2.5"/>
    </label>
    <label className="text-sm font-semibold">Student limit / capacity
     <input type="number" min={1} max={10000} step={1} value={capacity} onChange={e=>setCapacity(e.target.value)}
      className="mt-1 w-full rounded-lg border border-[#D8C8DC] bg-white p-2.5"/>
    </label>
    <label className="text-sm font-semibold">Location / delivery mode
     <input value={location} onChange={e=>setLocation(e.target.value)} placeholder="Main Campus / Hybrid"
      className="mt-1 w-full rounded-lg border border-[#D8C8DC] bg-white p-2.5"/>
    </label>
    <label className="text-sm font-semibold">Classroom / room
     <input value={classroom} onChange={e=>setClassroom(e.target.value)} maxLength={100} placeholder="Room 201 / Lab 2 / TBA"
      className="mt-1 w-full rounded-lg border border-[#D8C8DC] bg-white p-2.5"/>
    </label>
    <label className="text-sm font-semibold lg:col-span-2">Schedule
     <input value={schedule} onChange={e=>setSchedule(e.target.value)} placeholder="Mon/Wed 10:00–11:30"
      className="mt-1 w-full rounded-lg border border-[#D8C8DC] bg-white p-2.5"/>
    </label>
    <div className="flex items-end">
     <button type="button" disabled={busy||!courseId||!termId||!lecturerId||!code.trim()||!capacity||!location.trim()||!schedule.trim()}
      onClick={()=>void create()} className="hiau-finance-primary rounded-lg px-4 py-2.5 text-sm font-bold">
      {busy?'Saving…':'Create section'}
     </button>
    </div>
   </div>
  </div>

  <div className="rounded-xl border border-[#E6DCE7] p-4">
   <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="flex items-center gap-2 font-bold text-[#4A1249]"><Users className="h-5 w-5"/>Published & scheduled sections</h3>
    <p className="mt-1 text-xs text-slate-600">Capacity may be increased or reduced, but never below the number of students already enrolled.</p></div>
    <span className="text-xs font-semibold text-slate-500">{sections.length} section{sections.length===1?'':'s'}</span></div>
   {!sections.length?<p className="mt-4 text-sm text-slate-600">No sections have been created yet.</p>:
   <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[1180px] text-left text-sm">
    <thead className="border-b border-[#E6DCE7] bg-[#FAF8FB] text-xs uppercase tracking-wide text-slate-600"><tr>
     <th className="px-3 py-3">Course / Section</th><th className="px-3 py-3">Term</th><th className="px-3 py-3">Faculty</th>
     <th className="px-3 py-3">Schedule</th><th className="px-3 py-3">Location / Mode</th><th className="px-3 py-3">Classroom / Room</th>
     <th className="px-3 py-3">Enrollment</th><th className="px-3 py-3">Capacity</th><th className="px-3 py-3">Action</th>
    </tr></thead>
    <tbody className="divide-y divide-[#EEE5F0]">{sections.map(section=>{
     const full=Number(section.enrolled)>=Number(section.capacity);
     const draft=capacityDrafts[section.id]??String(section.capacity);
     const classroomDraft=classroomDrafts[section.id]??String(section.classroom||'');
     const invalid=!/^\d+$/.test(draft)||Number(draft)<Number(section.enrolled)||Number(draft)<1||Number(draft)>10000||classroomDraft.length>100;
     const unchanged=Number(draft)===Number(section.capacity)&&classroomDraft.trim()===(section.classroom||'').trim();
     return <tr key={section.id}>
      <td className="px-3 py-3"><strong>{section.course_code}</strong> · {section.course_title}<br/><span className="text-xs text-slate-500">Section {section.code}</span></td>
      <td className="px-3 py-3">{section.term_title}<br/><span className="text-xs font-semibold text-[#8B5C1C]">{section.term_status}</span></td>
      <td className="px-3 py-3">{section.lecturer_name}</td>
      <td className="px-3 py-3">{section.schedule}</td>
      <td className="px-3 py-3">{section.location}</td>
      <td className="px-3 py-3"><input type="text" maxLength={100} value={classroomDraft}
       onChange={e=>setClassroomDrafts(v=>({...v,[section.id]:e.target.value}))}
       placeholder="TBA" className="w-36 rounded-lg border border-[#D8C8DC] bg-white p-2"/></td>
      <td className="px-3 py-3"><span className={full?'font-bold text-rose-700':'font-bold text-[#4A1249]'}>{section.enrolled} / {section.capacity}</span><br/><span className="text-xs text-slate-500">{full?'Full':'Seats available: '+Math.max(0,section.capacity-section.enrolled)}</span></td>
      <td className="px-3 py-3"><input type="number" min={Math.max(1,Number(section.enrolled))} max={10000} step={1} value={draft}
       onChange={e=>setCapacityDrafts(v=>({...v,[section.id]:e.target.value}))}
       className="w-28 rounded-lg border border-[#D8C8DC] bg-white p-2"/></td>
      <td className="px-3 py-3"><button type="button" disabled={busy||invalid||unchanged}
       onClick={()=>void updateSection(section)} className="inline-flex items-center gap-2 rounded-lg border border-[#4A1249] px-3 py-2 text-xs font-semibold text-[#4A1249] disabled:cursor-not-allowed disabled:opacity-40">
       <Save className="h-4 w-4"/>Save changes</button></td>
     </tr>;
    })}</tbody>
   </table></div>}
  </div>
 </section>;
};
