import {renderSinsyScore} from './sinsy-runtime.js';
let started=false;
self.onmessage=async({data})=>{
  if(started||data?.type!=='render')return;started=true;
  try{const result=await renderSinsyScore(data.xml,data.values);self.postMessage({type:'ready',...result},[result.samples.buffer]);}
  catch(error){self.postMessage({type:'error',message:error?.message||'Sinsy singing failed.'});}
  // One request. The owner terminates this worker on success, error or cancel.
};
