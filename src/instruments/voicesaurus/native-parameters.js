import { enhanceRangeKnob } from '../../ui/primitives/range-knob.js';
import { enhanceChooseSelect } from '../../ui/patterns/choose-select.js';
import { enhanceNativeKnob } from './native-knob.js';

/** Vowel controls share the selected note's timeline position; every key has one editor. */
export function noteVowelControls(engine, controls) {
  const selected={};
  for(const [key,rule] of Object.entries(controls)) {
    let group;
    if(engine==='singer') {
      if(/^radius\d$/.test(key)||['tractScale','customShape','velum'].includes(key))group='Vocal tract';
      else if(['glottalReflection','lipReflection','transition','tongueHumpPole','tongueTipPole'].includes(key))group='Tract resonance & motion';
      else if(key.startsWith('frication'))group='Frication';
    } else if(engine==='stk-voicform'||engine.startsWith('csound-')) {
      const formant=key.match(/^(?:formant|gain|bandwidth|radius|sweep)(\d)$/);
      if(formant)group=`Formant ${formant[1]}`;
      else if(engine==='stk-voicform'&&['customFormants','formantScale','transition'].includes(key))group='Vowel & sweep';
    }
    if(group)selected[key]={...rule,group};
  }
  return selected;
}

export function mountParameters(host, controls, values, change) {
  const widgets=[];host.replaceChildren();
  const groups=new Map();
  for(const [key,rule] of Object.entries(controls)) {
    const discrete=rule.choices?.every(value=>typeof value==='number');
    const menu=rule.choices&&!discrete&&!rule.freeText;
    const min=discrete?Math.min(...rule.choices):rule.min,max=discrete?Math.max(...rule.choices):rule.max;
    const group=rule.group||'Native';
    if(!groups.has(group)) {
      const details=document.createElement('details');details.open=true;
      const summary=document.createElement('summary');summary.textContent=group==='Native'?'Voice parameters':group;
      const grid=document.createElement('div');grid.className='native-param-grid';
      const choices=document.createElement('div');choices.className='native-choice-grid';
      details.append(summary,grid,choices);host.append(details);groups.set(group,{grid,choices});
    }
    const label=document.createElement('label');label.className='native-param';label.htmlFor=`param-${key}`;
    const title=document.createElement('span');title.textContent=rule.label;
    const input=document.createElement(menu?'select':'input');input.id=`param-${key}`;input.dataset.param=key;input.setAttribute('aria-label',rule.label);
    const wrap=document.createElement('span'),output=document.createElement('output');wrap.append(input);label.append(title,wrap,output);groups.get(group)[menu||rule.freeText?'choices':'grid'].append(label);
    if(rule.description)label.title=rule.description;
    let widget;
    if(rule.freeText){
      label.classList.add('is-choice');input.type='text';input.value=values[key];input.className='native-text-parameter';widget={destroy(){}};
    } else if(menu) {
      label.classList.add('is-choice');
      for(const choice of rule.choices){const option=document.createElement('option');option.value=String(choice);option.textContent=String(choice).replaceAll('_',' ');input.append(option);}
      input.value=String(values[key]);widget=enhanceChooseSelect(input,{label:rule.label});
    } else {
      input.type='range';input.min=Math.min(min,values[key]);input.max=Math.max(max,values[key]);input.step='any';input.value=values[key];widget=discrete?enhanceRangeKnob(input):enhanceNativeKnob(input,output,rule);
      label.title=[rule.description,discrete?`${min}–${max}${rule.unit?' '+rule.unit:''} (native discrete values). Home / End reach the limits.`:`Drag from ${rule.dragMin??min} to ${rule.dragMax??max}${rule.unit?' '+rule.unit:''}; click the readout to type values beyond this range.`].filter(Boolean).join('\n');
      if(discrete)input.addEventListener('keydown',event=>{
        const direction={ArrowUp:1,ArrowRight:1,ArrowDown:-1,ArrowLeft:-1}[event.key];
        if(!direction&&!['Home','End'].includes(event.key))return;event.preventDefault();
        const index=rule.choices.indexOf(Number(input.value));
        input.value=rule.choices[event.key==='Home'?0:event.key==='End'?rule.choices.length-1:Math.max(0,Math.min(rule.choices.length-1,index+direction))];
        input.dispatchEvent(new Event('input',{bubbles:true}));
      });
    }
    const reflect=()=>{output.textContent=menu||rule.freeText?'':`${Number(Number(input.value).toPrecision(7))}${rule.unit?' '+rule.unit:''}`;if(!menu&&!rule.freeText)input.setAttribute('aria-valuetext',output.textContent);};
    input.addEventListener('native-parameter-reflect',()=>{widget.refresh?.();widget.update?.();reflect();});
    reflect();input.addEventListener(menu?'change':'input',event=>{
      if(discrete){const value=Number(input.value);input.value=rule.choices.reduce((best,next)=>Math.abs(next-value)<Math.abs(best-value)?next:best);widget.update();}
      else if(rule.nativeStep&&!event.nativeExact){input.value=String(Math.round(Number(input.value)/rule.nativeStep)*rule.nativeStep);widget.update();}
      reflect();change(key,rule.freeText?input.value:menu?rule.choices.find(value=>String(value)===input.value):Number(input.value));
    });
    widgets.push(widget);
  }
  return ()=>{widgets.forEach(widget=>widget.destroy());host.replaceChildren();};
}
