# Morphazoid design system

Morphazoid's design system is a framework-free collection of CSS tokens,
native HTML patterns, and small DOM factories. Storybook documents the same
modules that production pages use; stories are not a second implementation of
the interface.

## Layers

- **Foundations** define color, typography, spacing, borders, focus, motion, and
  control-size tokens.
- **Primitives** create native buttons, range fields, select fields, choice
  switches, and disclosure sections.
- **Patterns** compose primitives into audio transports, instrument headers,
  control panels, status displays, and navigation. The masthead audio strip and
  amplitude envelope editor are exported through `src/ui/patterns/index.js`.
- **Themes** map the shared semantic tokens to a product surface. The primary
  instruments and Morphazoidical may keep distinct visual themes while sharing
  interaction and accessibility contracts.
- **Instrument UI** stays with its instrument when it represents domain
  behavior, such as a tract editor, sequencer, shader graph, or Canvas stage.

## Component contract

Reusable controls:

1. Render native, accessible HTML before adding ARIA roles.
2. Receive state through options or native element properties.
3. Report interaction through native `input`, `change`, and `click` events.
4. Keep Web Audio, MIDI, microphone access, simulation state, and Canvas
   rendering outside the component.
5. Accept an explicit `document` object so they can render in Storybook and in
   lightweight unit tests without owning global application state.
6. Use `mz-` names for the public design-system surface. Existing Morphazoid
   class names can remain as migration aliases until their pages are converted.

## Using the components

Load `src/ui/index.css` once at the application stylesheet boundary, then import
only the JavaScript factories a page uses:

```js
import { createRangeField } from "./src/ui/index.js";

const frequency = createRangeField({
  id: "base-frequency",
  label: "Base frequency",
  min: 20,
  max: 440,
  value: 110,
  formatValue: (value) => `${Math.round(value)} Hz`,
  onInput: (value) => instrument.setBaseFrequency(value),
});

controls.append(frequency);
```

Factories return their native root element, augmented with useful references
and small state methods such as `input`, `output`, `setValue`, `setDisabled`,
and `destroy`. Patterns with heavier dependencies have their own entry points;
for example, the amplitude editor is exported by `src/ui/patterns/index.js` so
importing a basic field does not also load its audio-envelope math.

Button variants deliberately mirror recurring production roles: `mini` for
compact local actions, `reset` for the full-width panel reset, `play` for the
circular transport, and `audio` for the square speaker switch. `default`
remains a generic button and is not an alias for the smaller `mini-action`.
Pass `toggle: false` to a play button used as a one-shot trigger.

`createAudioStrip()` composes the production audio switch and master-level
range without creating an `AudioContext`. Applications own the engine and feed
its lifecycle back through `setAudioState()`.

## Story organization

Stories are grouped from general to specific:

```text
Foundations/
Primitives/
Patterns/
Instruments/
```

Every interactive primitive should cover its default, active, disabled,
boundary-value, long-label, and error states where those states apply. Audio,
MIDI, and microphone stories use deterministic visual state rather than asking
for hardware or browser permissions.

## Development

Run the component workshop with:

```sh
npm run storybook
```

Create the static component catalog with:

```sh
npm run build:storybook
```

Build the complete deployable site, including the catalog at `/storybook/`,
with:

```sh
npm run build:deploy
```

Storybook's development server and Vite are development/build tools only. The
generated catalog is static HTML, CSS, and JavaScript and does not require a
Node or server-rendered application at runtime. GitHub Pages and AWS CI builds
use `build:deploy`, which keeps Storybook authoring files out of the normal site
copy and adds only the generated catalog under `dist/storybook/`.

The AWS distribution keeps `X-Frame-Options: DENY` for the application and uses
a dedicated `/storybook/*` behavior with `SAMEORIGIN` plus
`frame-ancestors 'self'`, allowing only Storybook's own same-origin preview
frame. After this behavior is introduced or changed, apply `infra/site.yml`
once with the infrastructure bootstrap script; the regular CI role deploys
site content but intentionally cannot modify CloudFormation.

## Migration rule

Extract a component only when it has at least two real consumers or represents
a project-wide contract. Migrate one page family at a time, retaining legacy
selectors until the family passes the existing Node, Playwright, responsive,
and accessibility checks.

The geometric-physics page family is the first migrated consumer. Shared
audio, play, mini-action, reset, and choice-switch styling now resolves through
the component layer while legacy page class names remain valid. Good next
families are the repeated FM drum fields and static panel-section markup.
Canvas editors, sequencers, and synthesis engines should stay instrument-owned
and compose these primitives at their edges.
