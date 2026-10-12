import { createAudioStrip } from '../../ui/patterns/audio-strip.js';
import { enhanceChooseSelect } from '../../ui/patterns/choose-select.js';
import { encodeSoundFont, parseSoundFont, generateSample } from './soundfont.js';
import { SoundFontPreview, chooseAuditionNote } from './preview-audio.js';
import { openLibrary, temporaryLibrary, safeSourceUrl, waveformPeaks } from './library.js';
import { createSoundFontService } from '../../sound-fonts/bank-service.js';

const $ = id => document.getElementById(id);
const audio = new SoundFontPreview({ onError: showError });
const colors = ['#a6eeb4', '#dfb5fb', '#f2bc7b', '#84d7e0'];
const sampleNames = {glass:'Glass bell',warm:'Warm wave',pluck:'Wire pluck',sample:'Your sample'};
let library, bankService, unsubscribeLibrary, entries = [], selectedId = null, selectedFont = null, selectedBytes = null;
let view = 'explore', filter = 'all', selectionVersion = 0, busy = false, disposed = false;
let sourceSample = null, sampleVersion = 0, previewTimer = null, drawingFrame = null;
let activeFont = null, presetIndex = 0, auditionNote = null;
let navigationVersion = 0, auditionVersion = 0;
const pressed = new Map();
let bundledFonts = [];
const bankLoads = new Map();
const assetUrl = path => new URL(`../../../${path}`, import.meta.url);
const readFont = bytes => ({ ...parseSoundFont(bytes, { metadataOnly: true }), bytes });
const isPlayerView = () => view === 'collection' || view === 'explore';

function status(message) { $('status').textContent = message; }
function showError(error) {
  const target = $('linkDialog').open ? $('linkError') : $('error');
  target.textContent = error?.message || String(error); target.hidden = false;
}
function clearError() { $('error').hidden = true; $('linkError').hidden = true; }
function selectedEntry() { return entries.find(entry => entry.id === selectedId); }
function sizeLabel(bytes) { return bytes < 1048576 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`; }
function element(tag, className, text) { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; }
function resetKeys() { pressed.clear(); document.querySelectorAll('.sf-key.is-playing').forEach(key => key.classList.remove('is-playing')); }
function stop() { auditionVersion++; clearTimeout(previewTimer); auditionNote=null; audio.stopAll(); resetKeys(); $('playbackStatus').textContent=audio.enabled?'Ready to play':'Audio off'; }

const audioStrip = createAudioStrip({
  buttonId:'audioButton', levelId:'output', level:.6,
  onLevelInput: value => audio.setVolume(value),
  async onAudioClick() {
    clearError();
    audioStrip.setAudioDisabled(true);
    audioStrip.setAudioState('starting');
    try { await audio.setEnabled(!audio.enabled); }
    catch (error) { showError(error); }
    finally {
      audioStrip.setAudioDisabled(false);
      audioStrip.setAudioState(audio.enabled ? 'on' : 'off');
      audioStrip.setAttention(false);
      if (!audio.enabled) stop();
      $('playbackStatus').textContent=audio.enabled?'Ready to play':'Audio off';
      updateKeyboard();
    }
  },
});
$('audioControl').replaceWith(audioStrip);
await import('../../../nav.js');
const presetPicker=enhanceChooseSelect($('presetSelect'),{label:'Preset',placeholder:'Find a preset'});
$('enableAudio').addEventListener('click',()=>audioStrip.audioButton.click());

function showView(next) {
  navigationVersion++;
  selectionVersion++;
  view = next;
  for (const name of ['collection','workshop','sources']) $(name + 'View').hidden = name === 'collection' ? !isPlayerView() : name !== next;
  $('exploreBrowser').hidden=next!=='explore'; $('collectionBrowser').hidden=next!=='collection';
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === next)));
  stop();
  if (isPlayerView() && selectedFont && activeFont !== selectedFont) { void audio.setFont(selectedFont).then(updateKeyboard).catch(showError); audio.setPreset(presetIndex); activeFont = selectedFont; }
  if (next === 'workshop') updateDraft();
  updateKeyboard();
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
for (const id of ['createButton','emptyCreate']) $(id).addEventListener('click', () => showView('workshop'));

function miniWave(peaks, color) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 100 60'); svg.setAttribute('aria-hidden','true');
  const path = document.createElementNS(ns,'path');
  const values = peaks.length ? peaks : [0,0,0,0,0,0];
  const scale = Math.max(.05,...values);
  let d = '';
  for (let i=0;i<values.length;i++) { const x=5+i*90/values.length, height=values[i]/scale*22; d += `M${x.toFixed(1)},${30-height}V${30+height} `; }
  path.setAttribute('d',d); path.setAttribute('stroke',color); path.setAttribute('stroke-width','1');
  svg.append(path); return svg;
}

function renderList() {
  const query = $('search').value.toLowerCase().trim();
  const visible = entries.filter(entry => (filter === 'all' || filter === 'favorite' && entry.favorite || entry.kind === filter)
    && `${entry.name} ${entry.author} ${entry.notes}`.toLowerCase().includes(query));
  $('fontCount').textContent = entries.length;
  $('emptyState').hidden = visible.length > 0;
  $('fontList').replaceChildren(...visible.map(entry => {
    const button = element('button','sf-font-row'); button.type='button'; button.dataset.fontId=entry.id;
    button.setAttribute('aria-pressed',String(entry.id===selectedId));
    const copy = element('span','sf-row-copy');
    copy.append(element('strong','',`${entry.name}${entry.favorite ? ' ★' : ''}`));
    const origin = entry.kind==='created'?'Made here':entry.kind==='imported'?'Imported':entry.kind==='factory'?'Morphazoid originals':'Source link';
    copy.append(element('small','',`${entry.author || origin} · ${entry.kind==='link'?'Saved for later':`${entry.presetCount} preset${entry.presetCount===1?'':'s'} · ${sizeLabel(entry.size)}`}`));
    button.append(miniWave(entry.peaks || [],entry.color || colors[0]),copy,element('span','sf-format',entry.kind==='link'?'LINK':(entry.format || 'sf2').toUpperCase()));
    button.addEventListener('click',() => select(entry.id).catch(showError));
    return button;
  }));
}

function paintWave(canvas, data, color=colors[0]) {
  const context = canvas.getContext('2d');
  const {width,height}=canvas;
  context.clearRect(0,0,width,height);
  context.strokeStyle='#26382c'; context.lineWidth=1;
  for(let i=1;i<8;i++) { context.beginPath(); context.moveTo(width*i/8,0); context.lineTo(width*i/8,height); context.stroke(); }
  context.beginPath(); context.moveTo(0,height/2); context.lineTo(width,height/2); context.stroke();
  const peaks=waveformPeaks(data,Math.floor(width/3)); if(!peaks.length) return;
  const max=Math.max(.02,...peaks);
  context.strokeStyle=color; context.lineWidth=2;
  for(let i=0;i<peaks.length;i++) { const x=10+i*(width-20)/peaks.length,amp=peaks[i]/max*height*.39; context.beginPath(); context.moveTo(x,height/2-amp); context.lineTo(x,height/2+amp); context.stroke(); }
}

function renderDetails() {
  const entry=selectedEntry();
  $('inspectorEmpty').hidden=Boolean(entry); $('inspectorContent').hidden=!entry;
  if (!entry) return;
  $('selectedName').textContent=entry.name;
  $('selectedAuthor').textContent=entry.author || 'Creator not specified';
  $('selectedKind').textContent=({factory:'MORPHAZOID ORIGINAL',created:'CREATED SOUND FONT',imported:'IMPORTED SOUNDFONT',link:'SAVED SOURCE'})[entry.kind];
  $('selectedLicense').textContent=entry.license || 'Not specified';
  $('selectedNotes').textContent=entry.notes || '';
  $('selectedStats').textContent=entry.kind==='link'?'Source link':`${entry.presetCount} presets · ${entry.sampleCount} samples · ${sizeLabel(entry.size)}`;
  $('favoriteButton').textContent=entry.favorite?'★':'☆';
  $('favoriteButton').setAttribute('aria-pressed',String(Boolean(entry.favorite)));
  $('favoriteButton').setAttribute('aria-label',entry.favorite?'Remove from favorites':'Add to favorites');
  $('downloadButton').textContent=`↓ Download ${(entry.format || 'sf2').toUpperCase()}`;
  $('downloadButton').hidden=entry.kind==='link'; $('downloadButton').disabled=!selectedBytes;
  $('playableDetails').hidden=!selectedFont; $('linkOnlyNotice').hidden=entry.kind!=='link';
  $('sourceLink').hidden=!entry.source;
  if(entry.source) { try { $('sourceLink').href=safeSourceUrl(entry.source); } catch { $('sourceLink').hidden=true; } }
  $('fontWarnings').textContent=selectedFont?.warnings?.join(' ') || '';
  for(const [id,key] of [['editName','name'],['editAuthor','author'],['editSource','source'],['editLicense','license'],['editNotes','notes']]) $(id).value=entry[key] || '';
  const presets=selectedFont?.presets || [];
  $('presetSelect').replaceChildren(...presets.map((preset,index) => new Option(`${preset.name} · ${preset.bank}:${preset.program}`,index)));
  $('presetSelect').value=String(presetIndex);
  presetPicker.refresh();
  paintSelectedWave(); updateKeyboard(); renderPresets();
}
function paintSelectedWave() {
  const zone=selectedFont?.presets[Number($('presetSelect').value)||0]?.zones[0];
  paintWave($('waveform'),selectedFont?.samples[zone?.sampleIndex ?? 0]?.data,selectedEntry()?.color);
}
async function select(id, preset = null) {
  navigationVersion++;
  const serial=++selectionVersion;
  selectedId=id; presetIndex=0; selectedFont=null; selectedBytes=null; stop(); audio.setFont(null); activeFont=null;
  renderList(); renderDetails(); clearError();
  const entry=selectedEntry(); if(!entry || entry.kind==='link') return;
  const bytes=await library.file(id);
  if(serial!==selectionVersion || disposed) return;
  if(!bytes) throw new Error('The font file is missing. Import the original SoundFont again.');
  const font=readFont(bytes);
  if(serial!==selectionVersion) return;
  selectedBytes=bytes; selectedFont=font;
  if(preset) presetIndex=Math.max(0,font.presets.findIndex(value=>value.bank===preset.bank && value.program===preset.program));
  const ready=audio.setFont(font); audio.setPreset(presetIndex); activeFont=font;
  await ready;
  if(serial!==selectionVersion || disposed) return false;
  renderDetails(); return true;
}
async function refresh() { entries=(await library.list()).sort((a,b)=>b.createdAt-a.createdAt); renderList(); renderBundledFonts(); renderPresets(); }
function setFilter(next) { filter=next; document.querySelectorAll('[data-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.filter===next))); renderList(); }
$('search').addEventListener('input',renderList);
$('filters').addEventListener('click',event=>{ if(event.target.dataset.filter) setFilter(event.target.dataset.filter); });
function changePreset(index) {
  stop(); presetIndex=index; audio.setPreset(index); $('presetSelect').value=String(index);
  presetPicker.refresh();
  paintSelectedWave(); updateKeyboard(); renderPresets();
  if(audio.enabled) void action(previewSelected);
}
$('presetSelect').addEventListener('change',()=>changePreset(Number($('presetSelect').value)));
$('nextPreset').addEventListener('click',()=>{
  if(view==='explore') {
    const presets=visiblePresets(), current=presets.findIndex(isCurrentPreset);
    if(presets.length) void action(()=>explorePreset(presets[(current+1)%presets.length]));
  } else if(selectedFont) changePreset((presetIndex+1)%selectedFont.presets.length);
});

async function action(handler) { clearError(); try { await handler(); } catch(error) { showError(error); } }
function download(bytes,name,format='sf2') {
  const blob=new Blob([bytes],{type:'application/octet-stream'}), url=URL.createObjectURL(blob);
  const link=document.createElement('a'); link.href=url; link.download=(name.replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'') || 'sound-font')+'.'+format;
  document.body.append(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('downloadButton').addEventListener('click',()=>{ if(selectedBytes) download(selectedBytes,selectedEntry().name,selectedEntry().format || selectedFont?.format || 'sf2'); });
$('favoriteButton').addEventListener('click',()=>action(async()=>{
  const entry=selectedEntry(); if(!entry) return;
  await library.put({...entry,favorite:!entry.favorite}); await refresh(); renderDetails();
}));
$('editForm').addEventListener('submit',event=>{ event.preventDefault(); void action(async()=>{
  const entry=selectedEntry(); if(!entry) return;
  const name=$('editName').value.trim(); if(!name) throw new Error('Give this sound a name.');
  await library.put({...entry,name,author:$('editAuthor').value.trim(),source:safeSourceUrl($('editSource').value),license:$('editLicense').value.trim(),notes:$('editNotes').value.trim()});
  await refresh(); renderDetails(); status('Details saved. Downloaded originals retain their embedded credits.');
}); });
let deletingId=null;
$('deleteButton').addEventListener('click',()=>{ deletingId=selectedId; $('deleteDialog').returnValue='cancel'; $('deleteMessage').textContent=`Remove “${selectedEntry().name}” from this browser? Download it first if you need a backup.`; $('deleteDialog').showModal(); });
$('deleteDialog').addEventListener('close',()=>{ if($('deleteDialog').returnValue==='remove') void action(async()=>{
  const id=deletingId; await library.remove(id); await refresh(); if(selectedId===id) await select(entries[0]?.id || null); status('Removed from this browser.');
}); });

$('addLinkButton').addEventListener('click',()=>{ clearError(); $('linkForm').reset(); $('linkDialog').showModal(); });
$('closeLink').addEventListener('click',()=>$('linkDialog').close());
$('linkForm').addEventListener('submit',event=>{ event.preventDefault(); void action(async()=>{
  const name=$('linkName').value.trim(); if(!name) throw new Error('Give the link a name.');
  const entry={id:crypto.randomUUID(),name,source:safeSourceUrl($('linkUrl').value),notes:$('linkNotes').value.trim(),kind:'link',createdAt:Date.now(),author:'',license:'',peaks:[]};
  await library.put(entry); $('linkDialog').close(); await refresh(); setFilter('all'); $('search').value=''; await select(entry.id); status('Source link saved.');
}); });

function metadata(font,bytes,{name=font.name,kind='imported',...rest}={}) {
  return {id:crypto.randomUUID(),name,kind,format:font.format || 'sf2',author:font.author || '',license:font.license || '',notes:'',source:'',createdAt:Date.now(),size:bytes.byteLength,presetCount:font.presets.length,sampleCount:font.samples.length,peaks:waveformPeaks(font.samples[0]?.data),color:colors[entries.length%colors.length],...rest};
}
function allPresets() {
  const originals=entries.filter(entry=>entry.kind==='factory').map(entry=>({id:entry.id,displayName:entry.name,family:'Morphazoid',bankName:'Originals'}));
  return [...originals,...bundledFonts.flatMap(bank=>(bank.presets || []).map(preset=>({...preset,bundleId:bank.id,bankName:bank.name})))];
}
function visiblePresets() {
  const query=$('presetSearch').value.trim().toLowerCase(), family=$('familySelect').value;
  return allPresets().filter(preset=>(!family || preset.family===family) && `${preset.displayName} ${preset.name || ''} ${preset.family} ${preset.bankName}`.toLowerCase().includes(query));
}
function isCurrentPreset(preset) {
  if(preset.id) return selectedId===preset.id;
  const current=selectedFont?.presets[presetIndex];
  return Boolean(current && selectedEntry()?.bundleId===preset.bundleId && current.bank===preset.bank && current.program===preset.program);
}
function selectedPresetInfo() {
  const current=selectedFont?.presets[presetIndex];
  return bundledFonts.find(bank=>bank.id===selectedEntry()?.bundleId)?.presets?.find(preset=>preset.bank===current?.bank && preset.program===current?.program);
}
function renderPresets() {
  const presets=allPresets(), family=$('familySelect').value;
  $('familySelect').replaceChildren(new Option('All families',''),...[...new Set(presets.map(preset=>preset.family))].sort().map(value=>new Option(value,value)));
  $('familySelect').value=family;
  $('presetCount').textContent=String(presets.length);
  const visible=visiblePresets(); $('presetEmpty').hidden=visible.length>0;
  $('presetList').replaceChildren(...visible.map(preset=>{
    const button=element('button','sf-preset-card'); button.type='button';
    button.dataset.preset=preset.id || `${preset.bundleId}:${preset.bank}:${preset.program}`;
    button.setAttribute('aria-pressed',String(isCurrentPreset(preset)));
    button.append(element('strong','',preset.displayName),element('small','',`${preset.family} · ${preset.bankName}`));
    button.addEventListener('click',()=>action(()=>explorePreset(preset)));
    return button;
  }));
}
async function explorePreset(preset) {
  clearError();
  const intent=++navigationVersion;
  selectionVersion++;
  // A new selection releases the previous sound immediately, including while a bank downloads.
  stop();
  const downloadAuditionIntent=auditionVersion;
  let id=preset.id;
  if(!id) {
    const bank=bundledFonts.find(value=>value.id===preset.bundleId);
    const entry=await ensureBundledFont(bank);
    if(!entry || disposed || intent!==navigationVersion) return;
    id=entry.id;
  }
  const mayPreview=downloadAuditionIntent===auditionVersion;
  const selection=select(id,preset), serial=selectionVersion, loadAuditionIntent=auditionVersion;
  const selected=await selection;
  if(!selected || serial!==selectionVersion || disposed || selectedId!==id || !isPlayerView()) return;
  status('');
  if(mayPreview && loadAuditionIntent===auditionVersion && audio.enabled) void action(previewSelected);
}
$('presetSearch').addEventListener('input',renderPresets);
$('familySelect').addEventListener('change',renderPresets);
function renderBundledFonts() {
  $('bundledFonts').replaceChildren(...bundledFonts.map(bank => {
    const card=element('article','sf-bank'); card.dataset.bankId=bank.id;
    card.append(element('span','sf-source-number',`${bank.presetCount} PRESETS · ${sizeLabel(bank.bytes)}`),element('h3','',bank.name),element('p','',bank.description),element('p','sf-small',`${bank.author} · ${bank.license}`));
    const actions=element('div','sf-actions');
    const saved=entries.find(entry=>entry.bundleId===bank.id);
    const add=element('button','sf-button sf-primary',bankLoads.has(bank.id)?'Loading…':saved?'Open in collection':'Add to collection');
    add.type='button'; add.disabled=bankLoads.has(bank.id); add.setAttribute('aria-label',`${saved?'Open':'Add'} ${bank.name}${saved?'':' to collection'}`);
    add.addEventListener('click',()=>action(()=>addBundledFont(bank)));
    const downloadLink=element('a','sf-button',`Download ${(bank.format || 'sf2').toUpperCase()}`); downloadLink.href=assetUrl(bank.file); downloadLink.download=bank.file.split('/').pop();
    actions.append(add,downloadLink); card.append(actions);
    const links=element('div','sf-bank-links');
    for(const [label,url] of [['Source ↗',bank.sourceUrl],['Credits',assetUrl(bank.creditFile)],['License',assetUrl(bank.licenseFile)]]) {
      const link=element('a','',label); link.href=url; link.target='_blank'; link.rel='noopener noreferrer'; links.append(link);
    }
    card.append(links); return card;
  }));
}
async function ensureBundledFont(bank) {
  const saved=entries.find(value=>value.bundleId===bank.id);
  if(saved) return saved;
  if(bankLoads.has(bank.id)) return bankLoads.get(bank.id).promise;
  const controller=new AbortController(), load={controller};
  bankLoads.set(bank.id,load); renderBundledFonts();
  load.promise=(async()=>{
    const timer=setTimeout(()=>controller.abort(),60000);
    status(`Loading ${bank.name}…`);
    try {
      const {bytes}=await bankService.resolve(`bundled-${bank.id}`,{signal:controller.signal});
      const font=readFont(bytes);
      if(disposed) return null;
      const entry=metadata(font,bytes,{id:`bundled-${bank.id}`,bundleId:bank.id,name:bank.name,author:bank.author,license:bank.license,source:bank.sourceUrl,notes:`${bank.description}\n${bank.attribution}\nCredits and license: ${assetUrl(bank.licenseFile)}`});
      await library.put(entry,bytes); await refresh();
      return entry;
    } catch(error) {
      if(disposed) return null;
      if(error.name==='AbortError') throw new Error(`Loading ${bank.name} timed out. Try again.`);
      throw new Error(`Could not load ${bank.name}. ${error.message}`);
    } finally {
      clearTimeout(timer); bankLoads.delete(bank.id);
      if(!disposed) {
        renderBundledFonts();
        if($('status').textContent===`Loading ${bank.name}…`) status('');
      }
    }
  })();
  return load.promise;
}
async function addBundledFont(bank) {
  const intent=++navigationVersion;
  const entry=await ensureBundledFont(bank);
  if(!entry || disposed || intent!==navigationVersion) return;
  $('search').value=''; setFilter('all'); showView('collection'); await select(entry.id);
  status(`${bank.name} is ready.`);
}
async function loadBundledCatalog() {
  try {
    const response=await fetch(assetUrl('assets/sound-fonts/catalog.json'));
    if(!response.ok) throw new Error('Could not load the free banks. Reload to try again.');
    bundledFonts=await response.json();
    if(disposed) return;
    renderBundledFonts(); renderPresets(); updateKeyboard();
    $('catalogStatus').textContent=`${bundledFonts.length} free banks · files load when you explore a preset, add a bank, or download it.`;
  } catch(error) { if(!disposed) $('catalogStatus').textContent=error.message; }
}
$('importButton').addEventListener('click',()=>$('fontFiles').click());
$('fontFiles').addEventListener('change',()=>action(async()=>{
  const files=[...$('fontFiles').files]; $('fontFiles').value=''; if(!files.length) return;
  if(files.length>8) throw new Error('Import up to eight fonts at a time.');
  let last=null, imported=0, failures=[];
  $('importButton').disabled=true;
  try {
    for(const file of files) {
      try {
        if(file.size>128*1024*1024) throw new Error('SoundFont files must be 128 MiB or smaller.');
        status(`Importing ${file.name}…`);
        const bytes=await file.arrayBuffer(), font=readFont(bytes), entry=metadata(font,bytes,{name:font.name || file.name.replace(/\.sf[23]$/i,'')});
        await library.put(entry,bytes); imported++; last=entry.id;
      } catch(error) { failures.push(`${file.name}: ${error.message}`); }
    }
    await refresh(); showView('collection'); setFilter('all'); $('search').value=''; renderList(); if(last) await select(last);
    status(`Imported ${imported} font${imported===1?'':'s'}.`); if(failures.length) showError(new Error(failures.join(' ')));
  } finally { $('importButton').disabled=false; }
}));

// Full two-row chromatic computer-key layout, also available as native buttons.
const keyboardRows=[
  [['KeyQ','Q'],['Digit2','2'],['KeyW','W'],['Digit3','3'],['KeyE','E'],['KeyR','R'],['Digit5','5'],['KeyT','T'],['Digit6','6'],['KeyY','Y'],['Digit7','7'],['KeyU','U'],['KeyI','I'],['Digit9','9'],['KeyO','O'],['Digit0','0'],['KeyP','P']],
  [['KeyZ','Z'],['KeyS','S'],['KeyX','X'],['KeyD','D'],['KeyC','C'],['KeyV','V'],['KeyG','G'],['KeyB','B'],['KeyH','H'],['KeyN','N'],['KeyJ','J'],['KeyM','M'],['Comma',','],['KeyL','L'],['Period','.'],['Semicolon',';'],['Slash','/']],
];
const keyMap=new Map();
const noteNames=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
function startKey(code,note,button) {
  if(pressed.has(code) || !selectedFont || !isPlayerView() || button.disabled) return;
  if(!audio.enabled) { $('playbackStatus').textContent='Enable audio to play'; audioStrip.setAttention(true); return; }
  if(activeFont!==selectedFont) { void audio.setFont(selectedFont).then(updateKeyboard).catch(showError); audio.setPreset(presetIndex); activeFont=selectedFont; }
  if(audio.noteOn(note)!==null) { pressed.set(code,note); button.classList.add('is-playing'); $('playbackStatus').textContent='Playing'; }
}
function endKey(code,button) {
  const note=pressed.get(code); pressed.delete(code);
  if(note!==undefined && ![...pressed.values()].includes(note)) audio.noteOff(note);
  button?.classList.remove('is-playing');
  if(!pressed.size && auditionNote===null) $('playbackStatus').textContent=audio.enabled?'Ready to play':'Audio off';
}
for(let rowIndex=0;rowIndex<keyboardRows.length;rowIndex++) {
  const row=element('div','sf-key-row');
  keyboardRows[rowIndex].forEach(([code,label],index)=>{
    const note=(rowIndex===0?60:48)+index, name=noteNames[note%12]+(Math.floor(note/12)-1);
    const button=element('button','sf-key'); button.type='button'; button.dataset.note=note; button.dataset.sharp=String(name.includes('♯'));
    button.setAttribute('aria-label',`Play ${name}, key ${label}`);
    button.append(element('span','',name),element('kbd','',label)); keyMap.set(code,{note,button,index,rowIndex,label});
    button.addEventListener('pointerdown',event=>{ if(event.button!==0) return; event.preventDefault(); button.setPointerCapture(event.pointerId); startKey(`pointer:${event.pointerId}`,keyMap.get(code).note,button); });
    for(const eventName of ['pointerup','pointercancel','lostpointercapture']) button.addEventListener(eventName,event=>endKey(`pointer:${event.pointerId}`,button));
    button.addEventListener('click',event=>{ if(event.detail===0) { startKey(`accessible:${code}`,keyMap.get(code).note,button); setTimeout(()=>endKey(`accessible:${code}`,button),500); } });
    row.append(button);
  });
  $('keyboard').append(row);
}
function updateKeyboard() {
  const playable=Boolean(selectedFont);
  const preset=selectedFont?.presets[presetIndex], base=selectedPresetInfo()?.keyboardBase ?? 48;
  for(const key of keyMap.values()) {
    const {button,index,rowIndex,label}=key;
    const note=base+(rowIndex===0?12:0)+index, name=noteNames[note%12]+(Math.floor(note/12)-1);
    key.note=note; button.dataset.note=String(note); button.dataset.sharp=String(name.includes('♯'));
    button.firstChild.textContent=name; button.setAttribute('aria-label',`Play ${name}, key ${label}`);
    button.disabled=!preset?.zones.some(zone=>note>=zone.lowKey && note<=zone.highKey && 95>=zone.lowVelocity && 95<=zone.highVelocity);
  }
  $('auditionButton').disabled=!playable;
  $('nextPreset').disabled=view==='explore'?!visiblePresets().length:!playable || selectedFont.presets.length<2;
  $('enableAudio').hidden=audio.enabled;
  $('enableAudio').disabled=audioStrip.audioButton.disabled;
  $('keyboardHint').textContent=`Audio ${audio.enabled?'on':'off'} · ${playable?'click keys or use your computer keyboard':'select a SoundFont to play'}`;
}
window.addEventListener('keydown',event=>{
  if(event.code==='Escape') { stop(); return; }
  if(event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target.closest?.('input,select,textarea,[contenteditable="true"],dialog') || !isPlayerView()) return;
  const key=keyMap.get(event.code); if(!key) return;
  event.preventDefault(); startKey(event.code,key.note,key.button);
});
window.addEventListener('keyup',event=>{ const key=keyMap.get(event.code); if(key) endKey(event.code,key.button); });
window.addEventListener('blur',stop);
document.addEventListener('visibilitychange',()=>{ if(document.hidden) stop(); });
async function audition(font,note=60) {
  const intent=navigationVersion, auditionIntent=++auditionVersion;
  if(!audio.enabled) { $('playbackStatus').textContent='Enable audio to preview'; audioStrip.setAttention(true); return; }
  clearTimeout(previewTimer);
  if(auditionNote!==null) audio.noteOff(auditionNote);
  if(activeFont!==font) { const ready=audio.setFont(font); if(font===selectedFont) audio.setPreset(presetIndex); activeFont=font; await ready; }
  else await audio.prepareBank();
  if(disposed || intent!==navigationVersion || auditionIntent!==auditionVersion || document.hidden || !audio.enabled || activeFont!==font) return;
  auditionNote=audio.noteOn(note);
  if(auditionNote===null) { $('playbackStatus').textContent='No playable note in this preset'; return; }
  $('playbackStatus').textContent=`Playing ${font===selectedFont?(selectedPresetInfo()?.displayName || font.presets[presetIndex].name):font.name}`;
  const zones=font.presets[font===selectedFont?presetIndex:0].zones.filter(zone=>note>=zone.lowKey && note<=zone.highKey && 95>=zone.lowVelocity && 95<=zone.highVelocity);
  const hold=Math.min(6000,Math.max(1200,...zones.map(zone=>(zone.attack+.7)*1000)));
  previewTimer=setTimeout(()=>{ audio.noteOff(note); auditionNote=null; $('playbackStatus').textContent='Ready to play'; },hold);
}
function previewSelected() {
  if(!selectedFont) return;
  const preset=selectedFont.presets[presetIndex], suggested=selectedPresetInfo()?.previewNote;
  const note=Number.isInteger(suggested) && preset.zones.some(zone=>suggested>=zone.lowKey && suggested<=zone.highKey && 95>=zone.lowVelocity && 95<=zone.highVelocity)?suggested:chooseAuditionNote(preset);
  if(note===null) { $('playbackStatus').textContent='No playable note in this preset'; return; }
  return audition(selectedFont,note);
}
$('auditionButton').addEventListener('click',()=>action(previewSelected));
$('stopButton').addEventListener('click',stop);

function sourceKind() { return document.querySelector('[name=sourceKind]:checked').value; }
function draftSample() {
  if(sourceKind()==='sample') {
    if(!sourceSample) throw new Error('Choose an audio sample first.');
    return sourceSample;
  }
  return {data:generateSample({kind:sourceKind(),rootKey:Number($('rootKey').value),duration:Number($('duration').value),brightness:Number($('brightness').value),sampleRate:22050}),sampleRate:22050};
}
function draftBytes() {
  const name=$('fontName').value.trim(); if(!name) throw new Error('Give your font a name.');
  const sample=draftSample();
  return encodeSoundFont({name,author:$('fontAuthor').value.trim(),license:$('fontLicense').value.trim() || (sourceKind()==='sample'?'Unspecified — check the source sample license':'Original synthesized sample; free to use and modify'),attack:Number($('attack').value),release:Number($('release').value),samples:[{name,data:sample.data,sampleRate:sample.sampleRate,rootKey:Number($('rootKey').value),lowKey:0,highKey:127}]});
}
function updateDraft() {
  const fromFile=sourceKind()==='sample';
  $('sampleFields').hidden=!fromFile; $('brightnessField').hidden=fromFile; $('durationField').hidden=fromFile;
  $('draftSourceLabel').textContent=sampleNames[sourceKind()].toUpperCase();
  for(const [id,format] of [['duration',v=>`${v.toFixed(1)} s`],['brightness',v=>`${Math.round(v*100)}%`],['attack',v=>`${v.toFixed(2)} s`],['release',v=>`${v.toFixed(2)} s`]]) $(id+'Out').textContent=format(Number($(id).value));
  cancelAnimationFrame(drawingFrame);
  drawingFrame=requestAnimationFrame(()=>{
    if(disposed) return;
    let sample=null;
    try { sample=draftSample(); } catch { /* File not selected yet. */ }
    paintWave($('draftWaveform'),sample?.data);
    $('draftDuration').textContent=sample?`${(sample.data.length/sample.sampleRate).toFixed(1)} seconds`:'Choose a sample';
  });
}
$('workshopForm').addEventListener('input',updateDraft);
$('sampleFile').addEventListener('change',()=>action(async()=>{
  const version=++sampleVersion, file=$('sampleFile').files[0]; sourceSample=null;
  if(!file) { updateDraft(); return; }
  try {
    if(file.size>20*1024*1024) throw new Error('Choose an audio sample smaller than 20 MB.');
    const OfflineContext=globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    if(!OfflineContext) throw new Error('This browser cannot decode audio samples.');
    status(`Reading ${file.name}…`);
    const buffer=await new OfflineContext(1,1,22050).decodeAudioData(await file.arrayBuffer());
    if(version!==sampleVersion || disposed) return;
    if(buffer.duration>30) throw new Error('Trim the sample to 30 seconds or less before importing.');
    const data=new Float32Array(buffer.length);
    for(let channel=0;channel<buffer.numberOfChannels;channel++) { const input=buffer.getChannelData(channel); for(let i=0;i<data.length;i++) data[i]+=input[i]/buffer.numberOfChannels; }
    let peak=0; for(const value of data) peak=Math.max(peak,Math.abs(value));
    if(peak>0.75) for(let i=0;i<data.length;i++) data[i]*=.75/peak;
    const fade=Math.min(220,Math.floor(data.length/10));
    for(let i=0;i<fade;i++) { data[i]*=i/fade; data[data.length-1-i]*=i/fade; }
    sourceSample={data,sampleRate:buffer.sampleRate};
    $('sampleInfo').textContent=`${file.name} · ${buffer.duration.toFixed(1)} s · mixed to mono · ${buffer.sampleRate} Hz`;
    status('Sample ready. Match its root note, then create your font.'); updateDraft();
  } catch(error) { if(version===sampleVersion) { $('sampleInfo').textContent='Sample not loaded. Choose another audio file.'; updateDraft(); } throw error; }
}));
$('previewDraft').addEventListener('click',()=>action(async()=>{ if(!audio.enabled) { status('Turn Audio on in the header to hear the draft.'); return; } const bytes=draftBytes(); await audition(readFont(bytes),Number($('rootKey').value)); }));
$('workshopForm').addEventListener('submit',event=>{ event.preventDefault(); void action(async()=>{
  if(busy) return; busy=true; $('saveFont').disabled=true;
  try {
    const bytes=draftBytes(), font=readFont(bytes);
    const entry=metadata(font,bytes,{kind:'created',name:$('fontName').value.trim(),notes:$('fontNotes').value.trim() || `${sampleNames[sourceKind()]} · root ${noteNames[Number($('rootKey').value)%12]}${Math.floor(Number($('rootKey').value)/12)-1}`});
    await library.put(entry,bytes); await refresh(); $('search').value=''; setFilter('all'); showView('collection'); await select(entry.id);
    status(`“${entry.name}” created. Play it here or download its SF2.`);
  } finally { busy=false; $('saveFont').disabled=false; }
}); });

async function initialize() {
  let storageError = null;
  try { library=await openLibrary(); }
  catch(error) { library=temporaryLibrary(); $('storageStatus').textContent='Temporary session · storage unavailable'; storageError=new Error(`${error.message} Download anything you create before closing this tab.`); }
  bankService=createSoundFontService({library});
  if(library.persistent) $('storageStatus').textContent='Saved in this browser · no account needed';
  if(!await library.setting('initialized')) {
    const demos=[['Glass Signals','glass','Ringing, inharmonic bell tones. A bright place to begin.'],['Soft Circuit','warm','A rounded, gently moving synthetic tone.'],['Copper Wire','pluck','A dry, textured pluck with a fading harmonic tail.']];
    for(let i=0;i<demos.length;i++) {
      const [name,kind,notes]=demos[i];
      const bytes=encodeSoundFont({name,author:'Morphazoid',license:'Original synthesized sample; free to use and modify',samples:[{name,data:generateSample({kind,rootKey:60,duration:2.5,brightness:.55,sampleRate:22050}),sampleRate:22050,rootKey:60,lowKey:0,highKey:127}]});
      await library.put(metadata(readFont(bytes),bytes,{id:`original-${kind}`,name,kind:'factory',notes,color:colors[i],createdAt:3-i}),bytes);
    }
    await library.setSetting('initialized',true);
  }
  await refresh(); await select(entries[0]?.id || null); updateDraft();
  void loadBundledCatalog();
  unsubscribeLibrary=library.subscribe?.(()=>{ if(!disposed) void refresh().catch(showError); });
  status('');
  if(storageError) showError(storageError);
}
window.addEventListener('pagehide',()=>{ disposed=true; for(const {controller} of bankLoads.values()) controller.abort(); stop(); cancelAnimationFrame(drawingFrame); void audio.dispose(); unsubscribeLibrary?.(); bankService?.dispose(); library?.close(); audioStrip.destroy(); presetPicker.destroy(); });
window.addEventListener('pageshow',event=>{ if(event.persisted) location.reload(); });
void initialize().catch(showError);
