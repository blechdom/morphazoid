-- @description Float the Chaotic FM UI on the first track
-- @version 0.1.0
-- @author Morphazoid

local track = reaper.GetTrack(0, 0)
if not track then
  reaper.ShowMessageBox(
    "Open the Chaotic FM smoke project before running this script.",
    "Morphazoid",
    0
  )
  return
end

local fx_count = reaper.TrackFX_GetCount(track)
if fx_count < 1 then
  reaper.ShowMessageBox(
    "The first track does not contain Chaotic FM.",
    "Morphazoid",
    0
  )
  return
end

-- 3 floats the requested effect in its own window.
reaper.TrackFX_Show(track, 0, 3)
