import React, {useMemo, useState} from 'react';
import {BookOpen, Search, X, GraduationCap, Receipt, Filter} from 'lucide-react';

type Row = Record<string,unknown>;
export type VerifiedSearchSource = {
  registrations: Row[];
  grades: Row[];
  invoices: Row[];
  payments: Row[];
};
type Kind='all'|'course'|'grade'|'invoice'|'receipt';
type Item={id:string;kind:Exclude<Kind,'all'>;title:string;detail:string;subtext:string};
const str=(v:unknown)=> typeof v==='string'?v:'';
const fmtMoney=(c:unknown)=>typeof c==='number' && Number.isFinite(c)
  ?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100)
  :'Not available';

/** Local search only over rows already scoped by the authenticated /api/workspaces/state.
 * Never query the demonstration library or enumerate another student's records.
 */
export function verifiedStudentItems(source:VerifiedSearchSource):Item[]{
  const gradeByRegistration=new Map(source.grades
    .filter(g=>g.status==='published')
    .map(g=>[str(g.registration_id),g]));
  const items:Item[]=[];
  for(const r of source.registrations){
    const code=str(r.course_code);
    const title=str(r.course_title);
    items.push({
      id:'course:'+str(r.id),kind:'course',
      title:[code,title].filter(Boolean).join(' — ')||'Registered course',
      detail:[str(r.term_title),str(r.status)].filter(Boolean).join(' · '),
      subtext:'Registered academic course',
    });
    const grade=gradeByRegistration.get(str(r.id));
    if(grade){
      items.push({
        id:'grade:'+str(grade.id),kind:'grade',
        title:[code,title].filter(Boolean).join(' — ')||'Course result',
        detail:[str(grade.letter),grade.score!=null?'Score: '+String(grade.score):''].filter(Boolean).join(' · '),
        subtext:'Published course result',
      });
    }
  }
  for(const invoice of source.invoices){
    const number=str(invoice.number);
    items.push({
      id:'invoice:'+str(invoice.id),kind:'invoice',
      title:number?'Invoice '+number:'Student invoice',
      detail:'Billed '+fmtMoney(invoice.amount_cents)+' · Outstanding '+fmtMoney(invoice.balance_cents),
      subtext:[str(invoice.term_title),str(invoice.due_date)].filter(Boolean).join(' · '),
    });
  }
  for(const payment of source.payments.filter(p=>p.status==='reconciled')){
    const reference=str(payment.reference);
    items.push({
      id:'receipt:'+str(payment.id),kind:'receipt',
      title:reference?'Receipt '+reference:'Official payment receipt',
      detail:'Received '+fmtMoney(payment.amount_cents)+' · Reconciled',
      subtext:[str(payment.invoice_number),str(payment.received_date),str(payment.method).replaceAll('_',' ')].filter(Boolean).join(' · '),
    });
  }
  return items;
}
export function filterVerifiedStudentItems(items:Item[],query:string,kind:Kind):Item[]{
  const term=query.trim().toLocaleLowerCase();
  return items.filter(item=>(kind==='all'||item.kind===kind)&&
    (!term||[item.title,item.detail,item.subtext].some(text=>text.toLocaleLowerCase().includes(term))));
}
export const StudentUnifiedSearchFilter:React.FC<{source:VerifiedSearchSource}>=({source})=>{
  const [query,setQuery]=useState('');
  const [kind,setKind]=useState<Kind>('all');
  const items=useMemo(()=>verifiedStudentItems(source),[source]);
  const matches=useMemo(()=>filterVerifiedStudentItems(items,query,kind),[items,query,kind]);
  const categories:{value:Kind;label:string}[]=[
    {value:'all',label:'All records'},{value:'course',label:'Courses'},
    {value:'grade',label:'Published grades'},{value:'invoice',label:'Invoices'},{value:'receipt',label:'Receipts'},
  ];
  return <section aria-label="Search your verified academic records" className="rounded-2xl border border-[#e6dce7] bg-white p-5 shadow-sm">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Search aria-hidden="true" className="h-5 w-5 text-[#4a1249]"/>
        <h2 className="text-lg font-semibold text-[#35103b]">Search your records</h2>
      </div>
      <span aria-live="polite" className="text-xs text-slate-600">{matches.length} {matches.length===1?'match':'matches'}</span>
    </div>
    <p className="mb-4 text-sm text-slate-600">Find your own registered courses, published results, invoices and reconciled payment receipts. University-wide catalogs, library files and exam schedules will appear only after their verified integrations are available.</p>
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_210px]">
      <label className="relative block">
        <span className="sr-only">Search your academic records</span>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500"/>
        <input type="search" value={query} onChange={event=>setQuery(event.target.value)}
          placeholder="Course code, name, invoice or term…"
          className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-10 text-sm text-[#35103b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4a1249]"/>
        {query&&<button type="button" onClick={()=>setQuery('')} aria-label="Clear search"
          className="absolute right-3 top-2.5 rounded p-1 text-slate-600 hover:bg-[#f5eff5]"><X className="h-4 w-4"/></button>}
      </label>
      <label className="relative">
        <span className="sr-only">Filter record type</span>
        <Filter className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" aria-hidden="true"/>
        <select value={kind} onChange={event=>setKind(event.target.value as Kind)}
          className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-[#35103b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4a1249]">
          {categories.map(category=><option key={category.value} value={category.value}>{category.label}</option>)}
        </select>
      </label>
    </div>
    <div className="mt-4">
      {matches.length===0?<p role="status" className="rounded-lg bg-[#faf8fb] px-5 py-8 text-center text-sm text-slate-600">
        {items.length===0?'You have no verified records available to search.':'No matching records. Try another search or record type.'}
      </p>:<ul className="max-h-[360px] divide-y divide-slate-100 overflow-y-auto rounded-lg border border-[#eee8ee]">
        {matches.slice(0,50).map(item=>{
          const Icon=item.kind==='course'?BookOpen:item.kind==='grade'?GraduationCap:Receipt;
          return <li key={item.id} className="flex gap-3 px-4 py-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f5eff5] text-[#4a1249]"><Icon className="h-4 w-4" aria-hidden="true"/></span>
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-semibold text-[#35103b]">{item.title}</p>
              <p className="mt-0.5 text-xs text-slate-700">{item.detail}</p>
              <p className="mt-0.5 text-xs text-slate-500">{item.subtext}</p>
            </div>
            <span className="shrink-0 self-start rounded-full bg-[#faf8fb] px-2 py-1 text-[11px] capitalize text-[#4a1249]">{item.kind}</span>
          </li>;
        })}
      </ul>}
      {matches.length>50&&<p className="mt-2 text-xs text-slate-600">Showing the first 50 results. Refine your search to narrow the list.</p>}
    </div>
  </section>;
};
