// Fixed physical clusters: every key and its on-screen twin always address one rider.
export const RIDER_KEYS = Object.freeze([
  { left:'KeyA',right:'KeyD',fastLeft:'KeyQ',fastRight:'KeyE',up:'KeyW',down:'KeyS',kick:'KeyF',crowd:'KeyG' },
  { left:'KeyJ',right:'KeyL',fastLeft:'KeyU',fastRight:'KeyO',up:'KeyI',down:'KeyK',kick:'KeyH',crowd:'KeyN' },
  { left:'Numpad4',right:'Numpad6',fastLeft:'Numpad7',fastRight:'Numpad9',up:'Numpad8',down:'Numpad2',kick:'Numpad5',crowd:'Numpad0' },
]);
export const GAME_KEYS = new Set(RIDER_KEYS.flatMap(group=>Object.values(group)));
export function drivingControls(keys, targets, activeIds) {
  return RIDER_KEYS.map((k,owner)=>{
    if(!activeIds.includes(owner))return {steer:0,height:0,target:null};
    const fast=Number(keys.has(k.fastRight))-Number(keys.has(k.fastLeft));
    const slow=Number(keys.has(k.right))-Number(keys.has(k.left));
    const steer=fast||slow*.34;
    return {steer,height:Number(keys.has(k.up))-Number(keys.has(k.down)),target:steer?null:targets[owner]??null};
  });
}
