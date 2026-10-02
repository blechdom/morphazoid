import {expect} from '@playwright/test';

/** Apply exotic native state through the actual preset adapter. The mode switch
 * refreshes the preset bank's detached snapshots; no production test API needed.
 */
export async function applyVoiceFixture(page,{values={},input={},noteValues={},legacy=false}={}) {
  const fixture=await page.evaluate(async({values,input,noteValues,legacy})=>{
    const {presets,defaultScene}=await import('./src/instruments/voicesaurus/native-model.js');
    const {captureHeaderPresetState}=await import('./src/site/header-presets.js');
    const current=captureHeaderPresetState().snapshot,next=legacy?defaultScene(current.engine):structuredClone(current);
    Object.assign(next.values,values);
    Object.assign(next.input,input);
    for(const [index,patch]of Object.entries(noteValues))Object.assign(next.input.phrase.notes[Number(index)].values,patch);
    const preset=presets.find(item=>item.snapshot.engine===next.engine);
    window.voiceFixtureBackup={preset,snapshot:preset.snapshot};preset.snapshot=next;
    return {id:preset.id,snapshot:next};
  },{values,input,noteValues,legacy});
  try {
    await page.locator('[data-voice-mode="speaking"]').click();
    await page.locator('[data-voice-mode="singing"]').click();
    await page.locator(`[data-preset-id="${fixture.id}"]`).evaluate(button=>button.click());
    await expect(page.locator('.header-preset-controls')).not.toHaveAttribute('aria-busy','true');
    await expect.poll(()=>page.evaluate(async()=>(await import('./src/site/header-presets.js')).captureHeaderPresetState().snapshot)).toEqual(fixture.snapshot);
  } finally {
    await page.evaluate(()=>{if(window.voiceFixtureBackup){const {preset,snapshot}=window.voiceFixtureBackup;preset.snapshot=snapshot;delete window.voiceFixtureBackup;}});
  }
}

export async function selectVoiceNote(page,index=0) {
  const handle=page.locator(`[data-note-handle="${index}"]`);
  await handle.scrollIntoViewIfNeeded();await handle.click();
  await expect(page.locator('.native-note-editor')).toBeVisible();
}
