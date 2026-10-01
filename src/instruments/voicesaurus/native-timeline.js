import { enhanceNativeKnob } from './native-knob.js';
import { enhanceRangeKnob } from '../../ui/primitives/range-knob.js';
import { enhanceChooseSelect } from '../../ui/patterns/choose-select.js';
import { JAPANESE_SYLLABLE_GROUPS } from '../../families/speech/japanese-syllables.js';
import {
  tempoForScene, singingNoteDescriptors, setNotePitch, setNoteBeats,
  setNoteSyllable, setNoteRest, setNoteArticulation, setSingingTempo, setSingingPortamento,
  addSingingNote, duplicateSingingNote, removeSingingNote, splitSingingNote,
  moveSingingNote,
} from './native-singing-model.js';

const names=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
const number=value=>Number.isFinite(value)?String(Number(value.toPrecision(6))):'—';
const noteName=midi=>`${names[((Math.round(midi)%12)+12)%12]}${Math.floor(Math.round(midi)/12)-1}`;

/** Native syllables/shapes share their notes' time axis; numeric editors stay unrestricted. */
export function mountSingingTimeline(host, scene, options={}) {
  const {change=()=>{},select=()=>{},audition=()=>{},error=()=>{},mountNoteParameters=()=>()=>{},spec={},initialSelection=0}=options;
  const score=scene.engine==='sinsy',widgets=[],noteWidgets=[],editorWidgets=[],listeners=[];
  let selected=initialSelection,descriptors=[],nodes=[],layout=null,drag=null,zoom=120,destroyed=false,cleanupNoteParameters=()=>{};
  const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
  const listen=(el,event,fn,opts)=>{el.addEventListener(event,fn,opts);listeners.push(()=>el.removeEventListener(event,fn,opts));};
  const safely=action=>{try{action();}catch(reason){error(reason);}};
  const clear=collection=>collection.splice(0).forEach(widget=>widget.destroy());
  const pitchText=note=>note.rest?'Rest':score?noteName(note.displayMidi):`${number(note.pitch)} Hz · ${noteName(note.displayMidi)}`;
  host.replaceChildren();host.classList.add('native-singing-timeline');

  function knob(label,value,min,max,step,format,commit,collection=widgets,native=true){
    let accepted=value;
    const field=make('label','native-param'),caption=make('span','',label),wrap=make('span'),input=make('input'),output=make('output');
    input.type='range';Object.assign(input,{min:Math.min(min,value),max:Math.max(max,value),step:'any',value});input.setAttribute('aria-label',label);
    wrap.append(input);field.append(caption,wrap,output);
    const widget=native?enhanceNativeKnob(input,output,{label,min,max,step,nativeStep:score&&label.endsWith(' pitch')?1:undefined}):enhanceRangeKnob(input);
    collection.push(widget);
    const reflect=next=>{if(Number.isFinite(next)){accepted=next;input.min=Math.min(Number(input.min),next);input.max=Math.max(Number(input.max),next);input.value=String(next);}output.textContent=format(Number(input.value));input.setAttribute('aria-valuetext',output.textContent);widget.update();};
    input.addEventListener('input',event=>{try{if(score&&label.endsWith(' pitch')&&!event.nativeExact)input.value=String(Math.round(Number(input.value)));commit(Number(input.value));accepted=Number(input.value);reflect();}catch(reason){reflect(accepted);error(reason);}});reflect();return{field,input,reflect};
  }
  function button(text,label,action,cls=''){
    const el=make('button',cls,text);el.type='button';if(label)el.setAttribute('aria-label',label);el.addEventListener('click',()=>safely(action));return el;
  }
  function edited({structure=false,focus=false}={}){
    if(structure)drawNotes();else refresh();
    drawEditor();select(selected);change();
    if(focus)nodes[selected]?.handle.focus({preventScroll:true});
  }
  function operation(fn){selected=fn(scene,selected);edited({structure:true,focus:true});}
  const toolbar=make('div','native-score-toolbar');
  const tempo=knob('Tempo',tempoForScene(scene),40,240,.1,v=>`${number(v)} BPM`,value=>{setSingingTempo(scene,value);edited();});
  const zoomKnob=knob('Timeline zoom',zoom,40,300,10,v=>`${number(v)} px/beat`,value=>{zoom=value;refresh();},widgets,false);
  const tools=make('div','native-score-tools');tools.setAttribute('role','toolbar');tools.setAttribute('aria-label','Singing score editing');
  tools.append(button('+ Note','Add note',()=>operation(addSingingNote)),button('Duplicate','Duplicate selected note',()=>operation(duplicateSingingNote)),button('Split','Split selected note',()=>operation(splitSingingNote)));
  const remove=button('Remove','Remove selected note',()=>operation(removeSingingNote));tools.append(remove);
  const previous=button('←','Select previous note',()=>selectNote(Math.max(0,selected-1),true));
  const next=button('→','Select next note',()=>selectNote(Math.min(descriptors.length-1,selected+1),true));tools.append(previous,next);
  toolbar.append(tempo.field,zoomKnob.field,tools);host.append(toolbar);
  if(!score){
    const transitions=make('div','native-note-transitions');transitions.setAttribute('role','group');transitions.setAttribute('aria-label','Between notes');
    transitions.append(make('span','native-transition-label','Between notes'));
    for(const [key,label]of [['pitchPortamento','Pitch portamento'],['vowelPortamento','Vowel transition']]){
      const control=knob(label,scene.input.phrase?.[key]??0,0,2,.001,v=>v===0?'Off':`${number(v)} s`,value=>{setSingingPortamento(scene,key,value);edited();});
      control.field.title=key==='pitchPortamento'?'Slide from the previous note’s pitch; zero makes a direct change.':'Move from the previous note’s vowel or tract shape; zero makes a direct change.';
      transitions.append(control.field);
    }
    host.append(transitions);
  }
  const help=make('p','native-score-help','Drag notes up/down for pitch; left/right to reorder. Drag the right edge for length. Choose a sound on each note.');
  help.id='nativeScoreHelp';host.append(help);
  if(score)host.append(make('p','native-notes native-syllable-help','Japanese syllables: a = ah, i = ee, u = oo, e = eh, o = oh.'));
  const scroll=make('div','native-piano-scroll');scroll.setAttribute('aria-label','Singing piano roll');
  const content=make('div','native-piano-content'),ruler=make('div','native-beat-ruler'),grid=make('div','native-piano-grid'),pitchLabels=make('div','native-pitch-labels'),noteLayer=make('div','native-note-layer');
  grid.setAttribute('aria-label','Native singing notes');grid.setAttribute('aria-describedby',help.id);
  const playhead=make('div','native-score-playhead');playhead.hidden=true;playhead.setAttribute('aria-hidden','true');
  grid.append(pitchLabels,noteLayer,playhead);content.append(ruler,grid);scroll.append(content);host.append(scroll);
  const editor=make('div','native-note-editor');content.append(editor);
  let pitchKnob,beatsKnob,auditionButton;

  function selectNote(index,focus=false){
    // Pointer capture prevents the browser's ordinary focus change. Finish the
    // old note's exact edit before replacing its controls or selected state.
    if(document.activeElement?.matches('.native-exact-value'))document.activeElement.blur();
    selected=Math.max(0,Math.min(index,descriptors.length-1));
    for(const [i,node]of nodes.entries()){node.shell.classList.toggle('is-selected',i===selected);node.handle.setAttribute('aria-pressed',String(i===selected));}
    drawEditor();positionEditor();select(selected);
    previous.disabled=selected===0;next.disabled=selected===descriptors.length-1;
    if(focus){nodes[selected]?.handle.focus({preventScroll:true});nodes[selected]?.shell.scrollIntoView({block:'nearest',inline:'nearest'});}
  }

  function makePicker(note,index,container){
    if(!score&&!spec.phones)return null;
    const syllable=make('select');syllable.id=`native-syllable-${index}`;const label=`Note ${index+1} ${score?'syllable':'vocal shape'}`;syllable.setAttribute('aria-label',label);
    if(score){
      for(const group of JAPANESE_SYLLABLE_GROUPS){const groupEl=make('optgroup');groupEl.label=group.label;for(const {kana,romaji,pronunciation}of group.syllables){const option=make('option','',`${romaji}${pronunciation?` (${pronunciation})`:''} · ${kana}`);option.value=kana;groupEl.append(option);}syllable.append(groupEl);}
      const custom=make('option','','Custom lyric…');custom.value='__custom__';syllable.append(custom);
    }else for(const phone of spec.phones){const option=make('option','',phone);option.value=phone;syllable.append(option);}
    const value=score?note.lyric:note.phone;
    const known=[...syllable.options].some(option=>option.value===value);syllable.value=known?value:'__custom__';container.append(syllable);
    const picker=enhanceChooseSelect(syllable,{label});noteWidgets.push(picker);
    let lyric;
    if(score){lyric=make('input','native-custom-lyric');lyric.type='text';lyric.lang='ja';lyric.value=value;lyric.hidden=known;lyric.setAttribute('aria-label',`Note ${index+1} kana syllable`);container.append(lyric);lyric.addEventListener('input',()=>safely(()=>{setNoteSyllable(scene,index,lyric.value);refresh();change();}));}
    picker.summary.addEventListener('click',()=>selectNote(index));
    syllable.addEventListener('change',()=>safely(()=>{
      selectNote(index);
      if(lyric){lyric.hidden=syllable.value!=='__custom__';if(!lyric.hidden){lyric.focus();lyric.select();return;}}
      setNoteSyllable(scene,index,syllable.value);if(lyric)lyric.value=syllable.value;refresh();drawEditor();select(selected);change();
    }));
    return picker;
  }

  function startDrag(event,index,kind){
    if(event.button!==0||event.isPrimary===false)return;event.preventDefault();
    if(!Number.isFinite(descriptors[index].beats)||layout.pixels<=0||layout.row<=0){error(Error('This value is outside the drag view. Use the exact note or native parameter readout.'));return;}
    selectNote(index);event.currentTarget.focus({preventScroll:true});event.currentTarget.setPointerCapture(event.pointerId);
    drag={id:event.pointerId,index,kind,x:event.clientX,y:event.clientY,pitch:descriptors[index].pitch,beats:descriptors[index].beats,view:{...layout},changed:false,target:index};
  }
  function moveDrag(event){
    if(!drag||event.pointerId!==drag.id)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(Math.abs(dx)+Math.abs(dy)<3&&!drag.changed)return;
    drag.changed=true;
    safely(()=>{
      if(drag.kind==='resize')setNoteBeats(scene,drag.index,Math.max(score?1/480:.000001,drag.beats+dx/drag.view.pixels));
      else{
        const original=score?drag.pitch:drag.pitch===0?60:69+12*Math.log2(Math.abs(drag.pitch)/440),midi=original-dy/drag.view.row;
        const value=score?Math.round(midi):(drag.pitch<0?-1:1)*440*2**((midi-69)/12);
        if(dy!==0&&Number.isFinite(value))setNotePitch(scene,drag.index,value);
        if(Math.abs(dx)>24){const center=descriptors[drag.index].startBeats+drag.beats/2+dx/drag.view.pixels;drag.target=descriptors.reduce((best,note)=>Math.abs(note.startBeats+note.beats/2-center)<Math.abs(descriptors[best].startBeats+descriptors[best].beats/2-center)?note.index:best,drag.index);}
      }
      refresh(drag.view);if(drag.kind==='move')nodes[drag.index].shell.style.transform=`translateX(${dx}px)`;pitchKnob?.reflect(descriptors[selected].pitch??60);beatsKnob?.reflect(descriptors[selected].beats);
    });
  }
  function endDrag(event,cancel=false){
    if(!drag||event.pointerId!==drag.id)return;
    const ended=drag;drag=null;
    safely(()=>{
      if(cancel){setNotePitch(scene,ended.index,ended.pitch??60);setNoteBeats(scene,ended.index,ended.beats);}
      else if(ended.kind==='move'&&ended.target!==ended.index)selected=moveSingingNote(scene,ended.index,ended.target);
      if(ended.changed)edited({structure:true,focus:true});
    });
  }
  function noteKey(event,index){
    if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Delete','Backspace'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();selectNote(index);
    safely(()=>{
      if(['Delete','Backspace'].includes(event.key)){operation(removeSingingNote);return;}
      const note=descriptors[index],direction=['ArrowUp','ArrowRight'].includes(event.key)?1:-1;
      if(['ArrowUp','ArrowDown'].includes(event.key))setNotePitch(scene,index,score?(note.pitch??60)+direction:(note.pitch||261.625565)*(2**(direction*(event.shiftKey ? .1 : 1)/12)));
      else if(event.shiftKey)setNoteBeats(scene,index,Math.max(score?1/480:.000001,note.beats+direction*.25));
      else selected=moveSingingNote(scene,index,Math.max(0,Math.min(descriptors.length-1,index+direction)));
      edited({structure:true,focus:true});
    });
  }

  function drawNotes(){
    clear(noteWidgets);noteLayer.replaceChildren();descriptors=singingNoteDescriptors(scene);selected=Math.min(selected,descriptors.length-1);nodes=[];
    for(const note of descriptors){
      const index=note.index,shell=make('div','native-timeline-note');shell.dataset.noteIndex=index;
      const handle=button('',`Select note ${index+1}`,()=>selectNote(index));handle.className='native-note-drag';handle.dataset.noteHandle=index;
      handle.addEventListener('pointerdown',event=>startDrag(event,index,'move'));handle.addEventListener('keydown',event=>noteKey(event,index));
      const pickerHost=make('div','native-note-syllable');const picker=makePicker(note,index,pickerHost);
      if(!picker)pickerHost.append(make('span','native-note-formants','Formants'));
      const resize=button('','Resize note '+(index+1),()=>selectNote(index),'native-note-resize');resize.title='Drag to change note length; Shift + arrow keys also resize.';resize.addEventListener('pointerdown',event=>startDrag(event,index,'resize'));resize.addEventListener('keydown',event=>noteKey(event,index));
      shell.append(handle,pickerHost,resize);noteLayer.append(shell);nodes.push({shell,handle,picker,resize});
    }
    refresh();
  }

  function positionEditor(){
    if(!layout||!descriptors[selected])return;
    const width=Math.max(280,Math.min(620,host.clientWidth-48));
    const left=Math.max(0,Math.min(layout.positions[selected].x,layout.width-width));editor.style.marginLeft=`${48+left}px`;editor.style.width=`${width}px`;editor.dataset.noteIndex=selected;
    editor.setAttribute('aria-label',`Note ${selected+1} controls`);
  }

  function refresh(frozenView){
    if(destroyed)return;
    descriptors=singingNoteDescriptors(scene);selected=Math.min(selected,descriptors.length-1);
    if(nodes.length!==descriptors.length){drawNotes();drawEditor();return;}
    const pitches=descriptors.filter(note=>!note.rest).map(note=>note.displayMidi),low=Math.min(60,...pitches),high=Math.max(64,...pitches);
    const min=frozenView?.min??Math.floor(low)-2,max=frozenView?.max??Math.max(min+12,Math.ceil(high)+2),height=236,row=height/(max-min);
    // Normalize display geometry before multiplication: an accepted finite native
    // duration must not overflow the ruler or stall the UI while rendering fails.
    const spans=descriptors.map(note=>Math.max(0,score?note.input.beats??1:note.values.duration)),largest=Math.max(.001,...spans);
    const normalized=spans.map(value=>value/largest),sum=normalized.reduce((a,b)=>a+b,0)||1;
    const total=largest*sum*(score?1:tempoForScene(scene)/60),timeWidth=Math.min(12000,Math.max(3,total*Math.max(10,zoom)));
    const pixels=frozenView?.pixels??(Number.isFinite(total)&&total>0?timeWidth/total:0),width=Math.max(310,host.clientWidth-50,timeWidth);
    let cursor=0;const positions=normalized.map(value=>{const position={x:cursor/sum*timeWidth,width:value/sum*timeWidth};cursor+=value;return position;});
    layout={min,max,row,pixels,width,height,positions};content.style.width=`${width+48}px`;grid.style.width=`${width+48}px`;grid.style.height=`${height+48}px`;
    ruler.replaceChildren();pitchLabels.replaceChildren();grid.style.setProperty('--beat-pixels',`${pixels}px`);
    const step=Math.max(1,Math.ceil(total/120)),ticks=Number.isFinite(total)?Math.min(120,Math.floor(total/step)):0;
    for(let i=0;i<=ticks;i++){const beat=i*step,tick=make('span','',pixels>0?`${number(beat+1)}${tempoForScene(scene)>0?` · ${number(beat*60/tempoForScene(scene))}s`:''}`:'Use exact duration');tick.style.left=`${48+(pixels>0?beat*pixels:0)}px`;ruler.append(tick);}
    const span=max-min,pitchStep=Math.max(1,Math.ceil(span/16)),pitchSteps=Number.isFinite(span)?Math.min(16,Math.floor(span/pitchStep)):16;
    for(let i=0;i<=pitchSteps;i++){const fraction=Number.isFinite(span)?i*pitchStep/span:i/pitchSteps,midi=Number.isFinite(span)?min+i*pitchStep:min*(1-fraction)+max*fraction,label=make('span','',noteName(midi));label.style.top=`${24+height*(1-fraction)}px`;pitchLabels.append(label);}
    for(const note of descriptors){
      const node=nodes[note.index],position=positions[note.index],scale=Math.max(1,Math.abs(min),Math.abs(max)),pitchFraction=(max/scale-note.displayMidi/scale)/(max/scale-min/scale);
      node.shell.style.left=`${48+position.x}px`;node.shell.style.top=`${height*Math.max(0,Math.min(1,pitchFraction))}px`;node.shell.style.width=`${Math.max(0,position.width-Math.min(2,position.width*.1))}px`;node.shell.style.transform='';
      node.shell.classList.toggle('is-selected',note.index===selected);node.shell.classList.toggle('is-rest',note.rest);
      node.handle.textContent=`${note.index+1} · ${pitchText(note)}`;node.handle.title=`Note ${note.index+1}: ${pitchText(note)}, ${number(note.beats)} beats`;node.handle.setAttribute('aria-pressed',String(note.index===selected));
      node.handle.setAttribute('aria-label',`Select note ${note.index+1}: ${note.lyric||note.phone||'formant voice'}, ${pitchText(note)}, ${number(note.beats)} beats`);
    }
    remove.disabled=descriptors.length===1;previous.disabled=selected===0;next.disabled=selected===descriptors.length-1;tempo.reflect(tempoForScene(scene));
    pitchKnob?.reflect(descriptors[selected].pitch??60);beatsKnob?.reflect(descriptors[selected].beats);positionEditor();
    if(auditionButton)auditionButton.disabled=descriptors[selected].rest;
  }

  function drawEditor(){
    cleanupNoteParameters();clear(editorWidgets);editor.replaceChildren();const note=descriptors[selected];if(!note)return;
    editor.append(make('div','native-selected-note-title',`Note ${selected+1}`));
    const controls=make('div','native-selected-knobs');
    pitchKnob=knob(`Note ${selected+1} pitch`,note.pitch??60,score?36:20,score?96:2000,1,v=>score?noteName(v):`${number(v)} Hz`,value=>{setNotePitch(scene,selected,value);refresh();select(selected);change();},editorWidgets);
    beatsKnob=knob(`Note ${selected+1} beats`,note.beats,.25,8,.01,v=>`${number(v)} beats`,value=>{setNoteBeats(scene,selected,value);refresh();select(selected);change();},editorWidgets);
    controls.append(pitchKnob.field,beatsKnob.field);editor.append(controls);
    const actions=make('div','native-score-options');
    function check(label,checked,commit){const field=make('label'),input=make('input');input.type='checkbox';input.checked=checked;input.setAttribute('aria-label',`Note ${selected+1} ${label.toLowerCase()}`);input.addEventListener('change',()=>safely(()=>{commit(input.checked);refresh();select(selected);change();}));field.append(input,document.createTextNode(label));actions.append(field);}
    check('Rest',note.rest,value=>setNoteRest(scene,selected,value));
    if(score){check('Staccato',note.staccato,value=>setNoteArticulation(scene,selected,'staccato',value));check('Breath',note.breath,value=>setNoteArticulation(scene,selected,'breath',value));}
    auditionButton=button('▶ Note','Audition selected note',()=>audition(selected));auditionButton.disabled=note.rest;actions.append(auditionButton);
    if(nodes[selected]?.picker)actions.append(button(score?'Syllable…':'Shape…',`Choose selected ${score?'syllable':'vocal shape'}`,()=>{const picker=nodes[selected].picker;picker.details.open=true;picker.summary.focus({preventScroll:true});}));
    editor.append(actions);
    if(!score){const voice=make('div','native-note-parameters');editor.append(voice);cleanupNoteParameters=mountNoteParameters(voice,selected);}
    positionEditor();
  }

  listen(host,'pointermove',moveDrag);listen(host,'pointerup',event=>endDrag(event));listen(host,'pointercancel',event=>endDrag(event,true));
  listen(window,'resize',()=>refresh());drawNotes();drawEditor();
  return {
    get selected(){return selected;},refresh,select:index=>selectNote(index),
    progress(position,timings,playing){
      if(!playing||!layout||!Number.isFinite(position)||!timings?.length){playhead.hidden=true;nodes.forEach(node=>node.shell.classList.remove('is-sounding'));return;}
      const active=timings.find(timing=>position>=timing.start&&position<timing.end),last=timings.at(-1);
      const index=active?.index??(position>=last.end?descriptors.length-1:0),note=descriptors[index],timing=active??timings[index];
      if(!note||!timing){playhead.hidden=true;return;}
      const fraction=Math.max(0,Math.min(1,(position-timing.start)/Math.max(.000001,timing.end-timing.start)));
      const notePosition=layout.positions[index];playhead.hidden=false;playhead.style.left=`${48+notePosition.x+notePosition.width*fraction}px`;
      nodes.forEach((node,i)=>node.shell.classList.toggle('is-sounding',!!active&&i===index&&!descriptors[i].rest));
    },
    destroy(){destroyed=true;cleanupNoteParameters();clear(widgets);clear(noteWidgets);clear(editorWidgets);listeners.forEach(remove=>remove());host.replaceChildren();host.classList.remove('native-singing-timeline');},
  };
}
