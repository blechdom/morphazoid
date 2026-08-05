-- @description Create the Morphazoid Chaotic FM MIDI/render smoke project
-- @version 0.1.0
-- @author Morphazoid

local output_dir = os.getenv("MORPHAZOID_SMOKE_DIR")
  or "/tmp/morphazoid-chaotic-fm-smoke"
local project_path = output_dir .. "/chaotic-fm-smoke.rpp"
local status_path = output_dir .. "/create-status.txt"

local function write_status(lines)
  local file, open_error = io.open(status_path, "w")
  if not file then
    reaper.ShowConsoleMsg("Could not write smoke-test status: " .. open_error .. "\n")
    return
  end

  file:write(table.concat(lines, "\n"), "\n")
  file:close()
end

local function fail(message)
  write_status({ "status=failed", "error=" .. message })
  error(message)
end

reaper.RecursiveCreateDirectory(output_dir, 0)

-- The command-line runner opens a new project, but clearing tracks makes the
-- script deterministic if it is also launched manually from REAPER.
while reaper.CountTracks(0) > 0 do
  reaper.DeleteTrack(reaper.GetTrack(0, 0))
end

reaper.InsertTrackAtIndex(0, true)
local track = reaper.GetTrack(0, 0)
if not track then
  fail("REAPER did not create the smoke-test track")
end

reaper.GetSetMediaTrackInfo_String(track, "P_NAME", "Chaotic FM MIDI smoke", true)

local fx_candidates = {
  "JS: Morphazoid: Chaotic FM",
  "JS: Morphazoid/Morphazoid_Chaotic_FM.jsfx",
  "Morphazoid: Chaotic FM",
}
local fx_index = -1
local matched_candidate = ""

for _, candidate in ipairs(fx_candidates) do
  fx_index = reaper.TrackFX_AddByName(track, candidate, false, 1)
  if fx_index >= 0 then
    matched_candidate = candidate
    break
  end
end

if fx_index < 0 then
  fail("Could not load JS: Morphazoid: Chaotic FM from the REAPER Effects path")
end

local _, loaded_fx_name = reaper.TrackFX_GetFXName(track, fx_index, "")
local parameter_count = reaper.TrackFX_GetNumParams(track, fx_index)
if parameter_count < 27 then
  fail("Chaotic FM loaded with fewer than its expected 27 slider parameters")
end

-- JSFX slider parameters are zero-based here: output, play mode, root, bend,
-- and glide mode. The CC stream below supplies the glide duration.
reaper.TrackFX_SetParam(track, fx_index, 7, 0.36)
reaper.TrackFX_SetParam(track, fx_index, 8, 1)
reaper.TrackFX_SetParam(track, fx_index, 9, 60)
reaper.TrackFX_SetParam(track, fx_index, 10, 2)
reaper.TrackFX_SetParam(track, fx_index, 16, 1)

-- Exercise v0.3 host timing: synced eighth-note carrier, deterministic song
-- phase, and a slewed sixteenth-note latch with an independent grid.
reaper.TrackFX_SetParam(track, fx_index, 19, 1)
reaper.TrackFX_SetParam(track, fx_index, 20, 6)
reaper.TrackFX_SetParam(track, fx_index, 21, 0)
reaper.TrackFX_SetParam(track, fx_index, 22, 1)
reaper.TrackFX_SetParam(track, fx_index, 23, 0.125)
reaper.TrackFX_SetParam(track, fx_index, 24, 2)
reaper.TrackFX_SetParam(track, fx_index, 25, 7)
reaper.TrackFX_SetParam(track, fx_index, 26, 8)

local item = reaper.CreateNewMIDIItemInProj(track, 0, 4.5, false)
local take = item and reaper.GetActiveTake(item) or nil
if not take or not reaper.TakeIsMIDI(take) then
  fail("REAPER did not create the smoke-test MIDI take")
end

local function ppq(seconds)
  return reaper.MIDI_GetPPQPosFromProjTime(take, seconds)
end

local function note(start_time, end_time, pitch, velocity)
  local inserted = reaper.MIDI_InsertNote(
    take,
    false,
    false,
    ppq(start_time),
    ppq(end_time),
    0,
    pitch,
    velocity,
    true
  )
  if not inserted then
    fail("Could not insert MIDI note " .. tostring(pitch))
  end
end

local function control_change(time, controller, value)
  local inserted = reaper.MIDI_InsertCC(
    take,
    false,
    false,
    ppq(time),
    0xB0,
    0,
    controller,
    value
  )
  if not inserted then
    fail("Could not insert MIDI CC" .. tostring(controller))
  end
end

-- Root, octave down, and overlapping root/octave-up notes exercise velocity,
-- transposition, last-note priority, and note-off fallback.
note(0.25, 1.00, 60, 72)
note(1.10, 1.85, 48, 100)
note(2.00, 3.05, 60, 88)
note(2.35, 2.75, 72, 120)
note(3.20, 4.10, 67, 108)

-- Exercise every expressive controller path during the render: expression,
-- sustain, glide enable/time, envelope times, reset, panic, and normal release.
control_change(0.20, 11, 80)
control_change(0.65, 11, 127)
control_change(0.80, 64, 127)
control_change(1.05, 64, 0)
control_change(1.90, 5, 70)
control_change(1.91, 65, 127)
control_change(3.00, 123, 0)
control_change(3.05, 73, 58)
control_change(3.06, 75, 73)
control_change(3.07, 72, 68)
control_change(3.15, 121, 0)
control_change(4.00, 120, 0)

-- Centered pitch bend, bend upward, then return to center on the final note.
reaper.MIDI_InsertCC(take, false, false, ppq(3.20), 0xE0, 0, 0, 64)
reaper.MIDI_InsertCC(take, false, false, ppq(3.55), 0xE0, 0, 127, 127)
reaper.MIDI_InsertCC(take, false, false, ppq(3.90), 0xE0, 0, 0, 64)
reaper.MIDI_Sort(take)

reaper.SetOnlyTrackSelected(track)
reaper.GetSetProjectInfo(0, "PROJECT_SRATE", 48000, true)
reaper.GetSetProjectInfo(0, "PROJECT_SRATE_USE", 1, true)
reaper.GetSetProjectInfo(0, "RENDER_SETTINGS", 0, true)
reaper.GetSetProjectInfo(0, "RENDER_BOUNDSFLAG", 0, true)
reaper.GetSetProjectInfo(0, "RENDER_STARTPOS", 0, true)
reaper.GetSetProjectInfo(0, "RENDER_ENDPOS", 4.5, true)
reaper.GetSetProjectInfo(0, "RENDER_CHANNELS", 2, true)
reaper.GetSetProjectInfo(0, "RENDER_SRATE", 48000, true)
reaper.GetSetProjectInfo(0, "RENDER_TAILFLAG", 0, true)
reaper.GetSetProjectInfo(0, "RENDER_ADDTOPROJ", 0, true)
reaper.GetSetProjectInfo(0, "RENDER_DITHER", 16, true)
reaper.GetSetProjectInfo(0, "RENDER_NORMALIZE", 4 << 16, true)
reaper.GetSetProjectInfo_String(0, "PROJECT_TITLE", "Morphazoid Chaotic FM smoke", true)
reaper.GetSetProjectInfo_String(0, "RENDER_FILE", output_dir, true)
reaper.GetSetProjectInfo_String(0, "RENDER_PATTERN", "chaotic-fm-smoke", true)
reaper.GetSetProjectInfo_String(0, "RENDER_FORMAT", "evaw", true)
reaper.GetSetProjectInfo_String(0, "RENDER_FORMAT2", "", true)

reaper.Main_SaveProjectEx(0, project_path, 0)

local _, note_count, cc_count, text_count = reaper.MIDI_CountEvts(take)
local _, render_targets = reaper.GetSetProjectInfo_String(
  0,
  "RENDER_TARGETS",
  "",
  false
)

write_status({
  "status=created",
  "project=" .. project_path,
  "fx_candidate=" .. matched_candidate,
  "fx_name=" .. loaded_fx_name,
  "fx_index=" .. tostring(fx_index),
  "parameter_count=" .. tostring(parameter_count),
  "midi_note_count=" .. tostring(note_count),
  "midi_cc_count=" .. tostring(cc_count),
  "midi_text_count=" .. tostring(text_count),
  "render_targets=" .. render_targets,
})

reaper.UpdateArrange()
