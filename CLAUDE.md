# CLAUDE.md

Notes for Claude when working on this codebase.

## Architecture

Two files, no build step:

- `index.html` — page shell. Loads Tailwind, React 18 UMD, htm, and emoji-mart from CDNs, plus `app.js`.
- `app.js` — everything else, as a single IIFE. React + htm template literals (no JSX, no compile step).

Globals from CDN scripts that `app.js` relies on: `React`, `ReactDOM`, `htm`, `EmojiMart`. Tailwind Play CDN scans the rendered DOM at runtime, so any Tailwind class works without configuration.

The page deploys by copying the two files to any static-web-server subpath. The `<script src="app.js">` is intentionally relative (no leading slash) so subpath deployment works.

## Code layout (`app.js`)

The IIFE is organized in numbered sections:

1. **Unicode formatting engine** — `BASES`, `STYLED_TO_PLAIN`, `VARIANT_TO_TYPESTYLE`, `TYPESTYLE_TO_VARIANT`, `variantChar`, `applyVariant`, `applyDecoration`, `stripVariant`, `stripDecorations`, `stripAllFormatting`, `detectStyle`, `applyFormatting`, `toggleStyle`.
2. **List formatting** — `detectListType`, `stripListMarkers`, `toggleList`.
3. **Lucide icons** — inline SVG paths in `ICON_PATHS` + `Icon` component.
4. **Emoji picker** — thin `EmojiPicker` wrapper around `EmojiMart.Picker` (custom element).
5. **Toolbar primitives** — `ToolButton` (forwardRef), `ToolGroup`, `Divider`.
6. **Editor** — main component. State: `value`, `emojiOpen`, `copied`, `history`, `historyIndex`. Selection-aware transforms via `transformSelection` and `transformLineRange`.
7. **App shell** — header, mounts `Editor`, renders to `#root`.

## Formatting model

A formatted string is the composition of a **type style** (a Unicode block) and zero or more **decorations** (combining diacritics).

- **Type styles** (toolbar produces these):
  - `bs` Bold Sans, `is` Italic Sans, `bis` Bold Italic Sans, `m` Monospace — plain math-alphanumeric blocks.
  - `c` Script (regular), `bc` Bold Script — script blocks; `c` has reserved holes filled by Letterlike Symbols (ℬ ℰ ℱ ℋ ℐ ℒ ℳ ℛ uppercase; ℯ ℊ ℴ lowercase).
  - `f` Fraktur — uppercase exceptions ℭ ℌ ℑ ℜ ℨ.
  - `d` Double-struck — uppercase exceptions ℂ ℍ ℕ ℙ ℚ ℝ ℤ; full digits.
  - `fw` Fullwidth (Ａ-ｚ, ０-９) — fully contiguous.
  - `ci` Circled (Ⓐ-ⓩ) — digits non-contiguous: ⓪ at U+24EA, ①–⑨ at U+2460+. Handled via `digitFn`.
- **Per-letter exceptions** live in `BASES[v].upperEx` / `lowerEx`. Variants without a contiguous digit block use `BASES[v].digitFn(digit)`.
- **Legacy variants** (`b`, `i`, `bi`, `s` — serif blocks) are reverse-mapped for detection of pasted text only; not produced by the toolbar.
- **Decorations**: underline (U+0332) and strikethrough (U+0336) — combining marks appended after each character.

### Toggle layer (flat type-style model)

`detectStyle` returns `{ typeStyle, underline, strike }` where `typeStyle ∈ {null, "bold", "italic", "boldItalic", "script", "monospace"}`. `toggleStyle` enforces two mutually-exclusive groups:

- **Type-style group** (Bold, Italic, Bold Italic, Script, Monospace): clicking the active one clears it; clicking a different one replaces. No composition — `Ctrl+B` on italic text replaces italic with bold (it does not produce bold-italic). Bold Italic has its own dedicated button.
- **Decoration group** (Underline, Strike): same rule within the group — clicking Strike on underlined text replaces underline with strike. Type style and decoration freely combine across groups (e.g. Bold + Underline).

`applyFormatting` looks up the variant from `TYPESTYLE_TO_VARIANT[typeStyle]`. Legacy serif blocks (b/i/bi, U+1D400/1D434/1D468) fold into bold/italic/boldItalic for detection of pasted text but the toolbar only produces the sans-serif modern set.

### The EN QUAD space rule (rendering-only fallback)

Combining marks anchor poorly on plain ASCII glyphs and don't render visibly across regular spaces. So:

- If only underline/strike is requested (no type style chosen), `applyFormatting` silently uses Monospace as a carrier. This is a pure rendering detail — `toggleStyle` and `detectStyle` operate on the user-facing model and don't reason about it. **Caveat:** because the carrier becomes part of the buffer, toggling underline/strike off afterwards leaves you in monospace, not plain — the auto-mono is a one-way trip until the user explicitly clicks Mono off or uses Erase.
- When the active variant is Monospace AND underline/strike is on, `U+0020` is replaced with `U+2000` (EN QUAD) so the line/strike continues across spaces.
- Other math-block variants (bold, italic, script) anchor combining marks fine on regular spaces — no swap.
- `stripAllFormatting` normalises EN QUAD back to a regular space so round-trips stay clean.

### Italic 'h' exception

There is no math italic codepoint for lowercase `h` — it maps to ℎ (U+210E). Both `variantChar` and `STYLED_TO_PLAIN` handle it.

## List formatting

Lists are encoded in the textarea as plain text:

- Bullet line: `  • <text>` (two NBSPs, bullet, space, text).
- Numbered line: `  N. <text>` (numbers restart from 1 each apply).

Blank lines are preserved verbatim and (for numbered) don't increment the counter. List buttons in the toolbar expand the selection to whole-line boundaries via `transformLineRange` before invoking `toggleList`.

## Editor state

- **History**: array of `{value, selection}` snapshots, capped at `HISTORY_LIMIT`. Typing pushes are debounced (`HISTORY_DEBOUNCE_MS`); toolbar actions push immediately. Undo/Redo flush any pending debounce first via `flushPending`.
- **Selection restore**: after any value mutation, `setSelectionAfterRender` re-applies the selection in a `requestAnimationFrame` so React's render lands first.
- **Selection-empty rule**: clicking a format button with no selection applies the transform to the entire text. Lists always expand to line boundaries.

## Emoji picker

Uses the emoji-mart web component (`<em-emoji-picker>` custom element). The dataset is fetched lazily from `cdn.jsdelivr.net/npm/@emoji-mart/data` and cached in module-scope `emojiDataPromise`.

The popover is positioned absolutely below the emoji button. Two outside-click handlers are wired:
- emoji-mart's own `onClickOutside` callback.
- A `mousedown` listener on `document` from the Editor.

Both close the popover; either is enough.

## Working on this code

- **Don't add a build step.** No npm/yarn/pnpm, no Vite/Parcel/Webpack, no JSX compile. The whole point is that `index.html` + `app.js` deploys anywhere with no toolchain.
- **Don't add dependencies.** Add new functionality in plain JS. If a third-party library is genuinely required, prefer one that ships a UMD bundle on a CDN (jsDelivr / unpkg) and add it as another `<script>` in `index.html`.
- **No JSX.** Use the htm template literal: ``html`<${Component} prop=${value}>...<//>``. Components mount with `<${Foo}>` and close with `<//>`. Attribute names follow React conventions (`className`, `onClick`, `strokeWidth` not `stroke-width`).
- **Tailwind classes** are JIT-compiled by the Play CDN at runtime. Any standard Tailwind class works.
- **Keep the IIFE.** The whole `app.js` is wrapped in `(function () { "use strict"; ... })()` to avoid leaking globals.

## Manual testing

```sh
python3 -m http.server 8123
# then open http://localhost:8123/index.html
```

Useful sanity checks after touching the formatting engine:
- Type text, select all, click each toolbar button — verify the output is what you expect.
- Switch between Bold → Italic → Bold Italic → Script → Monospace and back; each click should replace the previous type style cleanly (no stacking, no residue).
- Click the active type-style button — it should clear and return to plain.
- Apply Bold, then Underline; switch to Script — underline should survive the type-style change.
- Apply Strikethrough alone and Strikethrough + Bold; both should render visibly across spaces.
- Apply Erase formatting on a styled selection and verify it returns to plain ASCII (including spaces — no leftover EN QUAD).
- Apply a list, then toggle the same list type — markers should be stripped.
- Switch from Bullet to Numbered directly — should not leave residue.
