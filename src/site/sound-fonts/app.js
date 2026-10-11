import { createAudioStrip } from '../../ui/patterns/audio-strip.js';
import { encodeSoundFont, parseSoundFont, generateSample } from './soundfont.js';
import { SoundFontPreview } from './preview-audio.js';
import { openLibrary, temporaryLibrary, safeSourceUrl, waveformPeaks } from './library.js';

const $ = id => document.getElementById(id);
const audio = new SoundFontPreview();
const colors = ['#a6eeb4', '#dfb5fb', '#f2bc7b', '#84d7e0'];
const sampleNames = {glass:'Glass bell',warm:'Warm wave',pluck:'Wire pluck',sample:'Your sample'};
let library, entries = [], selectedId = null, selectedFont = null, selectedBytes = null;
let view = 'collection', filter = 'all', selectionVersion = 0, busy = false, disposed = false;
let sourceSample = null, sampleVersion = 0, previewTimer = null, drawingFrame = null;
let activeFont = null, presetIndex = 0, auditionNote = null;
let navigationVersion = 0;
const pressed = new Map();
let bundledFonts = [];
const bankLoads = new Map();
const assetUrl = path => new URL(`../../../${path}`, import.meta.url);

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
function stop() { clearTimeout(previewTimer); auditionNote=null; audio.stopAll(); resetKeys(); }

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
      if (!audio.enabled) stop();
      updateKeyboard();
    }
  },
});
$('audioControl').append(audioStrip);

function showView(next) {
  navigationVersion++;
  view = next;
  for (const name of ['collection','workshop','sources']) $(name + 'View').hidden = name !== next;
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === next)));
  if (next === 'collection' && selectedFont && activeFont !== selectedFont) { audio.setFont(selectedFont); audio.setPreset(presetIndex); activeFont = selectedFont; }
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
    button.append(miniWave(entry.peaks || [],entry.color || colors[0]),copy,element('span','sf-format',entry.kind==='link'?'LINK':'SF2'));
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
  $('selectedKind').textContent=({factory:'MORPHAZOID ORIGINAL',created:'MADE IN THE WORKSHOP',imported:'IMPORTED SOUNDFONT',link:'SAVED SOURCE'})[entry.kind];
  $('selectedLicense').textContent=entry.license || 'Not specified';
  $('selectedNotes').textContent=entry.notes || '';
  $('selectedStats').textContent=entry.kind==='link'?'Source link':`${entry.presetCount} presets · ${entry.sampleCount} samples · ${sizeLabel(entry.size)}`;
  $('favoriteButton').textContent=entry.favorite?'★':'☆';
  $('favoriteButton').setAttribute('aria-pressed',String(Boolean(entry.favorite)));
  $('favoriteButton').setAttribute('aria-label',entry.favorite?'Remove from favorites':'Add to favorites');
  $('downloadButton').hidden=entry.kind==='link'; $('downloadButton').disabled=!selectedBytes;
  $('playableDetails').hidden=!selectedFont; $('linkOnlyNotice').hidden=entry.kind!=='link';
  $('sourceLink').hidden=!entry.source;
  if(entry.source) { try { $('sourceLink').href=safeSourceUrl(entry.source); } catch { $('sourceLink').hidden=true; } }
  $('fontWarnings').textContent=selectedFont?.warnings?.join(' ') || '';
  for(const [id,key] of [['editName','name'],['editAuthor','author'],['editSource','source'],['editLicense','license'],['editNotes','notes']]) $(id).value=entry[key] || '';
  const presets=selectedFont?.presets || [];
  $('presetSelect').replaceChildren(...presets.map((preset,index) => new Option(`${preset.name} · ${preset.bank}:${preset.program}`,index)));
  $('presetSelect').value=String(presetIndex);
  paintSelectedWave(); updateKeyboard();
}
function paintSelectedWave() {
  const zone=selectedFont?.presets[Number($('presetSelect').value)||0]?.zones[0];
  paintWave($('waveform'),selectedFont?.samples[zone?.sampleIndex ?? 0]?.data,selectedEntry()?.color);
}
async function select(id) {
  navigationVersion++;
  const serial=++selectionVersion;
  selectedId=id; presetIndex=0; selectedFont=null; selectedBytes=null; stop(); audio.setFont(null); activeFont=null;
  renderList(); renderDetails(); clearError();
  const entry=selectedEntry(); if(!entry || entry.kind==='link') return;
  const bytes=await library.file(id);
  if(serial!==selectionVersion || disposed) return;
  if(!bytes) throw new Error('The font file is missing. Import the original SF2 again.');
  const font=parseSoundFont(bytes);
  if(serial!==selectionVersion) return;
  selectedBytes=bytes; selectedFont=font; audio.setFont(font); activeFont=font;
  renderDetails();
}
async function refresh() { entries=(await library.list()).sort((a,b)=>b.createdAt-a.createdAt); renderList(); renderBundledFonts(); }
function setFilter(next) { filter=next; document.querySelectorAll('[data-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.filter===next))); renderList(); }
$('search').addEventListener('input',renderList);
$('filters').addEventListener('click',event=>{ if(event.target.dataset.filter) setFilter(event.target.dataset.filter); });
$('presetSelect').addEventListener('change',()=>{ presetIndex=Number($('presetSelect').value); audio.setPreset(presetIndex); paintSelectedWave(); });

async function action(handler) { clearError(); try { await handler(); } catch(error) { showError(error); } }
function download(bytes,name) {
  const blob=new Blob([bytes],{type:'application/octet-stream'}), url=URL.createObjectURL(blob);
  const link=document.createElement('a'); link.href=url; link.download=(name.replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'') || 'sound-font')+'.sf2';
  document.body.append(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('downloadButton').addEventListener('click',()=>{ if(selectedBytes) download(selectedBytes,selectedEntry().name); });
$('favoriteButton').addEventListener('click',()=>action(async()=>{
  const entry=selectedEntry(); if(!entry) return;
  await library.put({...entry,favorite:!entry.favorite}); await refresh(); renderDetails();
}));
$('editForm').addEventListener('submit',event=>{ event.preventDefault(); void action(async()=>{
  const entry=selectedEntry(); if(!entry) return;
  const name=$('editName').value.trim(); if(!name) throw new Error('Give this sound a name.');
  await library.put({...entry,name,author:$('editAuthor').value.trim(),source:safeSourceUrl($('editSource').value),license:$('editLicense').value.trim(),notes:$('editNotes').value.trim()});
  await refresh(); renderDetails(); status('Details saved. Downloaded original SF2 files retain their embedded credits.');
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
  return {id:crypto.randomUUID(),name,kind,author:font.author || '',license:font.license || '',notes:'',source:'',createdAt:Date.now(),size:bytes.byteLength,presetCount:font.presets.length,sampleCount:font.samples.length,peaks:waveformPeaks(font.samples[0]?.data),color:colors[entries.length%colors.length],...rest};
}
function renderBundledFonts() {
  $('bundledFonts').replaceChildren(...bundledFonts.map(bank => {
    const card=element('article','sf-bank'); card.dataset.bankId=bank.id;
    card.append(element('span','sf-source-number',`${bank.presetCount} PRESETS · ${sizeLabel(bank.bytes)}`),element('h3','',bank.name),element('p','',bank.description),element('p','sf-small',`${bank.author} · ${bank.license}`));
    const actions=element('div','sf-actions');
    const saved=entries.find(entry=>entry.bundleId===bank.id);
    const add=element('button','sf-button sf-primary',bankLoads.has(bank.id)?'Loading…':saved?'Open in collection':'Add to collection');
    add.type='button'; add.disabled=bankLoads.has(bank.id); add.setAttribute('aria-label',`${saved?'Open':'Add'} ${bank.name}${saved?'':' to collection'}`);
    add.addEventListener('click',()=>action(()=>addBundledFont(bank)));
    const downloadLink=element('a','sf-button','Download SF2'); downloadLink.href=assetUrl(bank.file); downloadLink.download=bank.file.split('/').pop();
    actions.append(add,downloadLink); card.append(actions);
    const links=element('div','sf-bank-links');
    for(const [label,url] of [['Source ↗',bank.sourceUrl],['Credits',assetUrl(bank.creditFile)],['License',assetUrl(bank.licenseFile)]]) {
      const link=element('a','',label); link.href=url; link.target='_blank'; link.rel='noopener noreferrer'; links.append(link);
    }
    card.append(links); return card;
  }));
}
async function addBundledFont(bank) {
  if(bankLoads.has(bank.id)) return;
  const intent=++navigationVersion;
  let entry=entries.find(value=>value.bundleId===bank.id);
  if(!entry) {
    const controller=new AbortController(); bankLoads.set(bank.id,controller); renderBundledFonts();
    const timer=setTimeout(()=>controller.abort(),60000);
    status(`Loading ${bank.name}…`);
    try {
      const response=await fetch(assetUrl(bank.file),{signal:controller.signal});
      if(!response.ok) throw new Error(`Could not load ${bank.name} (${response.status}). Try again.`);
      const bytes=await response.arrayBuffer();
      if(bytes.byteLength!==bank.bytes) throw new Error(`The ${bank.name} download is incomplete. Try again.`);
      const font=parseSoundFont(bytes);
      if(disposed) return;
      entry=metadata(font,bytes,{id:`bundled-${bank.id}`,bundleId:bank.id,name:bank.name,author:bank.author,license:bank.license,source:bank.sourceUrl,notes:`${bank.description}\n${bank.attribution}\nCredits and license: ${assetUrl(bank.licenseFile)}`});
      await library.put(entry,bytes); await refresh();
    } catch(error) {
      if(disposed) return;
      if(error.name==='AbortError') throw new Error(`Loading ${bank.name} timed out. Try again.`);
      throw error;
    } finally { clearTimeout(timer); bankLoads.delete(bank.id); if(!disposed) renderBundledFonts(); }
  }
  if(disposed || intent!==navigationVersion) return;
  $('search').value=''; setFilter('all'); showView('collection'); await select(entry.id);
  status(`${bank.name} is ready. Turn Audio on to preview its presets.`);
}
async function loadBundledCatalog() {
  try {
    const response=await fetch(assetUrl('assets/sound-fonts/catalog.json'));
    if(!response.ok) throw new Error('Could not load the free banks. Reload to try again.');
    bundledFonts=await response.json();
    if(disposed) return;
    renderBundledFonts();
    $('catalogStatus').textContent=`${bundledFonts.length} free banks · files load only when you add or download them.`;
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
        if(file.size>128*1024*1024) throw new Error('SF2 files must be 128 MB or smaller.');
        status(`Importing ${file.name}…`);
        const bytes=await file.arrayBuffer(), font=parseSoundFont(bytes), entry=metadata(font,bytes,{name:font.name || file.name.replace(/\.sf2$/i,'')});
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
  if(pressed.has(code) || !audio.enabled || !selectedFont || view!=='collection') return;
  if(activeFont!==selectedFont) { audio.setFont(selectedFont); audio.setPreset(presetIndex); activeFont=selectedFont; }
  if(audio.noteOn(note)!==null) { pressed.set(code,note); button.classList.add('is-playing'); }
}
function endKey(code,button) {
  const note=pressed.get(code); pressed.delete(code);
  if(note!==undefined && ![...pressed.values()].includes(note)) audio.noteOff(note);
  button?.classList.remove('is-playing');
}
for(let rowIndex=0;rowIndex<keyboardRows.length;rowIndex++) {
  const row=element('div','sf-key-row');
  keyboardRows[rowIndex].forEach(([code,label],index)=>{
    const note=(rowIndex===0?60:48)+index, name=noteNames[note%12]+(Math.floor(note/12)-1);
    const button=element('button','sf-key'); button.type='button'; button.dataset.note=note; button.dataset.sharp=String(name.includes('♯'));
    button.setAttribute('aria-label',`Play ${name}, key ${label}`);
    button.append(element('span','',name),element('kbd','',label)); keyMap.set(code,{note,button});
    button.addEventListener('pointerdown',event=>{ if(event.button!==0) return; event.preventDefault(); button.setPointerCapture(event.pointerId); startKey(`pointer:${event.pointerId}`,note,button); });
    for(const eventName of ['pointerup','pointercancel','lostpointercapture']) button.addEventListener(eventName,event=>endKey(`pointer:${event.pointerId}`,button));
    button.addEventListener('click',event=>{ if(event.detail===0) { startKey(`accessible:${code}`,note,button); setTimeout(()=>endKey(`accessible:${code}`,button),500); } });
    row.append(button);
  });
  $('keyboard').append(row);
}
function updateKeyboard() {
  const playable=Boolean(selectedFont);
  for(const {button} of keyMap.values()) button.disabled=!playable;
  $('auditionButton').disabled=!playable;
  $('keyboardHint').textContent=`Audio ${audio.enabled?'on':'off'} · ${playable?'click keys or use your computer keyboard':'select an SF2 to play'}`;
}
window.addEventListener('keydown',event=>{
  if(event.code==='Escape') { stop(); return; }
  if(event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target.closest?.('input,select,textarea,[contenteditable="true"],dialog') || view!=='collection') return;
  const key=keyMap.get(event.code); if(!key) return;
  event.preventDefault(); startKey(event.code,key.note,key.button);
});
window.addEventListener('keyup',event=>{ const key=keyMap.get(event.code); if(key) endKey(event.code,key.button); });
window.addEventListener('blur',stop);
document.addEventListener('visibilitychange',()=>{ if(document.hidden) stop(); });
function audition(font,note=60) {
  if(!audio.enabled) { status('Turn Audio on in the header to hear the preview.'); audioStrip.setAttention(true); return; }
  clearTimeout(previewTimer);
  if(auditionNote!==null) audio.noteOff(auditionNote);
  if(activeFont!==font) { audio.setFont(font); if(font===selectedFont) audio.setPreset(presetIndex); activeFont=font; }
  auditionNote=audio.noteOn(note);
  previewTimer=setTimeout(()=>{ audio.noteOff(note); auditionNote=null; },1200);
}
$('auditionButton').addEventListener('click',()=>{ if(selectedFont) audition(selectedFont,selectedFont.presets[Number($('presetSelect').value)||0]?.zones[0]?.rootKey ?? 60); });
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
$('previewDraft').addEventListener('click',()=>action(async()=>{ if(!audio.enabled) { status('Turn Audio on in the header to hear the draft.'); return; } const bytes=draftBytes(); audition(parseSoundFont(bytes),Number($('rootKey').value)); }));
$('workshopForm').addEventListener('submit',event=>{ event.preventDefault(); void action(async()=>{
  if(busy) return; busy=true; $('saveFont').disabled=true;
  try {
    const bytes=draftBytes(), font=parseSoundFont(bytes);
    const entry=metadata(font,bytes,{kind:'created',name:$('fontName').value.trim(),notes:$('fontNotes').value.trim() || `${sampleNames[sourceKind()]} · root ${noteNames[Number($('rootKey').value)%12]}${Math.floor(Number($('rootKey').value)/12)-1}`});
    await library.put(entry,bytes); await refresh(); $('search').value=''; setFilter('all'); showView('collection'); await select(entry.id);
    status(`“${entry.name}” created. Play it here or download its SF2.`);
  } finally { busy=false; $('saveFont').disabled=false; }
}); });

async function initialize() {
  let storageError = null;
  try { library=await openLibrary(); }
  catch(error) { library=temporaryLibrary(); $('storageStatus').textContent='Temporary session · storage unavailable'; storageError=new Error(`${error.message} Download anything you create before closing this tab.`); }
  if(library.persistent) $('storageStatus').textContent='Saved in this browser · no account needed';
  if(!await library.setting('initialized')) {
    const demos=[['Glass Signals','glass','Ringing, inharmonic bell tones. A bright place to begin.'],['Soft Circuit','warm','A rounded, gently moving synthetic tone.'],['Copper Wire','pluck','A dry, textured pluck with a fading harmonic tail.']];
    for(let i=0;i<demos.length;i++) {
      const [name,kind,notes]=demos[i];
      const bytes=encodeSoundFont({name,author:'Morphazoid',license:'Original synthesized sample; free to use and modify',samples:[{name,data:generateSample({kind,rootKey:60,duration:2.5,brightness:.55,sampleRate:22050}),sampleRate:22050,rootKey:60,lowKey:0,highKey:127}]});
      await library.put(metadata(parseSoundFont(bytes),bytes,{id:`original-${kind}`,name,kind:'factory',notes,color:colors[i],createdAt:3-i}),bytes);
    }
    await library.setSetting('initialized',true);
  }
  await refresh(); await select(entries[0]?.id || null); updateDraft();
  void loadBundledCatalog();
  status(`${entries.length} sounds in your library. Import a font or make your own.`);
  if(storageError) showError(storageError);
}
window.addEventListener('pagehide',()=>{ disposed=true; for(const controller of bankLoads.values()) controller.abort(); stop(); cancelAnimationFrame(drawingFrame); void audio.dispose(); library?.close(); audioStrip.destroy(); });
window.addEventListener('pageshow',event=>{ if(event.persisted) location.reload(); });
void initialize().catch(showError);
