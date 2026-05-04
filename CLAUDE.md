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
7. **Drafts (localStorage)** — `loadDrafts`, `persistDrafts`, `draftPreview`, `formatRelativeTime`, `DraftsPanel`. Drafts are stored under the key `linkedin-formatter:drafts` as a JSON array of `{ id, content, savedAt }`. The panel is reachable from the toolbar (bookmark icon) and renders inside the same `BottomSheet` used by the emoji/symbol pickers.
8. **App shell** — header, mounts `Editor`, renders to `#root`.

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

We deliberately do **not** pass emoji-mart's `onClickOutside` callback — its handler is registered on `document` and persists past `removeChild` on unmount, which fires `onClose` on the next click and prevents reopening. Outside-click is handled solely by the Editor's `mousedown` `useEffect` (which checks `popoverRef.current.contains(target)` — works whether the popover is anchored on desktop or portaled on mobile).

## Symbol picker

`SYMBOL_BLOCKS` is an array of `{ name, chars }` for 8 Unicode blocks (Icons/Dingbats, Arrows, Shapes, Currency, Misc Tech, Math, Math+, Misc Math A+B). `blockChars(start, end)` iterates the codepoint range and filters via `\p{Assigned}` — drops reserved/unassigned positions so the grid never shows tofu. `SymbolPicker` renders tabs across the top + a horizontally-bound, vertically-scrolling grid (12 cols desktop, 9 cols mobile). Tooltips show `U+xxxx` on each char button.

## Responsive layout

Split point: Tailwind `md` breakpoint (768px). `useIsMobile` (matchMedia hook) returns true below.

**Desktop (≥ 768px):** two-row toolbar at the top of the editor card; popovers (Emoji, Symbols) render as absolutely-positioned anchored elements via `BottomSheet`'s desktop branch; char count visible; Copy is a labelled button ("Copy text").

**Mobile (< 768px):** no toolbar in the card. A second toolbar is `position: fixed; bottom: 0` — single row, horizontal scroll (scrollbar hidden), with Copy as an icon-only button pinned to the right outside the scroll area. The page itself uses `h-dvh` (exact dynamic viewport height) with the App outer div padded `pb-14` to leave room for the sticky toolbar — so the layout fits exactly within the visible viewport with no scroll bar. Editor card grows via `flex-1` so the textarea fills space between header and footer. Touch targets 44×44 (`h-11 w-11`); on `md+` they revert to 36×36.

**Bottom sheets (mobile only):** `BottomSheet` is a forwardRef component used uniformly by both pickers. On mobile it portals (`ReactDOM.createPortal`) a backdrop + slide-up sheet to `document.body`, sitting above the bottom toolbar (sheet `bottom: 56px` so toolbar stays visible). On desktop it renders the original anchored popover. The sheet's slide-up animation is a CSS keyframe in `index.html` (`@keyframes slide-up`).

**emoji-mart in the sheet:** the picker is constructed with `dynamicWidth: true` so its `perLine` adapts to the sheet's width (otherwise it stays at the default ~360px regardless of how wide the container is). To make it fit *vertically* inside the sheet, three things are needed together (any one missing and the picker grows to its full content height of ~3800px):
1. The `EmojiPicker`'s container div is `flex flex-col` on mobile.
2. The `<em-emoji-picker>` element gets `flex: 1; min-height: 0; overflow: hidden` via the `@media (max-width: 767px)` block in `index.html` — `min-height: 0` is critical because emoji-mart sets an internal `min-height: 230px` that otherwise overrides `max-height: 100%`.
3. On desktop the same container is `md:w-[360px] md:h-[360px]` so `dynamicWidth: true` has a defined size to compute against (without explicit dimensions, auto-width collapses).

Outside-click closing works for both layouts via the same Editor `useEffect` (checks `popoverRef.current.contains(target)`). On mobile, taps on the backdrop are not contained in the sheet ref, so the same logic closes the popover (the backdrop also has its own `onMouseDown=onClose`, which is redundant but harmless — both call `setOpen(false)`).

## Working on this code

- **Don't add a build step.** No npm/yarn/pnpm, no Vite/Parcel/Webpack, no JSX compile. The whole point is that `index.html` + `app.js` deploys anywhere with no toolchain.
- **Don't add dependencies.** Add new functionality in plain JS. If a third-party library is genuinely required, prefer one that ships a UMD bundle on a CDN (jsDelivr / unpkg) and add it as another `<script>` in `index.html`.
- **No JSX.** Use the htm template literal: ``html`<${Component} prop=${value}>...<//>``. Components mount with `<${Foo}>` and close with `<//>`. Attribute names follow React conventions (`className`, `onClick`, `strokeWidth` not `stroke-width`).
- **Tailwind classes** are JIT-compiled by the Play CDN at runtime. Any standard Tailwind class works.
- **Keep the IIFE.** The whole `app.js` is wrapped in `(function () { "use strict"; ... })()` to avoid leaking globals.

## Debug data and scratch files

Don't drop debug artifacts in the project root. Conventional locations:

- **Playwright screenshots, snapshots, and console logs** — auto-saved under `.playwright-mcp/` (already gitignored). When taking screenshots via `mcp__playwright__browser_take_screenshot`, pass a relative `filename` like `repro-portrait.png`; Playwright places it under `.playwright-mcp/`. Don't pass an absolute path that would land it elsewhere.
- **One-off scratch tests** (e.g. extracting `BASES` to verify formatting in node) — write to `/tmp/`, e.g. `/tmp/engine_test.mjs`. Don't commit.
- **User-provided screenshots/files for review** (e.g. `/mnt/d/shot1.png`) — read directly from the path the user gave. No need to copy into the project.
- **Persistent test fixtures** — would go under `tests/` if the project ever gets a real test suite. Currently it has none.

If you find a one-off `.png`, `.log`, or scratch script in the project root after a debug session, move or delete it before committing.

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

After touching responsive code, also verify:
- Resize the browser across the 768px boundary and confirm the toolbar swaps location (top vs bottom) and the picker layouts swap (anchored vs sheet).
- On mobile, tap Emoji/Symbol — sheet should slide up, sit above the bottom toolbar (toolbar stays visible), and dismiss via backdrop tap or Escape.
- On mobile, the Copy button stays pinned to the right edge of the toolbar regardless of horizontal scroll.
