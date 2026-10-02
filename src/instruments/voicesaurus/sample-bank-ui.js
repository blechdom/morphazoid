import { enhanceChooseSelect } from '../../ui/patterns/choose-select.js';
import { loadUtauBankFiles, utauBankAliases } from '../vocalzoid/vocalzoid-bank.js';
import { VOCALZOID_OPEN_BANKS, vocalzoidOpenBankCoverage } from '../vocalzoid/vocalzoid-open-banks.js';
import { vocalzoidBankCoverage } from '../vocalzoid/vocalzoid.js';
import { SPELLING_PRONUNCIATION_PHONE_CATALOG } from '../spelling-synthesizer/spelling-pronunciation.js';
import { sampleBankRequest } from './sample-bank-model.js';

const el=(tag,text)=>{const node=document.createElement(tag);if(text)node.textContent=text;return node;};
/** File resources stay in this page session, outside serialized notes/presets. */
export function mountSampleBankSources(host,{getScene,change,error}){
 let bank=null,serial=0,active=true;
 const field=el('label','Sample voice'),source=el('select');source.id='sampleBankSource';source.setAttribute('aria-label','Sample voice');
 source.add(new Option('KAL16 · phoneme atlas','kal'));
 for(const entry of Object.values(VOCALZOID_OPEN_BANKS))source.add(new Option(`${entry.name} · demo`,entry.id));
 const local=new Option('Local UTAU folder','local');local.disabled=true;source.add(local);field.append(source);
 const picker=enhanceChooseSelect(source,{label:'Sample voice'});
 const row=el('div');row.className='native-bank-actions';
 const label=el('label','Choose UTAU folder'),input=el('input');input.type='file';input.multiple=true;input.setAttribute('webkitdirectory','');input.accept='.wav,.wave,.aif,.aiff,.flac,.ogg,.ini,.txt,.frq';input.id='sampleBankFiles';label.append(input);
 const remove=el('button','Remove local bank');remove.type='button';remove.hidden=true;
 row.append(label,remove);const status=el('output');status.id='sampleBankStatus';status.setAttribute('role','status');
 const provenance=el('a');provenance.target='_blank';provenance.rel='noopener';
 host.append(field,row,status,provenance);
 function refresh(){
  const scene=getScene();host.hidden=scene.engine!=='sample-bank';if(host.hidden)return;
  source.value=scene.input.source==='open'?scene.input.openBankId:scene.input.source;picker.refresh();
  local.disabled=!bank;local.textContent=bank?`Local · ${bank.name}`:'Local UTAU folder';remove.hidden=!bank;
  try{
   const {notes}=sampleBankRequest(scene,bank),kind=scene.input.source,demo=VOCALZOID_OPEN_BANKS[scene.input.openBankId];
   const coverage=kind==='open'?vocalzoidOpenBankCoverage(notes):kind==='local'&&bank?vocalzoidBankCoverage(bank.entries,notes):null;
   status.textContent=kind==='local'?(bank?`${bank.name} · ${bank.stats.audioFiles} samples · ${bank.stats.entries} aliases. ${coverage.matched}/${coverage.total} notes matched; other notes use KAL16. Files stay in this browser tab.`:'Reimport the local UTAU folder to play this source.'):kind==='open'?`${coverage.matched}/${coverage.total} notes match this demo. Its eight units cover “vocalzoid”; other syllables use KAL16.`:'KAL16 phoneme samples · retuned and looped for singing.';
   provenance.hidden=kind!=='open';if(kind==='open'){provenance.href=demo.sourceHref;provenance.textContent=`${demo.name} · ${demo.license}`;}
  }catch(reason){status.textContent=reason.message;}
 }
 source.addEventListener('change',()=>{
  const scene=getScene();if(scene.engine!=='sample-bank')return;
  scene.input.source=source.value==='kal'||source.value==='local'?source.value:'open';
  if(scene.input.source==='open')scene.input.openBankId=source.value;
  refresh();change();
 });
 input.addEventListener('change',async()=>{
  const token=++serial,original=getScene(),before=JSON.stringify(original),files=[...input.files];
  if(!files.length)return;status.textContent='Reading local voicebank…';
  try{
   const loaded=await loadUtauBankFiles(files);if(!active||token!==serial)return;
   bank=loaded;local.disabled=false;
   if(getScene()===original&&JSON.stringify(original)===before)original.input.source='local';
   if(getScene().engine==='sample-bank')change();
   refresh();
  }catch(reason){if(active&&token===serial){error(reason);status.textContent='Voicebank import failed.';}}
  finally{if(token===serial)input.value='';}
 });
 remove.addEventListener('click',()=>{serial++;bank=null;local.disabled=true;const scene=getScene();if(scene.engine==='sample-bank'&&scene.input.source==='local'){scene.input.source='kal';change();}refresh();});
 return {refresh,getBank:()=>bank,aliases:()=>bank?utauBankAliases(bank):[],report:result=>{
  if(getScene().engine!=='sample-bank')return;
  status.textContent=`${result.customNotes??0} local · ${result.openNotes??0} demo · ${result.fallbackNotes??0} KAL16 notes. ${(result.warnings??[]).join(' ')}`;
 },destroy(){active=false;serial++;bank=null;picker.destroy();host.replaceChildren();}};
}

/** Exact OTO aliases do not need text conversion or an English pronunciation. */
export function mountSampleBankNote(host,note,{aliases=[],change,getNote=()=>note}){
 const fields=el('div');fields.className='native-bank-note-fields';
 const widgets=[];
 for(const [key,label]of [['lyric','Lyric'],['alias','Exact OTO alias'],['phones','ARPAbet phones']]){
  const field=el('label',label),input=el('input');input.type='text';input.value=key==='phones'?note.input.phones.join(' '):note.input[key];input.setAttribute('aria-label',label);
  if(key==='alias'){
   const list=el('datalist');list.id='sampleBankAliases';for(const alias of aliases.slice(0,4000))list.append(new Option(alias,alias));fields.append(list);input.setAttribute('list',list.id);
  }
  input.addEventListener('change',()=>{getNote().input[key]=key==='phones'?input.value.trim().toUpperCase().split(/\s+/).filter(Boolean):input.value;change();});field.append(input);fields.append(field);
 }
 const field=el('label','Phone / diphthong'),phone=el('select');phone.setAttribute('aria-label','Sample note phone');phone.add(new Option('Choose phone…',''));
 for(const entry of SPELLING_PRONUNCIATION_PHONE_CATALOG)phone.add(new Option(`${entry.id} · ${entry.label??entry.name??''}`,entry.id));
 phone.addEventListener('change',()=>{if(!phone.value)return;const current=getNote();current.input.phones=[phone.value];current.input.alias='';fields.querySelector('[aria-label="ARPAbet phones"]').value=phone.value;fields.querySelector('[aria-label="Exact OTO alias"]').value='';change();});
 field.append(phone);fields.append(field);widgets.push(enhanceChooseSelect(phone,{label:'Sample note phone'}));host.append(fields);
 return ()=>{widgets.forEach(widget=>widget.destroy());fields.remove();};
}
