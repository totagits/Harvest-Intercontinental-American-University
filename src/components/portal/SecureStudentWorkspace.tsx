import React, { useEffect, useState } from 'react';
import { BookOpen, ClipboardList, CreditCard, GraduationCap, RefreshCw } from 'lucide-react';
import type { UserProfile } from '../../types';
import { StudentActivityTimeline } from './StudentActivityTimeline';
import { StudentUnifiedSearchFilter } from './StudentUnifiedSearchFilter';

/** Authenticated read-only student view of the real operations database.
 *  Never use AI Studio's seed identities/grades/tuition as institutional records.
 *  The server must scope workspaces/state by session; frontend filtering is not a security boundary.
 */
type RecordRow = Record<string, unknown>;
type State = {
  actor?: { id: string; role: string };
  ownStudent?: RecordRow | null;
  registrations?: RecordRow[];
  grades?: RecordRow[];
  invoices?: RecordRow[];
  payments?: RecordRow[];
};
const string = (v: unknown) => typeof v === 'string' ? v : '';
const money = (cents: unknown) =>
  typeof cents === 'number' && Number.isFinite(cents)
    ? new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(cents / 100)
    : 'Not available';
const stamp = (value: unknown) => {
  const text = string(value);
  const date = new Date(text);
  return text && !Number.isNaN(date.getTime()) ? date.toLocaleDateString() : 'Not recorded';
};
const Panel: React.FC<{title: string; children: React.ReactNode}> = ({title,children}) =>
  <section className="rounded-2xl border border-[#e6dce7] bg-white p-5 shadow-sm">
    <h2 className="mb-4 text-lg font-semibold text-[#35103b]">{title}</h2>{children}
  </section>;
const Empty = ({children}:{children:React.ReactNode}) =>
  <p className="rounded-lg bg-[#faf8fb] px-4 py-6 text-center text-sm text-slate-600">{children}</p>;

export const SecureStudentWorkspace: React.FC<{currentUser: UserProfile}> = ({currentUser}) => {
  const [state,setState] = useState<State | null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [linking,setLinking] = useState(false);
  const [linkError,setLinkError] = useState('');
  const refresh = async (signal?: AbortSignal) => {
    setLoading(true);setError('');
    try {
      const res = await fetch('/api/workspaces/state',{credentials:'same-origin',cache:'no-store',signal});
      if (!res.ok) throw new Error(res.status === 401 ? 'Your session has expired. Sign in again.' : 'Student records could not be retrieved.');
      const data: State = await res.json();
      if (data.actor?.id !== currentUser.id || data.actor?.role !== 'student')
        throw new Error('Student records are unavailable for this account.');
      if (!signal?.aborted) setState(data);
    } catch (e) {
      if (!signal?.aborted) {setState(null);setError(e instanceof Error ? e.message : 'Unable to load records.');}
    } finally {if (!signal?.aborted)setLoading(false);}
  };
  const completeStagingLink = async () => {
    if (linking) return;
    setLinking(true);setLinkError('');
    try {
      const auth=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});
      const session=await auth.json().catch(()=>({}));
      if(!auth.ok||typeof session.csrf!=='string'||!session.csrf)
        throw new Error('Session verification unavailable. Refresh and sign in again.');
      const response=await fetch('/api/workspaces/staging-student-self-link',{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json','x-csrf-token':session.csrf},
        body:JSON.stringify({acceptanceTest:true}),
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(data.error||'The staging student record could not be linked.');
      await refresh();
    } catch(e) {
      setLinkError(e instanceof Error?e.message:'The staging student record could not be linked.');
    } finally { setLinking(false); }
  };
  useEffect(() => {
    if (currentUser.role !== 'student') { setLoading(false);setState(null);return; }
    const controller=new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  },[currentUser.id,currentUser.role]);
  if (currentUser.role !== 'student')
    return <Panel title="Student workspace"><Empty>Only a student account can access individual student records. Use the Registrar workspace for authorized institutional reviews.</Empty></Panel>;
  if (loading) return <div role="status" className="rounded-xl bg-white p-8 text-slate-700">Loading verified academic records…</div>;
  if (error) return <div role="alert" className="rounded-xl border border-red-200 bg-white p-6 text-red-800">{error}<button type="button" onClick={() => void refresh()} className="ml-3 underline">Retry</button></div>;
  const student = state?.ownStudent;
  if (!student) {
    const stagingMichael=window.location.hostname==='hiau-staging.totag.network' &&
      /^\s*MICHAEL\s+GWOAH\s*$/i.test(currentUser.name||'');
    return <Panel title="Student record not yet linked">
      <Empty>Your university administrator or registrar must link an approved student record to this account. No sample profile is displayed.</Empty>
      {stagingMichael&&<div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-[#35103b]">Staging acceptance test</p>
        <p className="mt-1 text-sm text-slate-700">Use this staging-only action to create and link the designated admitted/active MICHAEL GWOAH test record. It does not create grades, registrations, invoices, payments, aid awards or course plans.</p>
        {linkError&&<p role="alert" className="mt-3 rounded-lg border border-red-200 bg-white p-3 text-sm text-red-800">{linkError}</p>}
        <button type="button" onClick={()=>void completeStagingLink()} disabled={linking}
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#4a1249] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          <RefreshCw className={"h-4 w-4 "+(linking?'animate-spin':'')}/>
          {linking?'Linking staging student…':'Complete staging test student link'}
        </button>
      </div>}
    </Panel>;
  }
  const registrations = (state?.registrations ?? []).filter(r => r.student_id === student.id);
  const gradesByRegistration = new Map((state?.grades ?? []).filter(g=>g.status === 'published').map(g=>[g.registration_id,g]));
  const invoices = (state?.invoices ?? []).filter(i=>i.student_id === student.id);
  const payments = state?.payments ?? [];
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-[#e6dce7] bg-white p-6 shadow-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#886a8a]">Student academic record</p>
        <h2 className="mt-1 text-2xl font-bold text-[#35103b]">{string(student.full_name) || currentUser.name}</h2>
        <p className="mt-1 text-sm text-slate-600">{string(student.student_number)} · {string(student.program_title)} · {string(student.status)}</p>
      </div>
      <button type="button" onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded-lg border border-[#dacbdb] px-3 py-2 text-sm font-medium text-[#4a1249] hover:bg-[#faf4fa]"><RefreshCw className="h-4 w-4"/> Refresh</button>
    </div>
    <div className="grid gap-4 sm:grid-cols-3">
      {[
        {label:'Course enrollments',value:String(registrations.filter(r=>r.status === 'enrolled').length),Icon:BookOpen},
        {label:'Published grades',value:String(gradesByRegistration.size),Icon:GraduationCap},
        {label:'Recorded outstanding balance',value:money(student.balance_cents),Icon:CreditCard},
      ].map(({label,value,Icon})=><div key={label} className="rounded-2xl border border-[#e6dce7] bg-white px-5 py-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm text-slate-600"><Icon className="h-4 w-4 text-[#4a1249]"/>{label}</div>
        <strong className="text-2xl font-bold text-[#35103b]">{value}</strong>
      </div>)}
    </div>
    <StudentUnifiedSearchFilter source={{registrations,grades:state?.grades ?? [],invoices}} />
    <Panel title="Enrollment and published results">
      {registrations.length === 0 ? <Empty>No courses have been registered against your verified record.</Empty> :
      <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead><tr className="border-b text-slate-600"><th className="px-3 py-3">Course</th><th className="px-3 py-3">Term</th><th className="px-3 py-3">Enrollment</th><th className="px-3 py-3">Published result</th></tr></thead>
        <tbody>{registrations.map(r=>{
          const grade=gradesByRegistration.get(r.id);
          return <tr key={string(r.id)} className="border-b last:border-0">
            <td className="px-3 py-3 font-semibold text-[#35103b]">{string(r.course_code)} — {string(r.course_title)}</td>
            <td className="px-3 py-3">{string(r.term_title)}</td><td className="px-3 py-3 capitalize">{string(r.status)}</td>
            <td className="px-3 py-3">{grade ? [grade.letter,grade.score != null ? `(${grade.score})` : ''].filter(Boolean).join(' ') : 'Not published'}</td>
          </tr>;
        })}</tbody>
      </table></div>}
    </Panel>
    <Panel title="Invoices and payments">
      {invoices.length === 0 ? <Empty>No posted invoices are available for your student account.</Empty> :
      <div className="space-y-3">{invoices.map(i=><div key={string(i.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-4">
        <div className="flex items-center gap-2"><ClipboardList className="h-5 w-5 text-[#4a1249]"/><div><p className="font-semibold text-[#35103b]">{string(i.number)}</p><p className="text-xs text-slate-600">Due {stamp(i.due_date)} · {string(i.term_title)}</p></div></div>
        <div className="text-right"><p className="font-semibold">{money(i.amount_cents)}</p><p className="text-xs text-slate-600">Outstanding {money(i.balance_cents)}</p></div>
      </div>)}</div>}
      {payments.length > 0 && <p className="mt-4 text-xs text-slate-600">{payments.length} payment record(s) associated with your invoices. Only reconciled transactions reduce confirmed outstanding balances.</p>}
    </Panel>
    <StudentActivityTimeline />
    <p className="text-xs text-slate-600">This workspace displays server-authorized records only. Messaging, document issuance, and other original AI Studio features remain under controlled integration until their security and persistence checks pass.</p>
  </div>;
};
