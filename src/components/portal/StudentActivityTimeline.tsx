import React, { useEffect, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';

type StudentEvent = { id: string; action: 'register'|'drop'|'graduationRequest'|'transcriptRequest'|'ADD_DROP_SUBMITTED'; created_at: string };
const labels: Record<StudentEvent['action'],string> = {
  register: 'Submitted course registration',
  drop: 'Updated course enrollment',
  graduationRequest: 'Requested graduation review',
  transcriptRequest: 'Requested an academic transcript',
  ADD_DROP_SUBMITTED: 'Submitted an Add/Drop request to the Registrar',
};

export const StudentActivityTimeline: React.FC = () => {
  const [events,setEvents] = useState<StudentEvent[]>([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const reload = async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const res=await fetch('/api/workspaces/student-activity',{credentials:'same-origin',cache:'no-store',signal});
      if (!res.ok) throw new Error(res.status === 401 ? 'Session expired. Sign in again.' : res.status === 403 ? 'Only your student account may access this history.' : 'Unable to retrieve your activity history.');
      const data=await res.json();
      if (!Array.isArray(data.activities)) throw new Error('Invalid activity response.');
      if (!signal?.aborted) setEvents(data.activities.filter((event: StudentEvent) => Object.prototype.hasOwnProperty.call(labels,event.action)));
    } catch(e) {
      if (!signal?.aborted) { setEvents([]); setError(e instanceof Error ? e.message : 'Unable to load activity.'); }
    } finally { if (!signal?.aborted) setLoading(false); }
  };
  useEffect(()=>{const c=new AbortController();void reload(c.signal);return ()=>c.abort();},[]);
  return <section aria-label="Your academic activity" className="rounded-2xl border border-[#e6dce7] bg-white p-5 shadow-sm">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2"><Activity className="h-5 w-5 text-[#4a1249]" aria-hidden="true"/><h2 className="text-lg font-semibold text-[#35103b]">Your academic activity</h2></div>
      <button type="button" onClick={()=>void reload()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-[#dacbdb] px-3 py-2 text-sm font-medium text-[#4a1249] disabled:opacity-60 hover:bg-[#faf4fa]"><RefreshCw className="h-4 w-4" aria-hidden="true"/>Refresh history</button>
    </div>
    <p className="mb-4 text-sm text-slate-600">Actions performed using your student account. Institutional updates by faculty and staff are not included.</p>
    {loading ? <p role="status" className="text-sm text-slate-600">Loading verified activity…</p> :
    error ? <p role="alert" className="text-sm text-red-700">{error}</p> :
    events.length===0 ? <div role="status" className="rounded-lg bg-[#faf8fb] p-5 text-center text-sm text-slate-600">No recorded academic actions yet. This is not a demonstration timeline.</div> :
    <ol className="relative ml-2 border-l-2 border-[#e4d6e5] pl-6">
      {events.map(event=><li key={event.id} className="relative mb-5 last:mb-0">
        <span className="absolute -left-[32px] top-1 h-3 w-3 rounded-full border-2 border-white bg-[#4a1249]"/>
        <p className="text-sm font-semibold text-[#35103b]">{labels[event.action]}</p>
        <time className="text-xs text-slate-600" dateTime={event.created_at}>{Number.isFinite(Date.parse(event.created_at)) ? new Date(event.created_at).toLocaleString() : 'Date not recorded'}</time>
      </li>)}
    </ol>}
  </section>;
};
