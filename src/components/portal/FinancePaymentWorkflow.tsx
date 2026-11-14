import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {Banknote,RefreshCcw,ShieldCheck} from 'lucide-react';
import type {UserProfile} from '../../types';

type Invoice={
 id:string;number:string;student_id:string;student_number:string;full_name:string;term_title:string;
 amount_cents:number;balance_cents:number;due_date:string;
};
type Payment={
 id:string;invoice_id:string;invoice_number:string;full_name:string;reference:string;external_reference?:string;amount_cents:number;
 method:'bank'|'mobile_money'|'cash';received_date:string;status:'recorded'|'reconciled'|'cancelled';
 recorded_by:string;reviewed_by?:string|null;review_note?:string;created_at:string;reviewed_at?:string|null;
};
type State={invoices:Invoice[];payments:Payment[]};

const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const safeDate=(value:string)=>{
 const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(value||'');
 return m?new Intl.DateTimeFormat('en-US',{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'})
  .format(new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])))):value;
};

async function csrf(){
 const response=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});
 const data=await response.json().catch(()=>({}));
 if(!response.ok||typeof data.csrf!=='string'||!data.csrf)
  throw new Error('Session verification unavailable. Refresh and sign in again.');
 return data.csrf as string;
}
async function action(name:string,data:object){
 const token=await csrf();
 const response=await fetch('/api/workspaces/action',{
  method:'POST',credentials:'same-origin',
  headers:{'Content-Type':'application/json','x-csrf-token':token},
  body:JSON.stringify({action:name,data}),
 });
 const payload=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(payload.error||'Finance action failed.');
 return payload.result;
}

export const FinancePaymentWorkflow:React.FC<{currentUser:UserProfile}>=({currentUser})=>{
 const [state,setState]=useState<State|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const [invoiceId,setInvoiceId]=useState('');
 const [amount,setAmount]=useState('');
 const [method,setMethod]=useState<'bank'|'mobile_money'|'cash'>('bank');
 const [externalReference,setExternalReference]=useState('');
 const [receivedDate,setReceivedDate]=useState('');
 const [reviewNotes,setReviewNotes]=useState<Record<string,string>>({});

 const load=useCallback(async()=>{
  setError('');
  const response=await fetch('/api/workspaces/state',{credentials:'same-origin',cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'Could not load payment records.');
  setState({invoices:Array.isArray(data.invoices)?data.invoices:[],payments:Array.isArray(data.payments)?data.payments:[]});
 },[]);

 useEffect(()=>{void load().catch(e=>setError(e instanceof Error?e.message:'Could not load payment records.'));},[load]);

 const openInvoices=useMemo(()=>state?.invoices.filter(invoice=>invoice.balance_cents>0)||[],[state]);
 const selected=openInvoices.find(invoice=>invoice.id===invoiceId)||openInvoices[0]||null;
 const recorded=useMemo(()=>state?.payments.filter(payment=>payment.status==='recorded')||[],[state]);

 const record=async()=>{
  if(!selected||busy)return;
  setBusy(true);setError('');setMessage('');
  try{
   const result=await action('payment',{
    invoiceId:selected.id,amount,method,externalReference:externalReference.trim(),receivedDate,
   });
   setMessage('Payment '+result.reference+' recorded. It is not yet settled and requires independent reconciliation.');
   setAmount('');setExternalReference('');setReceivedDate('');setInvoiceId('');
   await load();
  }catch(e){setError(e instanceof Error?e.message:'Payment could not be recorded.');}
  finally{setBusy(false);}
 };

 const review=async(payment:Payment,status:'reconciled'|'cancelled')=>{
  if(busy)return;
  const note=(reviewNotes[payment.id]||'').trim();
  if(note.length<5){setError('Enter a reconciliation note of at least 5 characters.');return;}
  if(!window.confirm(status==='reconciled'
    ?'Reconcile this recorded payment? This will reduce the official student balance.'
    :'Cancel this recorded payment?'))return;
  setBusy(true);setError('');setMessage('');
  try{
   await action('reconcilePayment',{id:payment.id,status,note});
   setMessage(status==='reconciled'
    ?'Payment reconciled and audited. The official student balance has been reduced.'
    :'Recorded payment cancelled and audited.');
   await load();
  }catch(e){setError(e instanceof Error?e.message:'Payment review could not be completed.');}
  finally{setBusy(false);}
 };

 return <section className="space-y-5 rounded-2xl border border-[#DED1E3] bg-white p-5 text-[#35103B] shadow-sm">
  <div className="flex flex-wrap items-start justify-between gap-3">
   <div>
    <h2 className="flex items-center gap-2 text-xl font-bold"><Banknote className="h-5 w-5"/> Payment Recording & Reconciliation</h2>
    <p className="mt-1 text-sm text-slate-700">Record actual received funds against a posted invoice, then require an independent authorized reviewer to reconcile or cancel the payment.</p>
   </div>
   <button type="button" onClick={()=>void load().catch(e=>setError(e instanceof Error?e.message:'Refresh failed.'))}
    className="inline-flex items-center gap-2 rounded-lg border border-[#D8C8DC] px-3 py-2 text-sm font-semibold text-[#4A1249] hover:bg-[#F4EDF4]">
    <RefreshCcw className="h-4 w-4"/> Refresh payments
   </button>
  </div>

  {error&&<p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{error}</p>}
  {message&&<p role="status" className="rounded-lg border border-[#D8C8DC] bg-[#FAF7FB] p-3 text-sm font-medium text-[#4A1249]">{message}</p>}

  <div className="rounded-xl border border-[#E6DCE7] bg-[#FAF8FB] p-4">
   <h3 className="font-bold text-[#4A1249]">Record received payment</h3>
   <p className="mt-1 text-xs text-slate-600">Recording does not settle the account. A second authorized reviewer must reconcile it before the student balance or official receipt changes.</p>
   {!openInvoices.length?<p className="mt-3 text-sm text-slate-600">No invoice with an outstanding balance is currently available.</p>:
   <div className="mt-4 grid gap-3 md:grid-cols-2">
    <label className="text-sm font-semibold">Student invoice
     <select value={selected?.id||''} onChange={e=>setInvoiceId(e.target.value)}
      className="mt-1 w-full rounded-lg border border-[#D8C8DC] bg-white p-2.5">
      {openInvoices.map(invoice=><option key={invoice.id} value={invoice.id}>
       {invoice.number} · {invoice.student_number} · {invoice.full_name} · balance {money(invoice.balance_cents)}
      </option>)}
     </select>
    </label>
    <label className="text-sm font-semibold">Amount received (USD)
     <input value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal" placeholder="0.00"
      className="mt-1 w-full rounded-lg border border-[#D8C8DC] bg-white p-2.5"/>
    </label>
    <label className="text-sm font-semibold">Payment method
     <select value={method} onChange={e=>setMethod(e.target.value as any)}
      className="mt-1 w-full rounded-lg border border-[#D8C8DC] bg-white p-2.5">
      <option value="bank">Bank</option><option value="mobile_money">Mobile money</option><option value="cash">Cash</option>
     </select>
    </label>
    <label className="text-sm font-semibold">External transaction reference {method==='cash'&&<span className="font-normal text-slate-500">(optional for cash)</span>}
     <input value={externalReference} onChange={e=>setExternalReference(e.target.value)} maxLength={120}
      placeholder={method==='bank'?'Bank slip / deposit reference':method==='mobile_money'?'Mobile Money provider transaction ID':'Optional cashier/source reference'}
      className="mt-1 w-full rounded-lg border border-[#D8C8DC] bg-white p-2.5"/>
     <span className="mt-1 block text-xs font-normal text-slate-500">The ERP will automatically generate the official HIAU payment reference.</span>
    </label>
    <label className="text-sm font-semibold">Received date
     <input type="date" value={receivedDate} onChange={e=>setReceivedDate(e.target.value)}
      className="mt-1 w-full rounded-lg border border-[#D8C8DC] bg-white p-2.5"/>
    </label>
    <div className="flex items-end">
     <button type="button" disabled={busy||!amount.trim()||!receivedDate||(method!=='cash'&&!externalReference.trim())} onClick={()=>void record()}
      className="hiau-finance-primary rounded-lg px-4 py-2.5 text-sm font-bold">
      {busy?'Recording…':'Record payment'}
     </button>
    </div>
   </div>}
  </div>

  <div className="rounded-xl border border-[#E6DCE7] p-4">
   <h3 className="flex items-center gap-2 font-bold text-[#4A1249]"><ShieldCheck className="h-5 w-5"/> Independent reconciliation queue</h3>
   <p className="mt-1 text-xs text-slate-600">Only reconciled payments reduce the official balance and become eligible for an official HIAU receipt.</p>
   {!recorded.length?<p className="mt-4 text-sm text-slate-600">No recorded payments are awaiting reconciliation.</p>:
   <div className="mt-4 space-y-4">{recorded.map(payment=>{
    const sameRecorder=payment.recorded_by===currentUser.id;
    return <article key={payment.id} className="rounded-lg border border-[#E6DCE7] p-4">
     <div className="flex flex-wrap justify-between gap-3">
      <div><p className="font-bold">{payment.invoice_number} · {payment.full_name}</p>
       <p className="text-sm text-slate-700">{money(payment.amount_cents)} · {payment.method.replaceAll('_',' ')}</p>
       <p className="text-sm font-semibold text-[#4A1249]">HIAU payment reference: {payment.reference}</p>
       {payment.external_reference&&<p className="text-xs text-slate-600">External transaction reference: {payment.external_reference}</p>}
       <p className="text-xs text-slate-500">Received {safeDate(payment.received_date)} · Status recorded</p></div>
     </div>
     {sameRecorder?<p className="mt-3 rounded border border-[#E5D3A6] bg-[#FFF9EA] p-3 text-xs text-[#6F4F16]">Independent reconciliation required: the account that recorded this payment cannot reconcile it.</p>:
     <div className="mt-3 space-y-2">
      <label className="block text-sm font-semibold">Reconciliation note
       <textarea rows={2} value={reviewNotes[payment.id]||''}
        onChange={e=>setReviewNotes(v=>({...v,[payment.id]:e.target.value}))}
        className="mt-1 w-full rounded-lg border border-[#D8C8DC] p-2.5" placeholder="Verification source and result"/>
      </label>
      <div className="flex flex-wrap gap-2">
       <button type="button" disabled={busy} onClick={()=>void review(payment,'reconciled')}
        className="hiau-finance-primary rounded-lg px-4 py-2 text-sm font-semibold">Reconcile payment</button>
       <button type="button" disabled={busy} onClick={()=>void review(payment,'cancelled')}
        className="rounded-lg border border-[#4A1249] px-4 py-2 text-sm font-semibold text-[#4A1249] disabled:opacity-50">Cancel payment</button>
      </div>
     </div>}
    </article>;
   })}</div>}
  </div>
 </section>;
};
