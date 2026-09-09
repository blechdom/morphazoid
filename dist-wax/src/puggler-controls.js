// Physical gaming-key clusters. The left cluster can target any active rider.
export const RIDER_KEYS = Object.freeze([
  { left:'KeyA',right:'KeyD',fastLeft:'KeyQ',fastRight:'KeyE',up:'KeyW',down:'KeyS',kick:'KeyF',crowd:'KeyG' },
  { left:'KeyJ',right:'KeyL',fastLeft:'KeyU',fastRight:'KeyO',up:'KeyI',down:'KeyK',kick:'KeyH',crowd:'KeyN' },
  { left:'Numpad4',right:'Numpad6',fastLeft:'Numpad7',fastRight:'Numpad9',up:'Numpad8',down:'Numpad2',kick:'Numpad5',crowd:'Numpad0' },
]);
export const GAME_KEYS = new Set(RIDER_KEYS.flatMap(group=>Object.values(group)));
export function drivingControls(keys, selected, targets, held, count) {
  const result=Array.from({length:count},(_,i)=>({steer:0,height:0,target:targets[i]??null}));
  for(let cluster=0;cluster<RIDER_KEYS.length;cluster++){
    const owner=cluster===0?selected:cluster;if(!result[owner])continue;
    const k=RIDER_KEYS[cluster];
    const fast=Number(keys.has(k.fastRight))-Number(keys.has(k.fastLeft));
    const slow=Number(keys.has(k.right))-Number(keys.has(k.left));
    result[owner].steer+=fast||slow*.34;
    result[owner].height+=Number(keys.has(k.up))-Number(keys.has(k.down));
  }
  if(result[selected]){
    const fast=Number(held.has('fastRight'))-Number(held.has('fastLeft'));
    const slow=Number(held.has('right'))-Number(held.has('left'));
    result[selected].steer+=fast||slow*.34;
    result[selected].height+=Number(held.has('up'))-Number(held.has('down'));
  }
  for(const c of result)if(c.steer)c.target=null;
  return result;
}
