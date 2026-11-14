type FinanceLine={description:string;amount_cents:number};
type FinanceCredit={amount_cents:number;reason:string;created_at:string};
type FinancePayment={
 id:string;reference:string;amount_cents:number;method:string;received_date:string;status:string;
 reviewed_at?:string|null;review_note?:string|null;
};
type FinanceInvoice={
 id:string;number:string;term_title:string;amount_cents:number;due_date:string;created_at:string;balance_cents:number;
 lines:FinanceLine[];credits:FinanceCredit[];payments:FinancePayment[];
};

const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
export const universityDate=(value:string)=>{
 const match=/^(\d{4})-(\d{2})-(\d{2})/.exec(value||'');
 if(!match)return value||'Not recorded';
 const date=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])));
 return new Intl.DateTimeFormat('en-US',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'}).format(date);
};
const fileSafe=(value:string)=>value.replace(/[^A-Za-z0-9._-]+/g,'-').replace(/-+/g,'-');

let logoPromise:Promise<string|null>|null=null;
const universityLogo=()=>{
 if(logoPromise)return logoPromise;
 logoPromise=fetch('/assets/aistudio/image_bfcc4a11.png',{cache:'force-cache'})
  .then(response=>response.ok?response.blob():Promise.reject(new Error('logo unavailable')))
  .then(blob=>new Promise<string>((resolve,reject)=>{
   const reader=new FileReader();
   reader.onload=()=>resolve(String(reader.result||''));
   reader.onerror=()=>reject(reader.error);
   reader.readAsDataURL(blob);
  }))
  .catch(()=>null);
 return logoPromise;
};

const addInstitutionHeader=async(doc:any,title:string,reference:string)=>{
 const purple:[number,number,number]=[74,18,73],gold:[number,number,number]=[195,154,83];
 const logo=await universityLogo();
 if(logo){try{doc.addImage(logo,'PNG',18,13,22,22);}catch{}}
 doc.setTextColor(...purple);doc.setFont('helvetica','bold');doc.setFontSize(15);
 doc.text('HARVEST INTERCONTINENTAL',45,20);
 doc.setTextColor(...gold);doc.setFontSize(10);
 doc.text('AMERICAN UNIVERSITY',45,26);
 doc.setTextColor(55,65,81);doc.setFont('helvetica','normal');doc.setFontSize(8.5);
 doc.text('Liberia · University Operations · Student Finance Office',45,31);
 doc.setDrawColor(...gold);doc.setLineWidth(0.7);doc.line(18,39,192,39);
 doc.setTextColor(...purple);doc.setFont('helvetica','bold');doc.setFontSize(16);
 doc.text(title,18,50);
 doc.setTextColor(71,85,105);doc.setFont('helvetica','normal');doc.setFontSize(8.5);
 doc.text('ERP reference: '+reference,192,50,{align:'right'});
 return 60;
};
const labelValue=(doc:any,label:string,value:string,x:number,y:number,width=78)=>{
 doc.setTextColor(100,116,139);doc.setFont('helvetica','bold');doc.setFontSize(7.5);doc.text(label.toUpperCase(),x,y);
 doc.setTextColor(30,41,59);doc.setFont('helvetica','normal');doc.setFontSize(9.5);
 const lines=doc.splitTextToSize(value||'—',width);doc.text(lines,x,y+5);return y+5+lines.length*4;
};
const footer=(doc:any)=>{
 const pages=doc.getNumberOfPages();
 for(let page=1;page<=pages;page++){
  doc.setPage(page);doc.setDrawColor(226,232,240);doc.line(18,279,192,279);
  doc.setTextColor(100,116,139);doc.setFontSize(7.2);doc.setFont('helvetica','normal');
  doc.text('Generated from the HIAU ERP student finance ledger. Alteration invalidates this document.',18,284);
  doc.text('Page '+page+' of '+pages,192,284,{align:'right'});
 }
};

export async function downloadUniversityInvoice(input:{
 studentName:string;studentNumber:string;invoice:FinanceInvoice;
}){
 const {jsPDF}=await import('jspdf');
 const doc=new jsPDF({unit:'mm',format:'a4'});
 const invoice=input.invoice;
 let y=await addInstitutionHeader(doc,'OFFICIAL TUITION INVOICE',invoice.number);
 labelValue(doc,'Student',input.studentName,18,y);
 labelValue(doc,'Student number',input.studentNumber,106,y);
 y+=18;
 labelValue(doc,'Academic term',invoice.term_title,18,y);
 labelValue(doc,'Invoice date',universityDate(invoice.created_at),106,y);
 y+=18;
 labelValue(doc,'Due date',universityDate(invoice.due_date),18,y);
 labelValue(doc,'Invoice number',invoice.number,106,y);
 y+=18;

 doc.setFillColor(248,250,252);doc.setDrawColor(226,232,240);doc.roundedRect(18,y,174,10,1.5,1.5,'FD');
 doc.setTextColor(71,85,105);doc.setFont('helvetica','bold');doc.setFontSize(8);
 doc.text('DESCRIPTION',21,y+6.5);doc.text('AMOUNT (USD)',188,y+6.5,{align:'right'});y+=14;
 doc.setFont('helvetica','normal');doc.setFontSize(9);
 for(const line of invoice.lines){
  const description=doc.splitTextToSize(line.description,132);
  const rowHeight=Math.max(9,description.length*4+3);
  if(y+rowHeight>250){doc.addPage();y=20;}
  doc.setTextColor(30,41,59);doc.text(description,21,y+4);
  doc.text(money(line.amount_cents),188,y+4,{align:'right'});
  doc.setDrawColor(241,245,249);doc.line(18,y+rowHeight,192,y+rowHeight);y+=rowHeight;
 }
 y+=5;
 const creditTotal=invoice.credits.reduce((sum,row)=>sum+row.amount_cents,0);
 const reconciledTotal=invoice.payments.filter(row=>row.status==='reconciled').reduce((sum,row)=>sum+row.amount_cents,0);
 const totals=[
  ['Original billed amount',invoice.amount_cents],
  ['Posted credits / assistance',-creditTotal],
  ['Reconciled payments',-reconciledTotal],
  ['Current invoice balance',invoice.balance_cents],
 ] as const;
 for(const [label,cents] of totals){
  doc.setFont('helvetica',label==='Current invoice balance'?'bold':'normal');
  doc.setTextColor(label==='Current invoice balance'?74:71,label==='Current invoice balance'?18:85,label==='Current invoice balance'?73:105);
  doc.text(label,118,y,{align:'right'});
  doc.text((cents<0?'-':'')+money(Math.abs(cents)),188,y,{align:'right'});y+=7;
 }
 if(invoice.credits.length){
  y+=3;doc.setTextColor(74,18,73);doc.setFont('helvetica','bold');doc.text('CREDITS / ASSISTANCE',18,y);y+=6;
  doc.setFont('helvetica','normal');doc.setTextColor(71,85,105);doc.setFontSize(8);
  for(const credit of invoice.credits){doc.text(doc.splitTextToSize(money(credit.amount_cents)+' · '+credit.reason,170),18,y);y+=8;}
 }
 doc.setFillColor(250,248,251);doc.setDrawColor(222,209,227);doc.roundedRect(18,253,174,18,2,2,'FD');
 doc.setTextColor(74,18,73);doc.setFont('helvetica','bold');doc.setFontSize(8.5);
 doc.text('PAYMENT NOTICE',22,260);
 doc.setTextColor(71,85,105);doc.setFont('helvetica','normal');doc.setFontSize(7.7);
 doc.text(doc.splitTextToSize('This invoice reflects posted university charges. Scholarships, waivers and payments affect the payable balance only when separately authorized and posted in the ERP ledger.',164),22,265);
 footer(doc);
 doc.save('HIAU-Invoice-'+fileSafe(invoice.number)+'.pdf');
}

export async function downloadUniversityReceipt(input:{
 studentName:string;studentNumber:string;invoice:FinanceInvoice;payment:FinancePayment;
}){
 if(input.payment.status!=='reconciled')throw new Error('Only reconciled payments can generate an official receipt.');
 const {jsPDF}=await import('jspdf');
 const doc=new jsPDF({unit:'mm',format:'a4'});
 const {invoice,payment}=input;
 let y=await addInstitutionHeader(doc,'OFFICIAL PAYMENT RECEIPT',payment.reference);
 labelValue(doc,'Student',input.studentName,18,y);
 labelValue(doc,'Student number',input.studentNumber,106,y);
 y+=18;
 labelValue(doc,'Invoice',invoice.number,18,y);
 labelValue(doc,'Academic term',invoice.term_title,106,y);
 y+=18;
 labelValue(doc,'Payment date',universityDate(payment.received_date),18,y);
 labelValue(doc,'Payment method',payment.method.replaceAll('_',' '),106,y);
 y+=18;
 labelValue(doc,'Receipt / bank reference',payment.reference,18,y);
 labelValue(doc,'Verification status','RECONCILED / VERIFIED',106,y);
 y+=22;

 doc.setFillColor(250,248,251);doc.setDrawColor(195,154,83);doc.setLineWidth(0.6);doc.roundedRect(18,y,174,42,2,2,'FD');
 doc.setTextColor(100,116,139);doc.setFont('helvetica','bold');doc.setFontSize(8);doc.text('AMOUNT RECEIVED',26,y+12);
 doc.setTextColor(74,18,73);doc.setFontSize(25);doc.text(money(payment.amount_cents),26,y+27);
 doc.setTextColor(71,85,105);doc.setFont('helvetica','normal');doc.setFontSize(8.5);
 doc.text('Current invoice balance after all posted credits and reconciled payments:',106,y+14);
 doc.setFont('helvetica','bold');doc.setTextColor(30,41,59);doc.setFontSize(13);doc.text(money(invoice.balance_cents),106,y+25);
 y+=54;

 doc.setTextColor(74,18,73);doc.setFont('helvetica','bold');doc.setFontSize(9.5);doc.text('PAYMENT VERIFICATION',18,y);y+=7;
 doc.setTextColor(71,85,105);doc.setFont('helvetica','normal');doc.setFontSize(8.5);
 const verified=payment.reviewed_at?universityDate(payment.reviewed_at):'Recorded as reconciled in the ERP ledger';
 doc.text(doc.splitTextToSize('Verification: '+verified+'. This receipt is generated only for a payment whose status is reconciled. A recorded or pending payment is not an official receipt.',172),18,y);
 y+=18;
 if(payment.review_note){
  doc.setTextColor(100,116,139);doc.setFontSize(7.8);
  doc.text(doc.splitTextToSize('Finance verification note: '+payment.review_note,172),18,y);
 }
 footer(doc);
 doc.save('HIAU-Receipt-'+fileSafe(payment.reference)+'.pdf');
}
