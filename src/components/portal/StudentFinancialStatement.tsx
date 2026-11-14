import React,{useCallback,useEffect,useState} from 'react';
import {Download,ReceiptText} from 'lucide-react';
import type {UserProfile} from '../../types';
import {downloadUniversityInvoice,downloadUniversityReceipt} from '../../utils/studentFinanceDocuments';
type Statement={
 linked:boolean;studentNumber?:string;studentName?:string;currency:'USD';totalBalanceCents:number;
 invoices:{
 id:string;number:string;term_title:string;amount_cents:number;due_date:string;created_at:string;balance_cents:number;
 lines:{description:string;amount_cents:number}[];
 credits:{amount_cents:number;reason:string;created_at:string}[];
 payments:{id:string;reference:string;amount_cents:number;method:string;received_date:string;status:string;
  reviewed_at?:string|null;review_note?:string|null;created_at?:string}[];
 }[];
};
const money=(v:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v/100);
export const StudentFinancialStatement:React.FC<{currentUser:UserProfile}>=({currentUser})=>{
 const [statement,setStatement]=useState<Statement|null>(null);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[documentBusy,setDocumentBusy]=useState('');
 const refresh=useCallback(async()=>{
  if(currentUser.role!=='student')return;
  setBusy(true);setError('');
  try{
   const response=await fetch('/api/student/my-statement',{credentials:'same-origin',cache:'no-store'});
   const data=await response.json();
   if(!response.ok)throw Error(data.error||'Statement not available.');
   setStatement(data);
  }catch(e){setError(e instanceof Error?e.message:'Statement not available.');setStatement(null);}
  finally{setBusy(false);}
 },[currentUser.id,currentUser.role]);
 useEffect(()=>{void refresh();},[refresh]);
 if(currentUser.role!=='student')return null;
 return <section aria-label="My posted tuition and payment statement"
   className="mt-5 rounded-xl border border-purple-200 bg-white p-4 sm:p-6">
   <div className="flex flex-wrap items-start justify-between gap-2">
    <div><h2 className="text-xl font-bold text-[#4A1249]">My Financial Statement</h2>
     <p className="mt-1 text-sm text-slate-600">Actual posted invoices, credits and payment statuses from your own academic account.</p></div>
    <button type="button" disabled={busy} onClick={()=>void refresh()}
     className="rounded border border-purple-300 px-3 py-2 text-xs font-semibold text-[#4A1249] disabled:opacity-50">Refresh statement</button>
   </div>
   {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
   {statement&&!statement.linked&&<p className="mt-3 rounded bg-amber-50 p-3 text-sm">A Registrar-linked admitted student record is required to view your posted financial statement.</p>}
   {statement?.linked&&<div className="mt-4">
     <p className="text-base font-semibold text-[#4A1249]">Total posted balance: {money(statement.totalBalanceCents)}</p>
     <p className="mt-1 text-xs text-slate-600">Course plans and unapproved fee estimates are not bills. Recorded payments are not treated as settled until reconciled.</p>
     {statement.invoices.length===0?<p className="mt-4 rounded border border-dashed p-4 text-sm text-slate-600">There are no posted tuition invoices for this student.</p>:
      <div className="mt-4 space-y-4">{statement.invoices.map(invoice=><article key={invoice.id}
        className="rounded-lg border border-purple-200 p-4 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
         <div><h3 className="font-bold">{invoice.number} · {invoice.term_title}</h3>
          <p className="mt-1 text-slate-600">Due: {invoice.due_date} · Billed: {money(invoice.amount_cents)} · Balance: <strong>{money(invoice.balance_cents)}</strong></p></div>
         <button type="button" disabled={!!documentBusy} onClick={async()=>{
          setDocumentBusy('invoice-'+invoice.id);setError('');
          try{await downloadUniversityInvoice({
           studentName:statement.studentName||currentUser.name,
           studentNumber:statement.studentNumber||'',
           invoice,
          });}catch(e){setError(e instanceof Error?e.message:'Invoice PDF could not be created.');}
          finally{setDocumentBusy('');}
         }} className="inline-flex items-center gap-2 rounded border border-[#4A1249] px-3 py-2 text-xs font-semibold text-[#4A1249] disabled:opacity-50">
          <Download className="h-4 w-4"/>{documentBusy==='invoice-'+invoice.id?'Preparing…':'Download invoice PDF'}
         </button>
        </div>
        <div className="mt-3 space-y-1">{invoice.lines.map((line,index)=><div key={index} className="flex justify-between gap-3">
          <span>{line.description}</span><span className="shrink-0">{money(line.amount_cents)}</span>
        </div>)}</div>
        {invoice.credits.map((credit,index)=><p key={index} className="mt-2 text-green-800">Credit: {money(credit.amount_cents)} — {credit.reason}</p>)}
        {invoice.payments.map((payment,index)=><div key={payment.id||index} className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded bg-slate-50 px-3 py-2 text-slate-600">
          <span>Payment {payment.reference} · {money(payment.amount_cents)} · <strong>{payment.status}</strong></span>
          {payment.status==='reconciled'&&<button type="button" disabled={!!documentBusy} onClick={async()=>{
           setDocumentBusy('receipt-'+(payment.id||index));setError('');
           try{await downloadUniversityReceipt({
            studentName:statement.studentName||currentUser.name,
            studentNumber:statement.studentNumber||'',
            invoice,payment,
           });}catch(e){setError(e instanceof Error?e.message:'Receipt PDF could not be created.');}
           finally{setDocumentBusy('');}
          }} className="inline-flex items-center gap-2 rounded border border-emerald-700 px-3 py-1.5 text-xs font-semibold text-emerald-800 disabled:opacity-50">
           <ReceiptText className="h-4 w-4"/>{documentBusy==='receipt-'+(payment.id||index)?'Preparing…':'Download official receipt'}
          </button>}
        </div>)}
       </article>)}</div>}
   </div>}
 </section>;
};
