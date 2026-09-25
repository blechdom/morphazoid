/**
 * Rubixoids-owned views. The three instrument control surfaces are kept intact
 * here so the app mounts its instruments directly, without loading other pages.
 * Audio and output elements remain available to each controller; the app's one
 * masthead delegates to those controls in the active view.
 */

const slidingPuzzleMarkup = `
<div class="rubixoids-native-view sliding-puzzle-page">
  <div class="rubixoids-native-controls" hidden aria-hidden="true">
    <div class="audio-strip" aria-label="Audio controls">
        <button class="audio-button" id="audioButton" type="button" aria-pressed="false">
          <span class="audio-glyph sliding-audio-glyph" aria-hidden="true">▦</span>
          <span class="audio-copy"><b>Audio</b><small id="audioState">off</small></span>
        </button>
        <label class="header-level" for="output">
          <span><b>Output</b><output id="outputOut" for="output">54%</output></span>
          <input
            id="output"
            aria-label="Sliding puzzle output level"
            type="range"
            min="0"
            max="0.9"
            step="0.01"
            value="0.54"
          />
        </label>
      </div>
  </div>

    <main class="shell sliding-puzzle-shell" id="slidingPuzzleSequencer">
      <section class="stage sliding-puzzle-stage" aria-labelledby="slidingPuzzleTitle">
        <div class="stage-wrap sliding-puzzle-stage-wrap" id="stageWrap">
          <div class="sliding-puzzle-heading">
            <p>PERMUTATION · <b id="stageScoreLabel">15 NOTES + ONE REST</b></p>
            <h1 id="slidingPuzzleTitle">Sliding Puzzle</h1>
            <span>the gap writes the rhythm</span>
          </div>

          <div class="sliding-puzzle-performance">
            <div class="sliding-orientation" aria-hidden="true">
              <span class="sliding-orientation-arrow">↑</span>
              <b id="orientationLabel">0°</b>
              <small>READ TOP</small>
            </div>

            <div class="sliding-puzzle-frame" id="puzzleFrame">
              <div class="sliding-board-slots" id="boardSlots" aria-hidden="true"></div>
              <div class="sliding-puzzle-reader" id="puzzleReader" aria-hidden="true"></div>
              <div
                class="sliding-puzzle-board"
                id="puzzleBoard"
                role="grid"
                aria-label="Resizable sliding note puzzle with colored tiles and one empty cell."
                aria-describedby="puzzleInstructions liveStatus"
                style="--board-turn: 0deg"
              ></div>
            </div>

            <div class="sliding-stage-rotate" role="group" aria-label="Rotate board">
              <button id="rotateLeftStage" type="button" aria-label="Rotate board 90 degrees left">
                <span aria-hidden="true">↶</span><small>90° LEFT</small>
              </button>
              <button id="rotateRightStage" type="button" aria-label="Rotate board 90 degrees right">
                <small>90° RIGHT</small><span aria-hidden="true">↷</span>
              </button>
            </div>
          </div>

          <div class="sliding-score-readout" id="stageSequence" aria-hidden="true"></div>

          <div class="stage-meta" aria-hidden="true">
            <span id="stageReadout">SOLVED · 4×4 · LINES TOGETHER · STEP 01/04 · AUDIO OFF</span>
          </div>

          <div class="sliding-gesture-hint" aria-hidden="true">
            <span>CLICK A LIT TILE TO SLIDE · ARROW KEYS MOVE THE GAP</span>
          </div>
        </div>
      </section>

      <aside class="panel sliding-puzzle-panel" aria-label="Sliding Puzzle controls">
        <div class="sliding-status-strip">
          <b id="puzzleState">Solved · 4 × 4 · 15 notes / one rest</b>
          <small id="sequenceState">Lines together · 4 steps · 0° · Soft FM kit</small>
        </div>

        <details class="group control-section sliding-control-section" data-section="clock" open>
          <summary class="group-summary">
            <h2 class="group-title">Clock</h2>
            <span class="section-state" id="clockSummary">124 BPM · straight</span>
          </summary>
          <div class="group-body">
            <div class="sliding-clock-transport" aria-label="Sequencer transport">
              <button class="sliding-play-button" id="playButton" type="button" aria-pressed="false">
                <svg class="transport-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5 18 12 8 18.5Z" /></svg>
                <svg class="transport-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12" /></svg>
                <span><b id="playLabel">Play puzzle</b><small id="playState">4-step line loop</small></span>
              </button>
              <div class="sliding-step-strip" id="stepStrip" aria-label="Puzzle sequence playhead"></div>
              <div class="sliding-now-playing" aria-live="off">
                <span id="nowPlaying">STEP 01 / 04 · 4 NOTES</span>
              </div>
            </div>

            <div class="sliding-read-heading">
              <b>Playback</b>
              <span>Rubix-style lanes or one tile</span>
            </div>
            <div class="sliding-playback-modes" role="group" aria-label="Playback layout">
              <button type="button" data-playback-mode="parallel" aria-pressed="true">
                <b>Lines together</b><small>one column · every row</small>
              </button>
              <button type="button" data-playback-mode="serial" aria-pressed="false">
                <b>One tile</b><small>follow a board path</small>
              </button>
            </div>

            <div class="sliding-read-heading">
              <b>Serial path</b>
              <span id="readPathState">Lines saved · available in One tile mode</span>
            </div>
            <div class="sliding-read-paths" role="group" aria-label="Board read path">
              <button type="button" data-read-path="rows" aria-pressed="true" disabled>
                <b>Lines</b><small>left → right</small>
              </button>
              <button type="button" data-read-path="snake" aria-pressed="false" disabled>
                <b>Snake</b><small>alternating rows</small>
              </button>
              <button type="button" data-read-path="spiral" aria-pressed="false" disabled>
                <b>Spiral</b><small>outside → center</small>
              </button>
            </div>

            <div class="sliding-clock-options">
              <label class="select-control" for="pulseDivision">
                <span><b>Pulse rate</b></span>
                <span class="select-shell">
                  <select id="pulseDivision">
                    <option value="4">1/4</option>
                    <option value="8" selected>1/8</option>
                    <option value="16">1/16</option>
                    <option value="32">1/32</option>
                    <option value="64">1/64</option>
                  </select>
                </span>
              </label>
              <label class="select-control" for="playbackDirection">
                <span><b>Direction</b></span>
                <span class="select-shell">
                  <select id="playbackDirection">
                    <option value="forward" selected>Forward</option>
                    <option value="reverse">Reverse</option>
                    <option value="pendulum">Pendulum</option>
                    <option value="random">Random pass</option>
                  </select>
                </span>
              </label>
            </div>

            <div class="sliding-tempo-row">
              <label class="control" for="tempo">
                <span><b>Tempo</b><output id="tempoOut" for="tempo">124 BPM</output></span>
                <input id="tempo" type="range" min="30" max="300" step="1" value="124" />
              </label>
              <button
                class="sliding-restart-button"
                id="restartLoop"
                type="button"
                aria-label="Restart loop at step one"
                title="Restart loop at step one"
              >
                <span aria-hidden="true">↶ 1</span>
              </button>
            </div>
            <label class="control" for="swing">
              <span><b>Swing</b><output id="swingOut" for="swing">0%</output></span>
              <input id="swing" type="range" min="0" max="0.42" step="0.01" value="0" />
            </label>
          </div>
        </details>

        <details class="group control-section sliding-control-section" data-section="moves" open>
          <summary class="group-summary">
            <h2 class="group-title">Puzzle moves</h2>
            <span class="section-state" id="moveSummary">solved · 0 moves</span>
          </summary>
          <div class="group-body">
            <div class="sliding-dimensions">
              <div class="sliding-dimension-heading">
                <span><b>Board dimensions</b><output id="dimensionOut">4 × 4 · 15 tiles</output></span>
                <button id="squareLock" type="button" aria-pressed="true">
                  <b>Square lock</b><small id="squareLockState">on</small>
                </button>
              </div>
              <div class="sliding-dimension-grid">
                <label class="control" for="rows">
                  <span><b>Rows</b><output id="rowsOut" for="rows">4</output></span>
                  <input id="rows" type="range" min="2" max="8" step="1" value="4" />
                </label>
                <label class="control" for="columns">
                  <span><b>Columns</b><output id="columnsOut" for="columns">4</output></span>
                  <input id="columns" type="range" min="2" max="8" step="1" value="4" />
                </label>
              </div>
              <small>Unlock square to make any rectangle from 2 × 2 through 8 × 8. Resizing starts a solved board.</small>
            </div>

            <div class="sliding-move-actions" aria-label="Puzzle arrangement actions">
              <button class="mini-action" id="scramblePuzzle" type="button">Scramble 48</button>
              <button class="mini-action sliding-solve-button" id="solvePuzzle" type="button" disabled>Solve · unwind</button>
              <button class="mini-action" id="undoMove" type="button" disabled>Undo move</button>
              <button class="mini-action" id="resetPuzzle" type="button">Reset puzzle</button>
            </div>

            <div class="sliding-rotation-control">
              <div>
                <b>Quarter-turn score</b>
                <small>Rotates the board beneath the screen reader</small>
              </div>
              <div role="group" aria-label="Quarter-turn score">
                <button id="rotateLeft" type="button" aria-label="Rotate score 90 degrees left"><span>↶</span> LEFT</button>
                <output id="rotationOut" aria-live="off">0°</output>
                <button id="rotateRight" type="button" aria-label="Rotate score 90 degrees right">RIGHT <span>↷</span></button>
              </div>
            </div>

            <div class="sliding-auto-motion">
              <button id="autoSlide" type="button" aria-pressed="false">
                <span aria-hidden="true">▧</span>
                <span><b>Auto slide</b><small id="autoSlideState">off</small></span>
              </button>
              <label class="control" for="autoSlideSpeed">
                <span>
                  <b>Slide speed</b>
                  <output id="autoSlideSpeedOut" for="autoSlideSpeed">1×</output>
                </span>
                <input
                  id="autoSlideSpeed"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value="36"
                  aria-valuetext="1 times normal speed"
                  aria-describedby="autoSlideHelp"
                />
              </label>
              <small id="autoSlideHelp">Automatic legal moves · independent of sequencer tempo</small>
            </div>

            <div class="sliding-move-receipt" aria-label="Move history">
              <span><b>Empty cell</b><small id="blankCell">board row 4 · column 4</small></span>
              <span><b>Disorder</b><small id="disorderState">0 steps from home</small></span>
              <span><b>History</b><small id="historyState">ready</small></span>
            </div>
          </div>
        </details>

        <details class="group control-section sliding-control-section" data-section="sound" open>
          <summary class="group-summary">
            <h2 class="group-title">Sound</h2>
            <span class="section-state" id="soundSummary">Soft FM kit · D dorian</span>
          </summary>
          <div class="group-body">
            <label class="select-control" for="soundBank">
              <span><b>Tile bank</b><output id="soundBankState" for="soundBank">Soft FM kit</output></span>
              <span class="select-shell">
                <select id="soundBank">
                  <option value="soft-fm" selected>Soft FM kit</option>
                  <option value="analog">Analog kit</option>
                  <option value="modal">Modal colors</option>
                  <option value="noise">Noise grid</option>
                  <option value="acid-303">303 acid</option>
                  <option value="shared-simd-chiptune">SIMD Chiptune</option>
                  <option value="shared-simd-303">SIMD 303</option>
                  <option value="shared-simd-synth">SIMD Synth</option>
                  <option value="shared-soft-fm">Soft FM kit</option>
                  <option value="shared-analog">Analog kit</option>
                  <option value="shared-modal">Modal kit</option>
                  <option value="shared-noise">Noise kit</option>
                  <option value="shared-rattlesnake">Rattlesnake · Modal + FM</option>
                  <option value="shared-pitched-morph">Mallets · Pitched Morph</option>
                  <option value="shared-karplus-strong">Karplus Strong · plucked</option>
                  <option value="shared-sine">Sine</option>
                </select>
              </span>
            </label>
            <label class="select-control" for="scale">
              <span><b>Tile tuning</b><output id="scaleState" for="scale">D dorian</output></span>
              <span class="select-shell">
                <select id="scale">
                  <option value="dorian" selected>D dorian</option>
                  <option value="minor-pentatonic">A minor pentatonic</option>
                  <option value="whole-tone">C whole tone</option>
                  <option value="chromatic">Chromatic</option>
                </select>
              </span>
            </label>
            <div class="sliding-sound-grid">
              <label class="control" for="brightness">
                <span><b>Brightness</b><output id="brightnessOut" for="brightness">62%</output></span>
                <input id="brightness" type="range" min="0" max="1" step="0.01" value="0.62" />
              </label>
              <label class="control" for="decay">
                <span><b>Decay</b><output id="decayOut" for="decay">42%</output></span>
                <input id="decay" type="range" min="0.08" max="0.9" step="0.01" value="0.42" />
              </label>
              <label class="control" for="colorDepth">
                <span><b>Color depth</b><output id="colorDepthOut" for="colorDepth">74%</output></span>
                <input id="colorDepth" type="range" min="0" max="1" step="0.01" value="0.74" />
              </label>
              <label class="control" for="stereoWidth">
                <span><b>Stereo width</b><output id="stereoWidthOut" for="stereoWidth">68%</output></span>
                <input id="stereoWidth" type="range" min="0" max="1" step="0.01" value="0.68" />
              </label>
              <label class="control" for="pitchSpan">
                <span><b>Pitch span</b><output id="pitchSpanOut" for="pitchSpan">36 st</output></span>
                <input id="pitchSpan" type="range" min="12" max="48" step="1" value="36" />
              </label>
              <label class="control" for="microStrum">
                <span><b>Parallel strum</b><output id="microStrumOut" for="microStrum">12 ms</output></span>
                <input id="microStrum" type="range" min="0" max="0.04" step="0.001" value="0.012" />
              </label>
            </div>
            <div class="sliding-mapping-divider"><span>puzzle mapping · 0–200%</span></div>
            <div class="sliding-sound-grid sliding-mapping-grid">
              <label class="control" for="positionInfluence">
                <span><b>Position pitch</b><output id="positionInfluenceOut" for="positionInfluence">72%</output></span>
                <input id="positionInfluence" type="range" min="0" max="2" step="0.01" value="0.72" />
                <small>Screen position and distance from home bend tile pitch.</small>
              </label>
              <label class="control" for="filterInfluence">
                <span><b>Filter motion</b><output id="filterInfluenceOut" for="filterInfluence">72%</output></span>
                <input id="filterInfluence" type="range" min="0" max="2" step="0.01" value="0.72" />
                <small>Screen height and tile displacement move brightness.</small>
              </label>
              <label class="control" for="neighborResponse">
                <span><b>Neighbor response</b><output id="neighborResponseOut" for="neighborResponse">65%</output></span>
                <input id="neighborResponse" type="range" min="0" max="2" step="0.01" value="0.65" />
                <small>Matching colors ring; mixed-color borders add edge.</small>
              </label>
              <label class="control" for="disorderInfluence">
                <span><b>Disorder response</b><output id="disorderInfluenceOut" for="disorderInfluence">60%</output></span>
                <input id="disorderInfluence" type="range" min="0" max="2" step="0.01" value="0.6" />
                <small>Distance from solved adds bounded detune and filter energy.</small>
              </label>
            </div>
            <p class="sliding-sound-note" id="soundDescription">
              A four-color home-row cycle shapes pitch and timbre while each tile keeps its note identity.
              The moving empty cell is always a hard rest.
            </p>
          </div>
        </details>

        <details class="group control-section sliding-control-section sliding-score-section" data-section="score" open>
          <summary class="group-summary">
            <h2 class="group-title">Tile score</h2>
            <span class="section-state" id="scoreSummary">15 sounding · 1 rest</span>
          </summary>
          <div class="group-body">
            <p class="sliding-causal-copy">
              Parallel playback sounds every screen row at one shared column; serial playback follows
              one path. Sliding changes step identities, while rotating a rectangle swaps its line and
              step counts without changing the underlying puzzle.
            </p>
            <div class="sliding-color-key" id="colorKey" aria-label="Tile color sound mapping"></div>
          </div>
        </details>

        <p class="audio-error" id="audioError" role="alert" hidden></p>
        <div class="reset-all-row sliding-reset-sound-row">
          <button
            class="reset-all-button"
            id="resetSound"
            type="button"
            data-reset-all
            data-reset-in-place
            title="Restore sound and clock controls without changing the puzzle"
          >
            Reset sound + clock
          </button>
        </div>
      </aside>

      <p class="sr-only" id="puzzleInstructions">
        Click or press Enter on any highlighted tile sharing the empty cell's row or column. That
        tile and every tile between it and the empty cell slide together toward the gap.
        Arrow keys move the empty cell in screen space. Space starts or pauses the current loop.
        Lines together plays one screen column across every row at once; the empty cell rests only
        its lane. One tile mode follows the selected Lines, Snake, or Spiral path. Rotate left or right to turn the board by
        ninety degrees beneath the fixed screen-space reader; this changes the note order without
        changing the puzzle permutation. Rows and columns resize independently when Square lock is off.
        Scramble performs a size-scaled set of fast legal moves. Auto slide
        continues making legal moves at its own speed. Solve unwinds the exact move history, so every
        scrambled state remains solvable.
      </p>
      <p class="sr-only" id="liveStatus" aria-live="polite"></p>
    </main>
</div>
`;

const rubixMarkup = `
<div class="rubixoids-native-view rubix-page">
  <div class="rubixoids-native-controls" hidden aria-hidden="true">
    <div class="audio-strip" aria-label="Audio controls">
        <button class="audio-button" id="audioButton" type="button" aria-pressed="false">
          <span class="audio-glyph rubix-audio-glyph" aria-hidden="true">◆</span>
          <span class="audio-copy"><b>Audio</b><small id="audioState">off</small></span>
        </button>
        <label class="header-level" for="output">
          <span><b>Output</b><output id="outputOut" for="output">56%</output></span>
          <input
            id="output"
            aria-label="Rubix sequencer output level"
            type="range"
            min="0"
            max="0.9"
            step="0.01"
            value="0.56"
          />
        </label>
      </div>
  </div>

    <main class="shell rubix-shell" id="rubixSequencer">
      <section class="stage rubix-stage" aria-labelledby="rubixTitle">
        <div class="stage-wrap rubix-stage-wrap" id="stageWrap">
          <canvas
            id="stage"
            tabindex="0"
            role="application"
            aria-label="Interactive 3 by 3 Rubix sequencer cube. Audio off. Drag stickers to twist or empty space to orbit."
            aria-describedby="cubeInstructions liveStatus"
          >
            A playable 3 by 3 cube. Choose one sound bank: a synthesized drum kit
            or 303 acid for every visible face. Hidden stickers are silent.
          </canvas>

          <div class="rubix-heading">
            <p>GEOMETRY · ONE SOUND BANK</p>
            <h1 id="rubixTitle">Rubix</h1>
            <span>what is visible is what is heard</span>
          </div>

          <div class="rubix-face-badges" id="faceBadges" aria-hidden="true"></div>

          <div class="stage-meta" aria-hidden="true">
            <span id="stageReadout">VISIBLE U / F / R · STEP 1/9 · AUDIO OFF</span>
          </div>

          <div class="rubix-gesture-hint" id="gestureHint" aria-hidden="true">
            <span>DRAG A STICKER TO TWIST · DRAG EMPTY SPACE TO ORBIT</span>
          </div>
        </div>

      </section>

      <aside class="panel rubix-panel" aria-label="Rubix Cube Sequencer controls">
        <div class="rubix-status-strip" aria-live="polite">
          <b id="engineState">Shared Web Audio engine</b>
          <small id="sequenceState">27 visible stickers · 3 lanes × 9 steps</small>
        </div>

        <details class="group control-section rubix-control-section" data-section="play" open>
          <summary class="group-summary">
            <h2 class="group-title">Clock</h2>
            <span class="section-state" id="clockSummary">126 BPM · straight</span>
          </summary>
          <div class="group-body">
            <div class="rubix-clock-transport" role="group" aria-label="Sequencer transport">
              <button class="rubix-play-button" id="playButton" type="button" aria-pressed="false">
                <svg class="transport-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5 18 12 8 18.5Z" /></svg>
                <svg class="transport-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12" /></svg>
                <span><b id="playLabel">Play cube</b><small id="playState">9-step loop</small></span>
              </button>
              <div class="rubix-step-strip" id="stepStrip" role="img" aria-label="Sequence playhead"></div>
              <div class="rubix-now-playing" aria-live="off">
                <span id="acidNow">ACID · BANK OFF</span>
                <span id="drumNow">DRUMS · SOFT FM KIT</span>
              </div>
            </div>
            <label class="select-control rubix-preset-control" for="rubixPreset">
              <span>
                <b>Performance preset</b>
                <output id="rubixPresetState" for="rubixPreset">Classic cube</output>
              </span>
              <span class="select-shell">
                <select id="rubixPreset" aria-label="Rubix performance preset">
                  <option value="" disabled>Custom settings</option>
                  <option value="classic" selected>Classic cube</option>
                  <option value="pocket-funk">Pocket funk</option>
                  <option value="modal-sphere">Modal orb</option>
                  <option value="noise-grid">Noise grid</option>
                  <option value="pyramid-drift">Morphix drift</option>
                </select>
              </span>
            </label>
            <div class="rubix-read-heading">
              <b>Read path</b>
              <span id="readModeState">rows together · 9 steps</span>
            </div>
            <div class="rubix-read-modes" role="group" aria-label="Visible face read path">
              <button type="button" data-read-mode="parallel" aria-pressed="true">
                <b>Rows together</b><small>default · all 6 faces</small>
              </button>
              <button type="button" data-read-mode="snake" aria-pressed="false">
                <b>Snake together</b><small>all 6 faces · 9 steps</small>
              </button>
              <button type="button" data-read-mode="face" aria-pressed="false">
                <b>Alternate faces</b><small>opposite pairs · 27 steps</small>
              </button>
            </div>
            <label
              class="control rubix-visibility-dynamics"
              for="visibilityDynamics"
              title="0% keeps every visible sticker at equal level; 100% follows its projected square area."
            >
              <span>
                <b>Visibility dynamics</b>
                <output id="visibilityDynamicsOut" for="visibilityDynamics">100%</output>
              </span>
              <input
                id="visibilityDynamics"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value="1"
              />
              <small>0% equal level · 100% projected square area</small>
            </label>
            <div class="rubix-tempo-row">
              <label class="control" for="tempo">
                <span><b>Tempo</b><output id="tempoOut" for="tempo">126 BPM</output></span>
                <input id="tempo" type="range" min="30" max="300" step="1" value="126" />
              </label>
              <button
                class="rubix-restart-button"
                id="restartLoop"
                type="button"
                aria-label="Restart loop at step 1"
                title="Restart loop at step 1"
              >
                <span aria-hidden="true">↶ 1</span>
              </button>
            </div>
            <label class="control" for="swing">
              <span><b>Swing</b><output id="swingOut" for="swing">0%</output></span>
              <input id="swing" type="range" min="0" max="0.42" step="0.01" value="0" />
            </label>
          </div>
        </details>

        <details class="group control-section rubix-control-section" data-section="form" open>
          <summary class="group-summary">
            <h2 class="group-title">Cube moves</h2>
            <span class="section-state" id="moveSummary">manual · no selection</span>
          </summary>
          <div class="group-body">
            <fieldset class="rubix-geometry-control rubix-shape-size-controls">
              <legend class="sr-only">Cube style</legend>
              <label class="select-control rubix-shape-control" for="shape">
                <span>
                  <b>Shape</b>
                  <output id="shapeState" for="shape">Cube</output>
                </span>
                <span class="select-shell">
                  <select id="shape" aria-label="Puzzle visual shape">
                    <option value="cube" selected>Cube</option>
                    <option value="morphix">Morphix · pyramid</option>
                    <option value="diamond">Diamond · double pyramid</option>
                    <option value="stella">Stella · 8-point star</option>
                    <option value="orb">Orb · sphere</option>
                  </select>
                </span>
              </label>
              <label class="control rubix-size-control" for="rubixSize">
                <span>
                  <b>Size</b>
                  <output id="rubixSizeOut" for="rubixSize">3 × 3</output>
                </span>
                <input
                  id="rubixSize"
                  type="range"
                  min="2"
                  max="6"
                  step="1"
                  value="3"
                  aria-valuetext="3 by 3, 3 layers per face"
                  aria-describedby="rubixFormHelp"
                />
                <small class="rubix-size-limits" aria-hidden="true"><span>2</span><span>6</span></small>
              </label>
              <small class="rubix-form-note" id="rubixFormHelp">Cube turns · visual form · release Size to load</small>
            </fieldset>
            <div class="rubix-cube-actions" role="group" aria-label="Cube arrangement actions">
              <button class="mini-action" id="scrambleCube" type="button">Scramble 18</button>
              <button class="mini-action rubix-solve-button" id="solveCube" type="button">Solve cube</button>
              <button class="mini-action" id="undoMove" type="button" disabled>Undo move</button>
              <button class="mini-action" id="resetView" type="button">Reset view</button>
            </div>
            <div class="rubix-random-twists">
              <button id="randomTwists" type="button" aria-pressed="false" aria-label="Start random twists" title="Start random twists">
                <span class="rubix-random-twist-icon" aria-hidden="true">
                  <svg class="transport-play" viewBox="0 0 24 24"><path d="M8 5.5 18 12 8 18.5Z" /></svg>
                  <svg class="transport-pause" viewBox="0 0 24 24"><path d="M8 6v12M16 6v12" /></svg>
                </span>
                <span><b>Random twists</b><small id="randomTwistState">off</small></span>
              </button>
              <label class="control" for="randomTwistSpeed">
                <span>
                  <b>Twist speed</b>
                  <output id="randomTwistSpeedOut" for="randomTwistSpeed">1×</output>
                </span>
                <input
                  id="randomTwistSpeed"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value="36"
                  aria-valuetext="1 times normal speed"
                  aria-describedby="randomTwistHelp"
                />
              </label>
              <small id="randomTwistHelp">Automatic movement speed · independent of sequencer tempo</small>
            </div>
            <div class="rubix-selected-sticker">
              <span><b>Selected sticker</b><small id="selectedSticker">tap a tile</small></span>
              <i id="selectedSwatch" aria-hidden="true"></i>
            </div>
            <div class="rubix-move-pad" role="group" aria-label="Selected slice controls">
              <button id="moveUp" type="button" aria-label="Move selected column up">↑<small>column</small></button>
              <button id="moveLeft" type="button" aria-label="Move selected row left">←<small>row</small></button>
              <span aria-hidden="true">SLICE</span>
              <button id="moveRight" type="button" aria-label="Move selected row right">→<small>row</small></button>
              <button id="moveDown" type="button" aria-label="Move selected column down">↓<small>column</small></button>
            </div>
          </div>
        </details>

        <details class="group control-section rubix-control-section rubix-sound-bank-section" data-section="sound" open>
          <summary class="group-summary">
            <h2 class="group-title">Sound bank</h2>
            <span class="section-state" id="soundBankSummary">Soft FM kit</span>
          </summary>
          <div class="group-body">
            <label class="select-control rubix-sound-bank-control" for="soundBank">
              <span>
                <b>Active bank</b>
                <output id="soundBankState" for="soundBank">Soft FM kit</output>
              </span>
              <span class="select-shell">
                <select
                  id="soundBank"
                  aria-label="Rubix sound bank"
                  aria-describedby="soundBankHelp soundBankStatus"
                >
                  <option value="soft-fm" selected>Soft FM kit</option>
                  <option value="analog">Analog kit</option>
                  <option value="modal">Modal kit</option>
                  <option value="noise">Noise kit</option>
                  <option value="rattlesnake">Rattlesnake · Modal + FM</option>
                  <option value="pitched-morph">Mallets · Pitched Morph</option>
                  <option value="karplus-strong">Karplus Strong · plucked</option>
                  <option value="acid-303">303 acid</option>
                  <option value="shared-simd-chiptune">SIMD Chiptune</option>
                  <option value="shared-simd-303">SIMD 303</option>
                  <option value="shared-simd-synth">SIMD Synth</option>
                  <option value="shared-soft-fm">Soft FM kit</option>
                  <option value="shared-analog">Analog kit</option>
                  <option value="shared-modal">Modal kit</option>
                  <option value="shared-noise">Noise kit</option>
                  <option value="shared-rattlesnake">Rattlesnake · Modal + FM</option>
                  <option value="shared-pitched-morph">Mallets · Pitched Morph</option>
                  <option value="shared-karplus-strong">Karplus Strong · plucked</option>
                  <option value="shared-sine">Sine</option>
                </select>
              </span>
              <small id="soundBankHelp">
                One bank plays at a time · all six faces run · only visible stickers sound
              </small>
            </label>
            <small
              class="rubix-sound-bank-status"
              id="soundBankStatus"
              role="status"
              aria-live="polite"
            >
              Soft FM kit active · all visible faces · 303 muted
            </small>

            <fieldset
              class="rubix-bank-subcontrols rubix-kit-bank-controls"
              id="kitBankControls"
              aria-describedby="kitBankHelp"
            >
              <legend>Drum kit controls</legend>
              <p class="rubix-bank-help" id="kitBankHelp">
                Selected kit · all visible faces · 303 muted
              </p>
              <label class="control" for="drumLevel">
                <span><b>Kit level</b><output id="drumLevelOut" for="drumLevel">54%</output></span>
                <input id="drumLevel" type="range" min="0" max="1" step="0.01" value="0.54" />
              </label>
              <p class="rubix-engine-note">
                Sticker colors choose kick, snare, tom, and hat voices. Only the
                selected kit sounds; the 303 bank remains silent. Rattlesnake,
                Mallets and Karplus Strong reuse the larger app’s synthesis engines.
                Attack-level matching and master compression tame dense mixes.
              </p>
            </fieldset>

            <fieldset
              class="rubix-bank-subcontrols rubix-acid-bank-controls is-disabled"
              id="acidBankControls"
              aria-describedby="acidBankHelp"
              disabled
            >
              <legend>303 acid controls</legend>
              <p class="rubix-bank-help" id="acidBankHelp">
                Classic or SIMD 303 · all visible faces · drum kit muted
              </p>
              <label class="select-control rubix-acid-engine-control" for="acidEngine">
                <span>
                  <b>303 engine</b>
                  <output id="acidEngineState" for="acidEngine">SIMD 303</output>
                </span>
                <span class="select-shell">
                  <select
                    id="acidEngine"
                    aria-label="303 acid engine"
                    aria-describedby="acidEngineHelp acidEngineStatus"
                  >
                    <option value="web-audio">Classic Web Audio</option>
                    <option value="simd-303" selected>SIMD · sticker modulation</option>
                  </select>
                </span>
                <small id="acidEngineHelp">
                  Classic uses color pitch · SIMD also maps row, column, edge, face, and visibility
                </small>
              </label>
              <label class="select-control rubix-acid-engine-control" for="simdPreset">
                <span>
                  <b>SIMD sound</b>
                  <output id="simdPresetState" for="simdPreset">Color circuit</output>
                </span>
                <span class="select-shell">
                  <select id="simdPreset" aria-label="SIMD 303 sound preset" aria-describedby="simdPresetHelp">
                    <option value="" disabled>Custom sound</option>
                  </select>
                </span>
                <small id="simdPresetHelp">Sound only · keeps volume, cube, tempo and transport.</small>
              </label>
              <label
                class="control rubix-sticker-modulation is-disabled"
                id="stickerModulationControl"
                for="stickerModulation"
              >
                <span>
                  <b>Sticker modulation</b>
                  <output id="stickerModulationOut" for="stickerModulation">68%</output>
                </span>
                <input
                  id="stickerModulation"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value="0.68"
                  aria-describedby="acidEngineStatus"
                  disabled
                />
              </label>
              <small class="rubix-acid-engine-status" id="acidEngineStatus" role="status" aria-live="polite">
                SIMD support is checked in this browser
              </small>
              <label class="control" for="cutoff">
                <span><b>Cutoff</b><output id="cutoffOut" for="cutoff">840 Hz</output></span>
                <input id="cutoff" type="range" min="160" max="4200" step="10" value="840" />
              </label>
              <label class="control" for="resonance">
                <span><b>Resonance</b><output id="resonanceOut" for="resonance">10.8</output></span>
                <input id="resonance" type="range" min="0" max="18" step="0.1" value="10.8" />
              </label>
              <label class="control" for="acidDecay">
                <span><b>Accent decay</b><output id="acidDecayOut" for="acidDecay">280 ms</output></span>
                <input id="acidDecay" type="range" min="0.06" max="0.72" step="0.01" value="0.28" />
              </label>
              <label class="control" for="drive">
                <span><b>Drive</b><output id="driveOut" for="drive">1.8×</output></span>
                <input id="drive" type="range" min="0.5" max="6" step="0.1" value="1.8" />
              </label>
              <label class="control" for="acidLevel">
                <span><b>303 level</b><output id="acidLevelOut" for="acidLevel">58%</output></span>
                <input id="acidLevel" type="range" min="0" max="1" step="0.01" value="0.58" />
              </label>
              <p class="rubix-engine-note">
                Colors set pitch and articulation. Visible height, depth and shape
                steer tone; screen position steers stereo. Hidden stickers are silent.
                Sound presets keep your volume and cube unchanged.
              </p>
            </fieldset>
          </div>
        </details>

        <details class="group control-section rubix-control-section rubix-score-section" data-section="mapping" open>
          <summary class="group-summary">
            <h2 class="group-title">Visible score</h2>
            <span class="section-state" id="scoreSummary">Soft FM kit · all faces</span>
          </summary>
          <div class="group-body">
            <p class="rubix-causal-copy" id="scoreDescription">
              All six face sequences keep running. Only uncovered, on-screen stickers
              are audible. Their screen area sets their relative level, even during turns.
              Hidden stickers are silent.
            </p>
            <div class="rubix-lane-list" id="laneList" role="group" aria-label="All six cube faces and their visibility"></div>
            <div class="rubix-color-key" id="colorKey" role="group" aria-label="Selected bank sticker color mapping"></div>
          </div>
        </details>

        <p class="audio-error" id="audioError" role="alert" hidden></p>
        <div class="reset-all-row rubix-reset-sound-row">
          <button
            class="reset-all-button"
            id="resetSound"
            type="button"
            data-reset-all
            data-reset-in-place
            title="Restore sound settings without changing the cube or view"
          >
            Reset sound
          </button>
        </div>
      </aside>

      <p class="sr-only" id="cubeInstructions">
        Drag a visible sticker left, right, up, or down to turn its row or column.
        Drag empty stage space to orbit the whole form. Use arrow keys to turn the
        selected sticker's row or column and Space to play or pause. Random Twists
        uses its own derived speed curve, independent of sequencer tempo. Choose Rows
        together, Snake together, or Alternate faces
        in the Clock section to change how the visible stickers are read. Alternate
        faces divides each beat into opposite face pairs: up/down, front/back,
        then left/right. Choose exactly one Sound bank for all six face sequences.
        Only uncovered stickers in the viewport sound, including their ringing tails. The Classic Web Audio and SIMD choices are available only
        inside the 303 acid bank. The
        Shape chooses a cube-compatible visual form; Size loads 2 by 2 through 6 by 6 grids.
        Larger projected stickers sound louder according to Visibility dynamics,
        and any sticker that cannot be seen is silent. In the 303 acid bank, choose
        SIMD to let each sticker's row, column, edge, current face, and visibility
        reshape its acid step; unsupported browsers use Classic Web Audio.
      </p>
      <p class="sr-only" id="liveStatus" aria-live="polite"></p>
    </main>
</div>
`;

const hyperRubixMarkup = `
<div class="rubixoids-native-view hyper-rubix-page">
  <div class="rubixoids-native-controls" hidden aria-hidden="true">
    <div class="audio-strip" aria-label="Audio controls">
        <button class="audio-button" id="audioButton" type="button" aria-pressed="false">
          <span class="audio-glyph hyper-rubix-audio-glyph" aria-hidden="true">◇</span>
          <span class="audio-copy"><b>Audio</b><small id="audioState">off</small></span>
        </button>
        <label class="header-level" for="output">
          <span><b>Output</b><output id="outputOut" for="output">48%</output></span>
          <input
            id="output"
            aria-label="Hyper Rubix output level"
            type="range"
            min="0"
            max="0.82"
            step="0.01"
            value="0.48"
          />
        </label>
      </div>
  </div>

    <main class="shell hyper-rubix-shell" id="hyperRubix">
      <section class="stage hyper-rubix-stage" aria-labelledby="hyperRubixTitle">
        <div class="stage-wrap hyper-rubix-stage-wrap" id="stageWrap">
          <canvas
            id="stage"
            tabindex="0"
            role="application"
            aria-label="Interactive projected 3 × 3 × 3 × 3 four-dimensional Rubix puzzle with 216 colored hyper-stickers."
            aria-describedby="canvasInstructions liveStatus"
          >
            A projected 3 by 3 by 3 by 3 color puzzle. Choose one of eight cubic boundary cells,
            choose a turn plane, and rotate it by a quarter turn.
          </canvas>

          <div class="hyper-rubix-heading">
            <p id="puzzleOrderHeading" aria-hidden="true">3 × 3 × 3 × 3 / PUZZLE INSTRUMENT</p>
            <h1 id="hyperRubixTitle"><span>hyper</span><b>rubix</b></h1>
            <small aria-hidden="true">eight cubes sharing one impossible skin</small>
          </div>

          <div class="dimension-compass" aria-hidden="true">
            <span data-axis="x"><i></i>X</span>
            <span data-axis="y"><i></i>Y</span>
            <span data-axis="z"><i></i>Z</span>
            <span data-axis="w"><i></i>W</span>
          </div>

          <div class="projection-card" aria-hidden="true">
            <span>PROJECTION</span>
            <b id="projectionReadout">4D → 3D → 2D</b>
            <small id="rotationReadout">XW +24° · YW −18°</small>
          </div>

          <div class="hyper-rubix-view-switch" role="group" aria-label="Canvas drag mode">
            <button type="button" data-drag-mode="orbit" aria-pressed="true">
              <span aria-hidden="true">◎</span><b>Orbit</b><small>XYZ shadow</small>
            </button>
            <button type="button" data-drag-mode="fold" aria-pressed="false">
              <span aria-hidden="true">◇</span><b>Fold W</b><small>fourth axis</small>
            </button>
          </div>

          <div class="stage-meta hyper-rubix-stage-meta" aria-hidden="true">
            <span id="stageReadout">SOLVED · W+ / XY · 216 HYPER-STICKERS</span>
          </div>

          <div class="hyper-rubix-gesture-hint" id="gestureHint" aria-hidden="true">
            DRAG TO ORBIT · SHIFT + DRAG TO FOLD W · SCROLL TO TUNE PROJECTION
          </div>
        </div>
      </section>

      <aside class="panel hyper-rubix-panel" aria-label="Hyper Rubix controls">
        <div class="hyper-rubix-status" aria-label="Puzzle status">
          <div>
            <span>PUZZLE STATE</span>
            <b id="puzzleState">Solved</b>
          </div>
          <div>
            <span>DISORDER</span>
            <b id="disorderState">0%</b>
          </div>
          <div>
            <span>MOVES</span>
            <b id="moveCount">00</b>
          </div>
        </div>

        <details class="group control-section hyper-rubix-control-section" data-section="sequence" open>
          <summary class="group-summary">
            <h2 class="group-title">Shape loop</h2>
            <span class="section-state" id="clockSummary">108 notes · 112 BPM · 1/8</span>
          </summary>
          <div class="group-body">
            <label class="select-control hyper-rubix-method-select" for="sequenceMethod">
              <span class="field-label">Sticker read path</span>
              <span class="select-shell">
                <select id="sequenceMethod" aria-describedby="sequenceMethodHelp">
                  <option value="sticker-stream" selected id="stickerStreamMethodOption">Sticker loop · 216</option>
                  <option id="cornerStreamMethodOption" value="corner-stream">Corner stream · 64</option>
                  <option id="stickerHyperbarMethodOption" value="sticker-hyperbar">Sticker hyperbar · 27</option>
                  <option id="hybridCoilMethodOption" value="hybrid-coil">Hybrid coil · 16 × 27</option>
                  <option value="twist-tape">Twist tape · 16</option>
                </select>
              </span>
              <small id="sequenceMethodHelp">Every sticker sounds once in a fixed forward loop.</small>
            </label>

            <label class="select-control hyper-rubix-preset-select" for="voice">
              <span class="field-label">Instrument preset</span>
              <span class="select-shell">
                <select id="voice" aria-describedby="voiceHelp">
                  <option value="pulse" selected>Hyper kit</option>
                  <option value="glass">Prism kit</option>
                  <option value="dust">Bit kit</option>
                  <option value="webgpu-303">WebGPU 303</option>
                  <option value="rattlesnake">Rattlesnake</option>
                  <option value="shared-simd-chiptune">SIMD Chiptune</option>
                  <option value="shared-simd-303">SIMD 303</option>
                  <option value="shared-simd-synth">SIMD Synth</option>
                  <option value="shared-soft-fm">Soft FM kit</option>
                  <option value="shared-analog">Analog kit</option>
                  <option value="shared-modal">Modal kit</option>
                  <option value="shared-noise">Noise kit</option>
                  <option value="shared-rattlesnake">Rattlesnake · Modal + FM</option>
                  <option value="shared-pitched-morph">Mallets · Pitched Morph</option>
                  <option value="shared-karplus-strong">Karplus Strong · plucked</option>
                  <option value="shared-sine">Sine</option>
                </select>
              </span>
              <small id="voiceHelp">All instruments read the same clocked sticker score. Color keeps each voice identity while shape and topology remap its character.</small>
            </label>

            <label class="select-control hyper-rubix-preset-select hyper-rubix-playback-preset" for="playbackPreset">
              <span class="field-label">Playback preset</span>
              <span class="select-shell">
                <select id="playbackPreset" aria-describedby="playbackPresetHelp">
                  <option value="view-facing" selected>View-facing cells</option>
                  <option value="selected-cell">Selected cell</option>
                  <option value="whole-shape">Whole shape</option>
                </select>
              </span>
              <small id="playbackPresetHelp">Choose which boundary cells enter the clocked score. At size 3, View-facing follows four cells facing the canvas: 108 notes.</small>
            </label>

            <div class="hyper-rubix-playback-scope" id="playbackScopeReadout" role="group" aria-label="Active playback scope">
              <span><b>Active score</b><small id="playbackCells">four view-facing cells</small></span>
              <output id="playbackCount">108 notes</output>
            </div>

            <div class="hyper-rubix-transport" aria-label="Shape-loop transport">
              <button
                class="hyper-rubix-play-button"
                id="playButton"
                type="button"
                aria-pressed="false"
                data-primary-transport
              >
                <svg class="transport-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5 18 12 8 18.5Z" /></svg>
                <svg class="transport-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12" /></svg>
                <span><b id="playLabel">Play shape loop</b><small id="playState">108 view-facing stickers · one note each</small></span>
              </button>
              <button
                class="hyper-rubix-restart-button"
                id="restartLoop"
                type="button"
                aria-label="Restart shape loop at its first sticker"
                title="Restart shape loop at its first sticker"
              ><span aria-hidden="true">↶</span></button>
            </div>

            <div class="hyper-rubix-step-strip" id="stepStrip" role="group" aria-label="Legacy twist playhead" hidden></div>
            <div class="hyper-rubix-now-playing" aria-live="off">
              <span id="sequenceNow">STICKER 001 / 108 · X+</span>
              <span id="sequenceVoice">RED KICK · CORNER · 3 LINKS / 0 FAULTS</span>
            </div>

            <div class="hyper-rubix-hyperbar" id="hyperbarPanel">
              <div class="hyper-rubix-hyperbar-head">
                <span><b id="hyperbarMatrixLabel">216-sticker map</b><small id="hyperbarMatrixSummary">108 notes · four view-facing cells</small></span>
                <output id="hyperbarReadout">STICKER 001 / 108</output>
              </div>
              <div
                class="hyper-rubix-hyperbar-grid"
                id="hyperbarGrid"
                role="grid"
                aria-label="Eight color lanes containing all two hundred sixteen sticker notes; dimmed lanes are outside the active score"
                aria-describedby="hyperbarInstructions"
                aria-rowcount="8"
                aria-colcount="27"
              ></div>
              <p class="sr-only" id="hyperbarInstructions">
                Use the arrow keys to move between sticker notes. Home and End move to the first and last note in a row; hold Control to move to the first or last cell. Press Space or Enter to mute or unmute a sticker.
              </p>
            </div>

            <div class="hyper-rubix-sequence-selects">
              <label class="select-control" for="sequencePattern">
                <span class="field-label">Twist tape</span>
                <span class="select-shell">
                  <select id="sequencePattern" disabled>
                    <option value="axis-break" selected>Axis break</option>
                    <option value="straight-xyz">Straight XYZ</option>
                    <option value="w-pressure">W pressure</option>
                    <option value="random-walk">Random walk</option>
                  </select>
                </span>
              </label>
              <label class="select-control" for="playbackMode">
                <span class="field-label">Read order</span>
                <span class="select-shell">
                  <select id="playbackMode">
                    <option value="forward" selected>Forward</option>
                    <option value="reverse">Reverse</option>
                    <option value="pendulum">Pendulum</option>
                    <option value="random">Random</option>
                  </select>
                </span>
              </label>
              <label class="select-control" for="twistRate">
                <span class="field-label">Pulse rate</span>
                <span class="select-shell">
                  <select id="twistRate" aria-describedby="pulseRateHelp">
                    <option value="1">1/4</option>
                    <option value="2" selected>1/8</option>
                    <option value="4">1/16</option>
                    <option value="8">1/32</option>
                    <option value="16">1/64</option>
                  </select>
                </span>
              </label>
              <label class="select-control" for="twistMotion">
                <span class="field-label">Automated twists</span>
                <span class="select-shell">
                  <select id="twistMotion" aria-describedby="twistMotionHelp" disabled>
                    <option value="auto">Auto · max 4/s</option>
                    <option value="beat">Once per beat</option>
                    <option value="bar">Once per bar</option>
                    <option value="off" selected>Off</option>
                  </select>
                </span>
              </label>
            </div>
            <div class="hyper-rubix-timing-help">
              <small id="pulseRateHelp">Pulse divisions set spacing: 1/4 fires once per quarter-note beat; 1/8 twice, through 1/64 sixteen times.</small>
              <small id="twistMotionHelp">Sticker loop and Corner stream stay still. Hyperbar, Hybrid coil, and Twist tape can apply the selected twist tape automatically.</small>
            </div>

            <div class="hyper-rubix-tempo-row">
              <label class="control" for="tempo">
                <span><b>Tempo</b><output id="tempoOut" for="tempo">112 BPM</output></span>
                <input id="tempo" type="range" min="30" max="300" step="1" value="112" />
              </label>
              <button class="mini-action" id="reseedPattern" type="button" disabled>Reseed</button>
            </div>
            <label class="control" for="swing">
              <span><b>Swing</b><output id="swingOut" for="swing">8%</output></span>
              <input id="swing" type="range" min="0" max="0.42" step="0.01" value="0.08" />
            </label>
            <label class="control" for="twistDensity">
              <span><b>Twist density</b><output id="twistDensityOut" for="twistDensity">100%</output></span>
              <input id="twistDensity" type="range" min="0.25" max="1" step="0.01" value="1" disabled />
              <small>Sets how many optional tape turns remain; the authored rests stay silent.</small>
            </label>
          </div>
        </details>

        <details class="group control-section hyper-rubix-control-section" data-section="twist" open>
          <summary class="group-summary">
            <h2 class="group-title">Twist a cubic cell</h2>
            <span class="section-state" id="twistSummary">W+ · XY plane</span>
          </summary>
          <div class="group-body">
            <label class="select-control" for="puzzleSize">
              <span class="field-label">Size / side</span>
              <span class="select-shell">
                <select id="puzzleSize" aria-describedby="puzzleSizeHelp">
                  <option value="2">2 × 2 × 2 × 2</option>
                  <option value="3" selected>3 × 3 × 3 × 3</option>
                  <option value="4">4 × 4 × 4 × 4</option>
                </select>
              </span>
              <small id="puzzleSizeHelp">3 per axis · 216 stickers · 27 spatial pulses</small>
            </label>
            <div class="hyper-rubix-section-label">
              <span>01</span><b>Boundary cell</b><small>8 faces of the tesseract</small>
            </div>
            <div class="hyper-rubix-face-picker" id="facePicker" role="group" aria-label="Boundary cell">
              <button type="button" data-face="x-" aria-label="X minus, orange low sub" aria-pressed="false"><i></i><b>X−</b><small>orange · sub</small></button>
              <button type="button" data-face="x+" aria-label="X plus, red punch kick" aria-pressed="false"><i></i><b>X+</b><small>red · kick</small></button>
              <button type="button" data-face="y-" aria-label="Y minus, yellow techno snare" aria-pressed="false"><i></i><b>Y−</b><small>yellow · snare</small></button>
              <button type="button" data-face="y+" aria-label="Y plus, white clap" aria-pressed="false"><i></i><b>Y+</b><small>white · clap</small></button>
              <button type="button" data-face="z-" aria-label="Z minus, blue closed hat" aria-pressed="false"><i></i><b>Z−</b><small>blue · closed hat</small></button>
              <button type="button" data-face="z+" aria-label="Z plus, green open hat" aria-pressed="false"><i></i><b>Z+</b><small>green · open hat</small></button>
              <button type="button" data-face="w-" aria-label="W minus, cyan rim click" aria-pressed="false"><i></i><b>W−</b><small>cyan · rim</small></button>
              <button type="button" data-face="w+" aria-label="W plus, violet metal stab" aria-pressed="true"><i></i><b>W+</b><small>violet · stab</small></button>
            </div>

            <div class="hyper-rubix-section-label">
              <span>02</span><b>Turn plane</b><small id="planeHelp">inside the W+ cell</small>
            </div>
            <div class="hyper-rubix-plane-picker" id="planePicker" role="group" aria-label="Turn plane"></div>

            <div class="hyper-rubix-turn-row" aria-label="Quarter turn controls">
              <button id="turnCounterclockwise" type="button" aria-label="Quarter turn counterclockwise">
                <span aria-hidden="true">↶</span><b>−90°</b><small>counter turn</small>
              </button>
              <div class="turn-axis-diagram" aria-hidden="true">
                <span id="turnPlaneDiagram">XY</span>
                <i></i>
                <small id="turnCellDiagram">W+</small>
              </div>
              <button id="turnClockwise" type="button" aria-label="Quarter turn clockwise" data-midi-trigger="step">
                <span aria-hidden="true">↷</span><b>+90°</b><small>quarter turn</small>
              </button>
            </div>

            <div class="hyper-rubix-move-trace" id="moveTrace" aria-label="Move history">
              <span>NO TURNS YET</span>
            </div>

            <div class="hyper-rubix-actions" aria-label="Puzzle actions">
              <button class="mini-action" id="scramblePuzzle" type="button">Scramble 12</button>
              <button class="mini-action" id="undoMove" type="button" disabled>Undo</button>
              <button class="mini-action hyper-rubix-unwind" id="unwindPuzzle" type="button" disabled>Unwind</button>
            </div>
          </div>
        </details>

        <details class="group control-section hyper-rubix-control-section" data-section="hyperspace">
          <summary class="group-summary">
            <h2 class="group-title">Hyperspace</h2>
            <span class="section-state" id="motionSummary">manual projection</span>
          </summary>
          <div class="group-body">
            <button class="hyper-rubix-motion-toggle" id="autoRotate" type="button" aria-pressed="false" hidden>
              <span aria-hidden="true">W</span>
              <span><b>Fourth-axis drift</b><small id="autoRotateState">projection held still</small></span>
              <i aria-hidden="true"></i>
            </button>
            <label class="control" for="rotationSpeed" hidden>
              <span><b>Drift speed</b><output id="rotationSpeedOut" for="rotationSpeed">0.07 rev/min</output></span>
              <input id="rotationSpeed" type="range" min="0" max="0.24" step="0.01" value="0.07" />
            </label>
            <p class="hyper-rubix-control-help">The projection stays still until you touch it. Orbit changes the view-facing score; Fold W changes the fourth-axis mapping. Both remap clocked stickers and create no separate gesture synth while the clock continues.</p>
            <label class="control" for="projectionDepth">
              <span><b>4D projection depth</b><output id="projectionDepthOut" for="projectionDepth">4.2</output></span>
              <input id="projectionDepth" type="range" min="3.4" max="7" step="0.1" value="4.2" />
            </label>
            <label class="control" for="cellSeparation">
              <span><b>Cell separation</b><output id="cellSeparationOut" for="cellSeparation">30%</output></span>
              <input id="cellSeparation" type="range" min="0" max="0.7" step="0.01" value="0.3" />
            </label>
            <label class="control" for="stickerScale">
              <span><b>Hyper-sticker scale</b><output id="stickerScaleOut" for="stickerScale">78%</output></span>
              <input id="stickerScale" type="range" min="0.36" max="1" step="0.01" value="0.78" />
            </label>
            <div class="hyper-rubix-view-actions">
              <button class="mini-action" id="resetView" type="button">Reset view</button>
              <button class="mini-action" id="randomView" type="button">Jump dimension</button>
            </div>
          </div>
        </details>

        <details class="group control-section hyper-rubix-control-section" data-section="sound">
          <summary class="group-summary">
            <h2 class="group-title">Shape mapping</h2>
            <span class="section-state" id="soundSummary">Hyper kit</span>
          </summary>
          <div class="group-body">
            <label class="control" for="tone">
              <span><b>Filter center</b><output id="toneOut" for="tone">64%</output></span>
              <input id="tone" type="range" min="0" max="1" step="0.01" value="0.64" />
            </label>
            <label class="control" for="decay">
              <span><b>Body decay</b><output id="decayOut" for="decay">0.58 s</output></span>
              <input id="decay" type="range" min="0.02" max="4" step="0.01" value="0.58" />
            </label>
            <div class="hyper-rubix-sound-divider" aria-hidden="true"><span>sticker topology</span></div>
            <fieldset class="hyper-rubix-modulation hyper-rubix-topology" aria-describedby="topologyHelp">
              <legend>Neighbor resonator network</legend>
              <p id="topologyHelp">Every sticker can excite one tuned resonator for each real lattice connection. Matching colors reinforce harmonic strings; mixed colors produce detuned fault lines.</p>
              <label class="select-control" for="topologyMode">
                <span class="field-label">Connections heard</span>
                <span class="select-shell">
                  <select id="topologyMode">
                    <option value="mesh" selected>Full neighbor mesh</option>
                    <option value="cohesion">Matching-color lattice</option>
                    <option value="faults">Mixed-color fault lines</option>
                    <option value="off">Off</option>
                  </select>
                </span>
              </label>
              <div class="hyper-rubix-modulation-grid">
                <label class="control" for="topologyLevel">
                  <span><b>Network level</b><output id="topologyLevelOut" for="topologyLevel">22%</output></span>
                  <input id="topologyLevel" type="range" min="0" max="0.8" step="0.01" value="0.22" />
                  <small>Level of the constant-CPU forty-eight-string resonator mesh.</small>
                </label>
                <label class="control" for="topologySpan">
                  <span><b>Interval span</b><output id="topologySpanOut" for="topologySpan">12 st</output></span>
                  <input id="topologySpan" type="range" min="0" max="24" step="0.25" value="12" />
                  <small>Widens axis, color, radial, and displacement intervals over two octaves.</small>
                </label>
                <label class="control" for="topologyStrum">
                  <span><b>Micro-strum</b><output id="topologyStrumOut" for="topologyStrum">18 ms</output></span>
                  <input id="topologyStrum" type="range" min="0" max="0.08" step="0.001" value="0.018" />
                  <small>Spreads the actual neighbor edges through time so they zip around the cell.</small>
                </label>
                <label class="select-control hyper-rubix-decay-link" for="decayLink">
                  <span class="field-label">Tail relationship</span>
                  <span class="select-shell">
                    <select id="decayLink" aria-describedby="decayLinkHelp">
                      <option value="linked" selected>Link body + neighbor tails</option>
                      <option value="independent">Separate neighbor tail</option>
                    </select>
                  </span>
                  <small id="decayLinkHelp">Linked follows Body decay. Separate unlocks an independent melodic neighbor tail.</small>
                </label>
                <label class="control" for="topologyRing">
                  <span><b>Neighbor ring (independent)</b><output id="topologyRingOut" for="topologyRing">0.58 s</output></span>
                  <input id="topologyRing" type="range" min="0.02" max="4" step="0.01" value="0.58" />
                  <small>Sets the melodic tail made by connected stickers when Separate neighbor tail is selected.</small>
                </label>
                <label class="control" for="topologyWarp">
                  <span><b>Cell + W warp</b><output id="topologyWarpOut" for="topologyWarp">100%</output></span>
                  <input id="topologyWarp" type="range" min="0" max="2" step="0.01" value="1" />
                  <small>Exaggerates current-vs-home cell displacement and fourth-axis position.</small>
                </label>
              </div>
            </fieldset>
            <div class="hyper-rubix-sound-divider" aria-hidden="true"><span>rattlesnake preset</span></div>
            <button class="hyper-rubix-rattle-toggle" id="rattleButton" type="button" aria-pressed="false" hidden>
              <span aria-hidden="true">≋</span>
              <span><b id="rattleVoiceLabel">Rattlesnake preset</b><small id="rattleState">off · choose Rattlesnake from Instrument preset</small></span>
              <i aria-hidden="true"></i>
            </button>
            <div class="hyper-rubix-rattle-controls" id="rattlesnakeControls" hidden>
              <label class="control" for="rattleLevel">
                <span><b>Rattle level</b><output id="rattleLevelOut" for="rattleLevel">34%</output></span>
                <input id="rattleLevel" type="range" min="0" max="0.8" step="0.01" value="0.34" />
              </label>
              <label class="select-control" for="rattleRate">
                <span class="field-label">Grain density</span>
                <span class="select-shell">
                  <select id="rattleRate">
                    <option value="2">Loose</option>
                    <option value="4" selected>Dense</option>
                    <option value="8">Swarm</option>
                  </select>
                </span>
              </label>
            </div>
            <fieldset class="hyper-rubix-modulation" aria-describedby="stickerModulationHelp">
              <legend>Sticker modulation</legend>
              <p id="stickerModulationHelp">Set how strongly each projected 4D property shapes the eight color voices. 100% is the intended response; values above it exaggerate the mapping.</p>
              <div class="hyper-rubix-modulation-grid">
                <label class="control" for="pitchInfluence">
                  <span><b>Pitch map</b><output id="pitchInfluenceOut" for="pitchInfluence">72%</output></span>
                  <input id="pitchInfluence" type="range" min="0" max="2" step="0.01" value="0.72" aria-describedby="pitchInfluenceHelp" />
                  <small id="pitchInfluenceHelp">XYZW position and boundary plane tune each sticker voice.</small>
                </label>
                <label class="control" for="filterInfluence">
                  <span><b>Filter motion</b><output id="filterInfluenceOut" for="filterInfluence">72%</output></span>
                  <input id="filterInfluence" type="range" min="0" max="2" step="0.01" value="0.72" aria-describedby="filterInfluenceHelp" />
                  <small id="filterInfluenceHelp">Projected angle and height move cutoff and resonance.</small>
                </label>
                <label class="control" for="stereoInfluence">
                  <span><b>Stereo spread</b><output id="stereoInfluenceOut" for="stereoInfluence">72%</output></span>
                  <input id="stereoInfluence" type="range" min="0" max="2" step="0.01" value="0.72" aria-describedby="stereoInfluenceHelp" />
                  <small id="stereoInfluenceHelp">Projected horizontal position places the sound from left to right.</small>
                </label>
                <label class="control" for="neighborResponse">
                  <span><b>Neighbor response</b><output id="neighborResponseOut" for="neighborResponse">100%</output></span>
                  <input id="neighborResponse" type="range" min="0" max="2" step="0.01" value="1" aria-describedby="neighborResponseHelp" />
                  <small id="neighborResponseHelp">Matching neighbors add resonance and tail; mixed neighbors add drive and noise.</small>
                </label>
                <label class="control" for="wInfluence">
                  <span><b>W-depth</b><output id="wInfluenceOut" for="wInfluence">72%</output></span>
                  <input id="wInfluence" type="range" min="0" max="2" step="0.01" value="0.72" aria-describedby="wInfluenceHelp" />
                  <small id="wInfluenceHelp">Near-W stickers sound brighter and shorter; far-W stickers darker and longer.</small>
                </label>
                <label class="control" for="disorderInfluence">
                  <span><b>Disorder response</b><output id="disorderInfluenceOut" for="disorderInfluence">60%</output></span>
                  <input id="disorderInfluence" type="range" min="0" max="2" step="0.01" value="0.6" aria-describedby="disorderInfluenceHelp" />
                  <small id="disorderInfluenceHelp">Scrambling adds detune, filter motion, drive, and rattle.</small>
                </label>
              </div>
            </fieldset>
            <p class="hyper-rubix-sound-note">Each instrument reads the active playback scope. Color keeps a recognizable voice identity; projected XYZW position, neighbor cohesion, fault lines, radial class, displacement, and disorder continuously reshape it. Orbit and Fold W remap clocked stickers and create no separate gesture synth. A manual quarter-turn changes both the immediate audition and every later visit to the moved stickers.</p>
            <p class="audio-error" id="audioError" role="alert" hidden></p>
          </div>
        </details>

        <details class="group control-section hyper-rubix-control-section" data-section="guide">
          <summary class="group-summary">
            <h2 class="group-title">What is 4D here?</h2>
            <span class="section-state">geometry note</span>
          </summary>
          <div class="group-body hyper-rubix-guide">
            <p id="puzzleGeometryGuide">A tesseract has eight cubic boundary cells. Each one carries a 3 × 3 × 3 field of color, so this order-3 puzzle has 216 stickers.</p>
            <p id="hyperbarGeometryGuide">The matrix lays out all eight colored boundary cells across 27 spatial addresses. By default, four view-facing cells form a 108-note score; rows outside that score are dimmed, not removed.</p>
            <p id="streamGeometryGuide">Time is the single bright cursor moving through the active score. View-facing playback has 32 notes at size 2, 108 at size 3, and 256 at size 4. For Whole shape, size 2 has 64 notes, size 3 has 216, and size 4 has 512. Orbit, Fold W, and quarter-turns remap the running score without resetting its place or adding a separate gesture synth.</p>
            <p>A turn rotates one cubic cell through one of its three internal coordinate planes. The screen shows a perspective projection from 4D to 3D, then from 3D to your display.</p>
          </div>
        </details>

        <div class="reset-all-row">
          <button class="reset-all-button" id="resetAll" type="button" data-reset-all data-reset-in-place>Reset puzzle + parameters</button>
        </div>
      </aside>

      <p class="sr-only" id="canvasInstructions">
        Drag to orbit the three-dimensional shadow. Choose Fold W or hold Shift while dragging to
        rotate the puzzle through the fourth dimension. Arrow keys orbit; Shift plus an arrow folds
        through W; W switches drag mode, and Backspace undoes the last turn. Use the cell and plane buttons to select a
        cubic boundary cell and one of its three legal turn planes, then use the minus or plus
        ninety-degree buttons. Press Enter on the canvas for a clockwise turn. Press Space to play
        or pause the shape loop. <span id="restartInstructions">Press R to restart the shape loop
        at its first sticker.</span> <span id="serializationInstructions">The default loop visits 108
        stickers across four view-facing cells in a stable forward order; Whole shape visits all 216.
        One bright cursor shows time.</span> The clock
        never turns the puzzle automatically.
      </p>
      <p class="sr-only" id="liveStatus" aria-live="polite"></p>
    </main>
</div>
`;

export const RUBIXOIDS_VIEWS = Object.freeze({

  "2d": Object.freeze({
    id: "sliding-puzzle",
    label: "Sliding puzzle",
    pageClass: "sliding-puzzle-page",
    markup: slidingPuzzleMarkup,
    styles: Object.freeze([
      "/style.css",
      "/src/instruments/rubixoids/sliding-puzzle/sliding-puzzle.css",
      "/src/instruments/rubixoids/native-appearance.css",
      "/src/instruments/rubixoids/integrated-views.css",
    ]),
  }),

  "3d": Object.freeze({
    id: "rubix",
    label: "Rubix cube",
    pageClass: "rubix-page",
    markup: rubixMarkup,
    styles: Object.freeze([
      "/style.css",
      "/src/instruments/rubixoids/rubix/rubix.css",
      "/src/instruments/rubixoids/native-appearance.css",
      "/src/instruments/rubixoids/integrated-views.css",
    ]),
  }),

  "4d": Object.freeze({
    id: "hyper-rubix",
    label: "Hyper Rubix",
    pageClass: "hyper-rubix-page",
    markup: hyperRubixMarkup,
    styles: Object.freeze([
      "/style.css",
      "/src/instruments/rubixoids/hyper-rubix/hyper-rubix.css",
      "/src/instruments/rubixoids/native-appearance.css",
      "/src/instruments/rubixoids/integrated-views.css",
    ]),
  }),

});
