export type SectionDeliveryMode='classroom'|'online'|'hybrid';

export function sectionSetupIssue(section:any):string|null{
 const mode=(section?.delivery_mode||'classroom') as SectionDeliveryMode;
 const location=String(section?.location||'').trim();
 const classroom=String(section?.classroom||'').trim();
 const online=String(section?.online_classroom||'').trim();

 if(mode==='classroom'){
  if(!location&&!classroom)return 'Campus / location and classroom / room are required.';
  if(!location)return 'Campus / location is required.';
  if(!classroom)return 'Classroom / room is required.';
  return null;
 }
 if(mode==='online'){
  if(!online)return 'Online classroom / LMS reference is required.';
  return null;
 }
 if(mode==='hybrid'){
  const missing:string[]=[];
  if(!location)missing.push('campus / location');
  if(!classroom)missing.push('classroom / room');
  if(!online)missing.push('online classroom / LMS reference');
  return missing.length?('Hybrid setup incomplete: '+missing.join(', ')+' required.'):null;
 }
 return 'A valid delivery mode is required.';
}

export function sectionSetupComplete(section:any):boolean{
 return sectionSetupIssue(section)===null;
}
