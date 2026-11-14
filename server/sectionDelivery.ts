export type SectionDeliveryMode='classroom'|'online'|'hybrid';

const PLACEHOLDERS=new Set([
 'tba','tbd','to be announced','to be determined','not assigned','not configured','n/a','na','-','—'
]);

export function meaningfulSectionValue(value:any):string{
 const trimmed=String(value??'').trim();
 if(!trimmed)return '';
 return PLACEHOLDERS.has(trimmed.toLowerCase())?'':trimmed;
}

export function sectionSetupIssue(section:any):string|null{
 const mode=(section?.delivery_mode||'classroom') as SectionDeliveryMode;
 const location=meaningfulSectionValue(section?.location);
 const classroom=meaningfulSectionValue(section?.classroom);
 const online=meaningfulSectionValue(section?.online_classroom);

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
