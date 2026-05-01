// LinkedIn Post Formatter — single-file React app loaded from CDN.
// React + ReactDOM + htm + emoji-mart all come in via <script> tags in index.html.

(function () {
  "use strict";

  const { useState, useEffect, useRef, useMemo, useCallback, forwardRef } = React;
  const html = htm.bind(React.createElement);

  // ────────────────────────────────────────────────────────────────────────────
  // Unicode formatting engine
  // ────────────────────────────────────────────────────────────────────────────

  // Block bases for uppercase A, lowercase a, digit 0 in each variant.
  // upperEx/lowerEx hold per-letter overrides (Unicode reserves several script,
  // fraktur, and double-struck math codepoints — the canonical glyph lives in
  // the Letterlike Symbols block instead). digitFn handles non-contiguous digit
  // sets (circled: 0 at U+24EA, 1–9 at U+2460+).
  const BASES = {
    // Modern set produced by the toolbar.
    bs:  { upper: 0x1d5d4, lower: 0x1d5ee, digit: 0x1d7ec },
    is:  { upper: 0x1d608, lower: 0x1d622, digit: null    },
    bis: { upper: 0x1d63c, lower: 0x1d656, digit: null    },
    c: { // Script (regular)
      upper: 0x1d49c, lower: 0x1d4b6, digit: null,
      upperEx: { B: "ℬ", E: "ℰ", F: "ℱ", H: "ℋ", I: "ℐ", L: "ℒ", M: "ℳ", R: "ℛ" },
      lowerEx: { e: "ℯ", g: "ℊ", o: "ℴ" },
    },
    bc:  { upper: 0x1d4d0, lower: 0x1d4ea, digit: null    }, // Bold Script
    f: { // Fraktur
      upper: 0x1d504, lower: 0x1d51e, digit: null,
      upperEx: { C: "ℭ", H: "ℌ", I: "ℑ", R: "ℜ", Z: "ℨ" },
    },
    d: { // Double-struck (Blackboard bold)
      upper: 0x1d538, lower: 0x1d552, digit: 0x1d7d8,
      upperEx: { C: "ℂ", H: "ℍ", N: "ℕ", P: "ℙ", Q: "ℚ", R: "ℝ", Z: "ℤ" },
    },
    fw: { upper: 0xff21, lower: 0xff41, digit: 0xff10 }, // Fullwidth
    ci: { // Circled
      upper: 0x24b6, lower: 0x24d0, digit: null,
      digitFn: (d) => d === 0 ? "⓪" : String.fromCodePoint(0x2460 + d - 1),
    },
    m:   { upper: 0x1d670, lower: 0x1d68a, digit: 0x1d7f6 },

    // Legacy serif blocks — only for detecting pasted text; not produced.
    b:   { upper: 0x1d400, lower: 0x1d41a, digit: 0x1d7ce },
    i:   { upper: 0x1d434, lower: 0x1d44e, digit: null    },
    bi:  { upper: 0x1d468, lower: 0x1d482, digit: null    },
    s:   { upper: 0x1d5a0, lower: 0x1d5ba, digit: 0x1d7e2 },
  };

  // italic h has no math italic codepoint — uses ℎ (U+210E)
  const ITALIC_EXCEPTIONS = { h: "ℎ" };

  const CP_A_UP = "A".codePointAt(0);
  const CP_A_LO = "a".codePointAt(0);
  const CP_ZERO = "0".codePointAt(0);

  const COMB_UNDERLINE = "̲";
  const COMB_STRIKE    = "̶";

  // Reverse lookup: styled codepoint -> { plain, variant }
  const STYLED_TO_PLAIN = new Map();
  for (const v of Object.keys(BASES)) {
    const b = BASES[v];
    for (let i = 0; i < 26; i++) {
      const upPlain = String.fromCodePoint(CP_A_UP + i);
      const loPlain = String.fromCodePoint(CP_A_LO + i);
      const upStyled = (b.upperEx && b.upperEx[upPlain]) || String.fromCodePoint(b.upper + i);
      const loStyled = (b.lowerEx && b.lowerEx[loPlain]) || String.fromCodePoint(b.lower + i);
      STYLED_TO_PLAIN.set(upStyled.codePointAt(0), { plain: upPlain, variant: v });
      STYLED_TO_PLAIN.set(loStyled.codePointAt(0), { plain: loPlain, variant: v });
    }
    for (let i = 0; i < 10; i++) {
      let styled = null;
      if (b.digitFn) styled = b.digitFn(i);
      else if (b.digit !== null) styled = String.fromCodePoint(b.digit + i);
      if (styled) STYLED_TO_PLAIN.set(styled.codePointAt(0), { plain: String.fromCodePoint(CP_ZERO + i), variant: v });
    }
  }
  STYLED_TO_PLAIN.set(0x210e, { plain: "h", variant: "i" });

  function variantChar(ch, variant) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) return ch;
    const base = BASES[variant];
    if (!base) return ch;
    if (variant === "i" && ITALIC_EXCEPTIONS[ch]) return ITALIC_EXCEPTIONS[ch];
    if (cp >= CP_A_UP && cp <= CP_A_UP + 25) {
      if (base.upperEx && base.upperEx[ch]) return base.upperEx[ch];
      return String.fromCodePoint(base.upper + (cp - CP_A_UP));
    }
    if (cp >= CP_A_LO && cp <= CP_A_LO + 25) {
      if (base.lowerEx && base.lowerEx[ch]) return base.lowerEx[ch];
      return String.fromCodePoint(base.lower + (cp - CP_A_LO));
    }
    if (cp >= CP_ZERO && cp <= CP_ZERO + 9) {
      if (base.digitFn) return base.digitFn(cp - CP_ZERO);
      if (base.digit !== null) return String.fromCodePoint(base.digit + (cp - CP_ZERO));
    }
    return ch;
  }

  function stripVariant(text) {
    let out = "";
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      const found = STYLED_TO_PLAIN.get(cp);
      out += found ? found.plain : ch;
    }
    return out;
  }

  function stripDecorations(text) {
    return text.replace(/[̶̲]/g, "");
  }

  function stripAllFormatting(text) {
    // Also normalise EN QUAD (U+2000) back to regular space — we use it as a
    // wider space when applying underline/strike to plain text so the combining
    // mark has something to render on.
    return stripDecorations(stripVariant(text)).replace(/ /g, " ");
  }

  function applyVariant(text, variant) {
    const plain = stripVariant(text);
    let out = "";
    for (const ch of plain) out += variantChar(ch, variant);
    return out;
  }

  function applyDecoration(text, decoration) {
    const mark = decoration === "underline" ? COMB_UNDERLINE : COMB_STRIKE;
    let out = "";
    for (const ch of text) {
      out += ch;
      const cp = ch.codePointAt(0);
      if (cp >= 0x0300 && cp <= 0x036f) continue; // skip combining marks
      if (ch === "\n" || ch === "\r") continue;
      out += mark;
    }
    return out;
  }

  // Map BASES variants to user-facing type-style names. The toolbar produces
  // only the modern set (bs/is/bis/bc/m); legacy serif blocks (b/i/bi) fold in
  // for detection of pasted text. 's' (sans-regular) is visually plain — null.
  const VARIANT_TO_TYPESTYLE = {
    bs: "bold",        b:  "bold",
    is: "italic",      i:  "italic",
    bis: "boldItalic", bi: "boldItalic",
    c:  "script",
    bc: "boldScript",
    f:  "fraktur",
    d:  "doubleStruck",
    fw: "fullwidth",
    ci: "circled",
    m:  "monospace",
  };

  const TYPESTYLE_TO_VARIANT = {
    bold:         "bs",
    italic:       "is",
    boldItalic:   "bis",
    script:       "c",
    boldScript:   "bc",
    fraktur:      "f",
    doubleStruck: "d",
    fullwidth:    "fw",
    circled:      "ci",
    monospace:    "m",
  };

  function detectStyle(text) {
    let total = 0, underline = 0, strike = 0;
    const typeCounts = {};
    let prevFormattable = false;
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp === 0x0332) { if (prevFormattable) underline++; continue; }
      if (cp === 0x0336) { if (prevFormattable) strike++; continue; }
      const styled = STYLED_TO_PLAIN.get(cp);
      const isPlain = /[A-Za-z0-9]/.test(ch);
      if (isPlain || styled) {
        total++;
        prevFormattable = true;
        const ts = styled ? VARIANT_TO_TYPESTYLE[styled.variant] : null;
        if (ts) typeCounts[ts] = (typeCounts[ts] || 0) + 1;
      } else {
        prevFormattable = false;
      }
    }
    if (total === 0) {
      return { typeStyle: null, underline: false, strike: false };
    }
    let typeStyle = null;
    for (const ts of Object.keys(typeCounts)) {
      if (typeCounts[ts] === total) { typeStyle = ts; break; }
    }
    return {
      typeStyle,
      underline: underline > 0 && underline >= Math.floor(total * 0.5),
      strike:    strike    > 0 && strike    >= Math.floor(total * 0.5),
    };
  }

  function applyFormatting(text, opts) {
    let result = stripAllFormatting(text);
    let variant = opts.typeStyle ? TYPESTYLE_TO_VARIANT[opts.typeStyle] : null;
    // Combining underline/strike anchors poorly on plain ASCII — when only a
    // decoration is requested, fall back to Monospace as a carrier. Pure
    // rendering detail; toggleStyle/detectStyle never expose it.
    if (!variant && (opts.underline || opts.strike)) variant = "m";

    if (variant) result = applyVariant(result, variant);

    // Monospace + underline/strike: regular spaces don't carry the combining
    // mark visibly. Swap to EN QUAD (U+2000) so the line/strike continues
    // across word breaks. Other math-block variants anchor the mark fine on
    // regular spaces.
    if ((opts.underline || opts.strike) && variant === "m") {
      result = result.replace(/ /g, " ");
    }

    if (opts.underline) result = applyDecoration(result, "underline");
    if (opts.strike)    result = applyDecoration(result, "strike");
    return result;
  }

  // Type styles (bold, italic, boldItalic, script, monospace) are mutually
  // exclusive within their group; same for decorations (underline, strike).
  // Type style + decoration freely combine (e.g. bold + underline).
  // In each group: clicking the active button clears, clicking a different
  // one replaces.
  function toggleStyle(text, style) {
    const current = detectStyle(text);
    const next = { ...current };
    if (style === "underline" || style === "strike") {
      if (current[style]) {
        next[style] = false;
      } else {
        next.underline = style === "underline";
        next.strike    = style === "strike";
      }
    } else {
      next.typeStyle = current.typeStyle === style ? null : style;
    }
    return applyFormatting(text, next);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // List formatting
  // ────────────────────────────────────────────────────────────────────────────

  const NBSP2 = "  ";
  const RX_BULLET   = /^(  )?•\s/;
  const RX_NUMBERED = /^(  )?\d+\.\s/;

  function detectListType(text) {
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      if (RX_BULLET.test(line))   return "BULLETED";
      if (RX_NUMBERED.test(line)) return "NUMBERED";
      return null;
    }
    return null;
  }

  function stripListMarkers(text) {
    return text.split("\n").map((line) =>
      RX_BULLET.test(line)   ? line.replace(RX_BULLET, "")   :
      RX_NUMBERED.test(line) ? line.replace(RX_NUMBERED, "") :
      line
    ).join("\n");
  }

  function toggleList(text, type) {
    if (detectListType(text) === type) return stripListMarkers(text);
    const lines = stripListMarkers(text).split("\n");
    if (type === "NUMBERED") {
      let n = 1;
      return lines.map((line) => line.trim() ? `${NBSP2}${n++}. ${line}` : line).join("\n");
    }
    return lines.map((line) => line.trim() ? `${NBSP2}• ${line}` : line).join("\n");
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Lucide icons (inline SVG paths)
  // ────────────────────────────────────────────────────────────────────────────

  const ICON_PATHS = {
    bold:          html`<path d="M14 12a4 4 0 0 0 0-8H6v8" /><path d="M15 20a4 4 0 0 0 0-8H6v8Z" />`,
    italic:        html`<line x1="19" x2="10" y1="4" y2="4" /><line x1="14" x2="5" y1="20" y2="20" /><line x1="15" x2="9" y1="4" y2="20" />`,
    underline:     html`<path d="M6 4v6a6 6 0 0 0 12 0V4" /><line x1="4" x2="20" y1="20" y2="20" />`,
    strikethrough: html`<path d="M16 4H9a3 3 0 0 0-2.83 4" /><path d="M14 12a4 4 0 0 1 0 8H6" /><line x1="4" x2="20" y1="12" y2="12" />`,
    smilePlus:     html`<path d="M22 11v1a10 10 0 1 1-9-10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" x2="9.01" y1="9" y2="9" /><line x1="15" x2="15.01" y1="9" y2="9" /><path d="M16 5h6" /><path d="M19 2v6" />`,
    undo:          html`<path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11" />`,
    redo:          html`<path d="m15 14 5-5-5-5" /><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5 5.5 5.5 0 0 0 9.5 20H13" />`,
    eraser:        html`<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" /><path d="M22 21H7" /><path d="m5 11 9 9" />`,
    list:          html`<line x1="8" x2="21" y1="6" y2="6" /><line x1="8" x2="21" y1="12" y2="12" /><line x1="8" x2="21" y1="18" y2="18" /><line x1="3" x2="3.01" y1="6" y2="6" /><line x1="3" x2="3.01" y1="12" y2="12" /><line x1="3" x2="3.01" y1="18" y2="18" />`,
    listOrdered:   html`<line x1="10" x2="21" y1="6" y2="6" /><line x1="10" x2="21" y1="12" y2="12" /><line x1="10" x2="21" y1="18" y2="18" /><path d="M4 6h1v4" /><path d="M4 10h2" /><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />`,
    check:         html`<polyline points="20 6 9 17 4 12" />`,
    copy:          html`<rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />`,
  };

  function Icon({ name, className = "h-4 w-4" }) {
    return html`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
           className=${className} aria-hidden="true">
        ${ICON_PATHS[name]}
      </svg>
    `;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Emoji picker (emoji-mart wrapper)
  // ────────────────────────────────────────────────────────────────────────────

  let emojiDataPromise = null;
  function getEmojiData() {
    if (!emojiDataPromise) {
      emojiDataPromise = fetch("https://cdn.jsdelivr.net/npm/@emoji-mart/data")
        .then((r) => r.json())
        .catch(() => ({}));
    }
    return emojiDataPromise;
  }

  function EmojiPicker({ onSelect }) {
    const containerRef = useRef(null);

    useEffect(() => {
      let cancelled = false;
      let pickerEl = null;

      getEmojiData().then((data) => {
        if (cancelled || !containerRef.current) return;
        if (typeof EmojiMart === "undefined" || !EmojiMart.Picker) {
          containerRef.current.textContent = "Emoji picker failed to load.";
          return;
        }
        // We deliberately don't pass emoji-mart's onClickOutside — its handler
        // is registered on document and persists past removeChild on unmount,
        // which fires onClose on the next click and prevents reopening. Outside-
        // click is handled by the parent Editor instead.
        pickerEl = new EmojiMart.Picker({
          data,
          onEmojiSelect: (emoji) => onSelect(emoji.native),
          previewPosition: "none",
          navPosition: "bottom",
          maxFrequentRows: 1,
          autoFocus: true,
          theme: "light",
          dynamicWidth: true,
        });
        containerRef.current.appendChild(pickerEl);
      });

      return () => {
        cancelled = true;
        if (pickerEl && pickerEl.parentNode) pickerEl.parentNode.removeChild(pickerEl);
      };
    }, [onSelect]);

    // On mobile the picker fills the bottom sheet (flex-1, w-full); on desktop
    // it sizes to emoji-mart's intrinsic 360px and rounds itself. flex+flex-col
    // is required on mobile so the picker (a flex child via CSS) sizes correctly.
    return html`<div ref=${containerRef} className="overflow-hidden flex flex-col flex-1 w-full md:block md:flex-initial md:w-[360px] md:h-[360px] md:rounded-lg" />`;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Symbol picker (Unicode blocks)
  // ────────────────────────────────────────────────────────────────────────────

  // Iterate a Unicode block range, dropping reserved/unassigned codepoints.
  // \p{Assigned} matches "any code point assigned to an abstract character" —
  // exactly the gaps we want to skip so the grid doesn't show tofu.
  function blockChars(start, end) {
    const out = [];
    for (let cp = start; cp <= end; cp++) {
      const ch = String.fromCodePoint(cp);
      if (/\p{Assigned}/u.test(ch)) out.push(ch);
    }
    return out;
  }

  const SYMBOL_BLOCKS = [
    { name: "Icons",     chars: blockChars(0x2700, 0x27bf) },
    { name: "Arrows",    chars: blockChars(0x2190, 0x21ff) },
    { name: "Shapes",    chars: blockChars(0x25a0, 0x25ff) },
    { name: "Currency",  chars: ["$", ...blockChars(0x20a0, 0x20cf)] },
    { name: "Misc Tech", chars: blockChars(0x2300, 0x23ff) },
    { name: "Math",      chars: blockChars(0x2200, 0x22ff) },
    { name: "Math+",     chars: blockChars(0x2a00, 0x2aff) },
    { name: "Misc Math", chars: [...blockChars(0x27c0, 0x27ef), ...blockChars(0x2980, 0x29ff)] },
  ];

  function SymbolPicker({ onSelect }) {
    const [activeTab, setActiveTab] = useState(0);
    const block = SYMBOL_BLOCKS[activeTab];
    return html`
      <div className="symbol-picker bg-white flex flex-col overflow-hidden flex-1 w-full md:flex-initial md:w-[420px] md:h-[360px] md:rounded-lg md:shadow-xl md:border md:border-zinc-200">
        <div className="flex border-b border-zinc-200 overflow-x-auto flex-shrink-0">
          ${SYMBOL_BLOCKS.map((b, i) => html`
            <button
              key=${b.name}
              type="button"
              onClick=${() => setActiveTab(i)}
              className=${`px-3 py-2 text-xs font-medium whitespace-nowrap flex-shrink-0 -mb-px border-b-2 transition-colors ${
                i === activeTab
                  ? "text-blue-600 border-blue-600"
                  : "text-zinc-600 hover:text-zinc-900 border-transparent"
              }`}
            >${b.name}</button>
          `)}
        </div>
        <div className="flex-1 overflow-y-auto p-1">
          <div className="grid grid-cols-9 md:grid-cols-12 gap-0.5">
            ${block.chars.map((ch) => html`
              <button
                key=${ch.codePointAt(0)}
                type="button"
                onClick=${() => onSelect(ch)}
                title=${`U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`}
                className="aspect-square flex items-center justify-center text-lg hover:bg-zinc-100 active:bg-zinc-200 rounded transition-colors"
              >${ch}</button>
            `)}
          </div>
        </div>
      </div>
    `;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Responsive helpers
  // ────────────────────────────────────────────────────────────────────────────

  // True when viewport is below Tailwind's `md` breakpoint (768px). Drives the
  // mobile/desktop layout split: bottom-sheet popovers, fixed bottom toolbar,
  // larger touch targets, no char count.
  function useIsMobile() {
    const query = "(max-width: 767px)";
    const [matches, setMatches] = useState(() =>
      typeof window !== "undefined" && window.matchMedia(query).matches
    );
    useEffect(() => {
      const mq = window.matchMedia(query);
      const handler = (e) => setMatches(e.matches);
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }, []);
    return matches;
  }

  // Wraps a popover. On mobile: portals a slide-up sheet (with backdrop) above
  // the fixed bottom toolbar. On desktop: renders an absolutely-positioned
  // anchored popover (the original behavior). The forwarded ref lands on the
  // element the parent's outside-click handler tests against.
  const BottomSheet = forwardRef(function BottomSheet({ open, onClose, children, className = "" }, ref) {
    const isMobile = useIsMobile();
    if (!open) return null;

    if (isMobile) {
      return ReactDOM.createPortal(html`
        <div>
          <div className="fixed inset-x-0 top-0 bottom-14 z-40 bg-black/40" onMouseDown=${onClose} />
          <div
            ref=${ref}
            className=${`fixed left-0 right-0 bottom-14 z-50 bg-white rounded-t-2xl shadow-2xl flex flex-col overflow-hidden animate-slide-up ${className}`}
            style=${{ maxHeight: "65dvh" }}
          >
            <div className="h-1 w-12 bg-zinc-300 rounded-full mx-auto my-2 flex-shrink-0" />
            ${children}
          </div>
        </div>
      `, document.body);
    }

    return html`
      <div ref=${ref} className=${`absolute z-50 left-0 mt-2 ${className}`}>
        ${children}
      </div>
    `;
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Toolbar primitives
  // ────────────────────────────────────────────────────────────────────────────

  const ToolButton = forwardRef(function ToolButton(
    { onClick, title, icon, disabled, active },
    ref
  ) {
    const cls = disabled
      ? "text-zinc-300 cursor-not-allowed"
      : active
      ? "bg-zinc-200 text-zinc-900"
      : "bg-zinc-50 text-zinc-700 hover:bg-zinc-100 active:bg-zinc-200";
    return html`
      <button
        ref=${ref}
        type="button"
        onClick=${onClick}
        disabled=${disabled}
        title=${title}
        aria-label=${title}
        className=${`inline-flex items-center justify-center h-11 w-11 md:h-9 md:w-9 rounded-md transition-colors flex-shrink-0 ${cls}`}
      >
        ${icon}
      </button>
    `;
  });

  function ToolGroup({ children }) {
    return html`<div className="flex items-center gap-0.5">${children}</div>`;
  }

  function Divider() {
    return html`<div className="self-stretch w-px bg-zinc-200 mx-1" />`;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Editor
  // ────────────────────────────────────────────────────────────────────────────

  const HISTORY_LIMIT = 200;
  const HISTORY_DEBOUNCE_MS = 400;
  const PLACEHOLDER = "Write here...";

  function Editor() {
    const isMobile = useIsMobile();
    const [value, setValue] = useState("");
    const [emojiOpen, setEmojiOpen] = useState(false);
    const [symbolsOpen, setSymbolsOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const textareaRef = useRef(null);
    const emojiButtonRef = useRef(null);
    const emojiPopoverRef = useRef(null);
    const symbolsButtonRef = useRef(null);
    const symbolsPopoverRef = useRef(null);

    const [history, setHistory] = useState([{ value: "", selection: { start: 0, end: 0 } }]);
    const [historyIndex, setHistoryIndex] = useState(0);
    const debouncedTimer = useRef(null);

    const pushHistory = useCallback((entry) => {
      setHistory((prev) => {
        const trimmed = prev.slice(0, historyIndex + 1);
        const next = [...trimmed, entry];
        if (next.length > HISTORY_LIMIT) next.shift();
        return next;
      });
      setHistoryIndex((prev) => Math.min(prev + 1, HISTORY_LIMIT - 1));
    }, [historyIndex]);

    const getSelection = () => {
      const ta = textareaRef.current;
      if (!ta) return { start: 0, end: 0 };
      return { start: ta.selectionStart || 0, end: ta.selectionEnd || 0 };
    };

    const setSelectionAfterRender = (sel) => {
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(sel.start, sel.end);
      });
    };

    const commitChange = (newValue, newSelection, immediate) => {
      setValue(newValue);
      setSelectionAfterRender(newSelection);
      if (debouncedTimer.current !== null) {
        window.clearTimeout(debouncedTimer.current);
        debouncedTimer.current = null;
      }
      if (immediate) {
        pushHistory({ value: newValue, selection: newSelection });
      } else {
        debouncedTimer.current = window.setTimeout(() => {
          pushHistory({ value: newValue, selection: newSelection });
          debouncedTimer.current = null;
        }, HISTORY_DEBOUNCE_MS);
      }
    };

    const handleChange = (e) => {
      const ta = e.target;
      commitChange(ta.value, { start: ta.selectionStart, end: ta.selectionEnd }, false);
    };

    const transformSelection = (transform) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const { start, end } = getSelection();
      const isEmpty = start === end;
      const selected = isEmpty ? value : value.slice(start, end);
      const replaced = transform(selected);
      if (isEmpty) {
        commitChange(replaced, { start: 0, end: replaced.length }, true);
      } else {
        const newValue = value.slice(0, start) + replaced + value.slice(end);
        commitChange(newValue, { start, end: start + replaced.length }, true);
      }
    };

    const transformLineRange = (transform) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const { start, end } = getSelection();
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      let lineEnd = value.indexOf("\n", end);
      if (lineEnd === -1) lineEnd = value.length;
      const before = value.slice(0, lineStart);
      const middle = value.slice(lineStart, lineEnd);
      const after = value.slice(lineEnd);
      const transformed = transform(middle);
      commitChange(before + transformed + after, { start: lineStart, end: lineStart + transformed.length }, true);
    };

    const onBold         = () => transformSelection((t) => toggleStyle(t, "bold"));
    const onItalic       = () => transformSelection((t) => toggleStyle(t, "italic"));
    const onBoldItalic   = () => transformSelection((t) => toggleStyle(t, "boldItalic"));
    const onScript       = () => transformSelection((t) => toggleStyle(t, "script"));
    const onBoldScript   = () => transformSelection((t) => toggleStyle(t, "boldScript"));
    const onFraktur      = () => transformSelection((t) => toggleStyle(t, "fraktur"));
    const onDoubleStruck = () => transformSelection((t) => toggleStyle(t, "doubleStruck"));
    const onFullwidth    = () => transformSelection((t) => toggleStyle(t, "fullwidth"));
    const onCircled      = () => transformSelection((t) => toggleStyle(t, "circled"));
    const onMono         = () => transformSelection((t) => toggleStyle(t, "monospace"));
    const onUnderline    = () => transformSelection((t) => toggleStyle(t, "underline"));
    const onStrike       = () => transformSelection((t) => toggleStyle(t, "strike"));
    const onErase        = () => transformSelection(stripAllFormatting);
    const onBullet       = () => transformLineRange((t) => toggleList(t, "BULLETED"));
    const onNumber       = () => transformLineRange((t) => toggleList(t, "NUMBERED"));

    const flushPending = () => {
      if (debouncedTimer.current !== null) {
        window.clearTimeout(debouncedTimer.current);
        debouncedTimer.current = null;
        pushHistory({ value, selection: getSelection() });
        return true;
      }
      return false;
    };

    const onUndo = () => {
      const pushed = flushPending();
      const targetIndex = pushed ? historyIndex : historyIndex - 1;
      if (targetIndex < 0) return;
      setHistoryIndex(targetIndex);
      const entry = history[targetIndex];
      setValue(entry.value);
      setSelectionAfterRender(entry.selection);
    };

    const onRedo = () => {
      const newIndex = historyIndex + 1;
      if (newIndex >= history.length) return;
      setHistoryIndex(newIndex);
      const entry = history[newIndex];
      setValue(entry.value);
      setSelectionAfterRender(entry.selection);
    };

    const insertChar = useCallback((ch) => {
      const ta = textareaRef.current;
      const start = ta ? (ta.selectionStart || 0) : value.length;
      const end   = ta ? (ta.selectionEnd   || 0) : value.length;
      const newValue = value.slice(0, start) + ch + value.slice(end);
      const cursor = start + ch.length;
      commitChange(newValue, { start: cursor, end: cursor }, true);
    }, [value]);

    const insertEmoji  = useCallback((emoji) => { insertChar(emoji); setEmojiOpen(false);   }, [insertChar]);
    const insertSymbol = useCallback((ch)    => { insertChar(ch);    setSymbolsOpen(false); }, [insertChar]);

    const closeEmoji   = useCallback(() => setEmojiOpen(false),   []);
    const closeSymbols = useCallback(() => setSymbolsOpen(false), []);

    const onCopy = async () => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        const ta = textareaRef.current;
        if (ta) {
          ta.select();
          try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 1500); }
          catch (e) { /* ignore */ }
        }
      }
    };

    // Close emoji popover on outside click
    useEffect(() => {
      if (!emojiOpen) return;
      const handler = (e) => {
        const target = e.target;
        if (
          emojiPopoverRef.current && !emojiPopoverRef.current.contains(target) &&
          emojiButtonRef.current && !emojiButtonRef.current.contains(target)
        ) {
          setEmojiOpen(false);
        }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, [emojiOpen]);

    // Close symbols popover on outside click
    useEffect(() => {
      if (!symbolsOpen) return;
      const handler = (e) => {
        const target = e.target;
        if (
          symbolsPopoverRef.current && !symbolsPopoverRef.current.contains(target) &&
          symbolsButtonRef.current && !symbolsButtonRef.current.contains(target)
        ) {
          setSymbolsOpen(false);
        }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, [symbolsOpen]);

    // Escape to close any open popover
    useEffect(() => {
      if (!emojiOpen && !symbolsOpen) return;
      const handler = (e) => {
        if (e.key !== "Escape") return;
        setEmojiOpen(false);
        setSymbolsOpen(false);
      };
      document.addEventListener("keydown", handler);
      return () => document.removeEventListener("keydown", handler);
    }, [emojiOpen, symbolsOpen]);

    const onKeyDown = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); onUndo(); return; }
      if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); onRedo(); return; }
      if (k === "b") { e.preventDefault(); onBold(); return; }
      if (k === "i") { e.preventDefault(); onItalic(); return; }
      if (k === "u") { e.preventDefault(); onUnderline(); return; }
    };

    const charCount = useMemo(() => Array.from(value).length, [value]);
    const canUndo = historyIndex > 0;
    const canRedo = historyIndex < history.length - 1;

    const copyClass = copied
      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
      : "bg-blue-600 border-blue-600 text-white hover:bg-blue-700";

    // Picker buttons defined once so refs are unambiguous; only one of the two
    // toolbar branches below renders at a time, so each is mounted exactly once.
    const emojiButton = html`
      <div className="relative">
        <${ToolButton}
          ref=${emojiButtonRef}
          onClick=${() => { setEmojiOpen((o) => !o); setSymbolsOpen(false); }}
          title="Insert emoji"
          icon=${html`<${Icon} name="smilePlus" />`}
          active=${emojiOpen}
        />
        <${BottomSheet} ref=${emojiPopoverRef} open=${emojiOpen} onClose=${closeEmoji}>
          <${EmojiPicker} onSelect=${insertEmoji} />
        <//>
      </div>
    `;
    const symbolsButton = html`
      <div className="relative">
        <${ToolButton}
          ref=${symbolsButtonRef}
          onClick=${() => { setSymbolsOpen((o) => !o); setEmojiOpen(false); }}
          title="Insert symbol"
          icon=${html`<span className="text-base leading-none">Ω</span>`}
          active=${symbolsOpen}
        />
        <${BottomSheet} ref=${symbolsPopoverRef} open=${symbolsOpen} onClose=${closeSymbols}>
          <${SymbolPicker} onSelect=${insertSymbol} />
        <//>
      </div>
    `;

    return html`
      <${React.Fragment}>
        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-visible flex-1 flex flex-col min-h-0">
          ${!isMobile ? html`
            <div className="border-b border-zinc-100">
              <div className="flex items-center gap-1 px-3 pt-2 pb-1 flex-wrap">
                <${ToolGroup}>
                  <${ToolButton} onClick=${onBold}       title="Bold (Ctrl+B)"   icon=${html`<${Icon} name="bold" />`} />
                  <${ToolButton} onClick=${onItalic}     title="Italic (Ctrl+I)" icon=${html`<${Icon} name="italic" />`} />
                  <${ToolButton} onClick=${onBoldItalic} title="Bold Italic"     icon=${html`<span className="font-semibold italic text-base leading-none">𝘽</span>`} />
                <//>

                <${Divider} />

                <${ToolGroup}>
                  <${ToolButton} onClick=${onScript}       title="Script"        icon=${html`<span className="text-base leading-none -mt-0.5">𝒮</span>`} />
                  <${ToolButton} onClick=${onBoldScript}   title="Bold Script"   icon=${html`<span className="font-semibold text-base leading-none -mt-0.5">𝓢</span>`} />
                  <${ToolButton} onClick=${onFraktur}      title="Fraktur"       icon=${html`<span className="text-base leading-none">𝔉</span>`} />
                  <${ToolButton} onClick=${onDoubleStruck} title="Double-struck" icon=${html`<span className="text-base leading-none">𝔻</span>`} />
                  <${ToolButton} onClick=${onFullwidth}    title="Fullwidth"     icon=${html`<span className="text-sm leading-none">Ａ</span>`} />
                  <${ToolButton} onClick=${onCircled}      title="Circled"       icon=${html`<span className="text-base leading-none">Ⓒ</span>`} />
                  <${ToolButton} onClick=${onMono}         title="Monospace"     icon=${html`<span className="font-mono text-base leading-none">𝙼</span>`} />
                <//>

                <${Divider} />

                <${ToolGroup}>
                  <${ToolButton} onClick=${onUnderline} title="Underline (Ctrl+U)" icon=${html`<${Icon} name="underline" />`} />
                  <${ToolButton} onClick=${onStrike}    title="Strikethrough"      icon=${html`<${Icon} name="strikethrough" />`} />
                <//>
              </div>

              <div className="flex items-center gap-1 px-3 pt-1 pb-2 flex-wrap">
                <${ToolGroup}>
                  ${emojiButton}
                  ${symbolsButton}
                <//>

                <${Divider} />

                <${ToolGroup}>
                  <${ToolButton} onClick=${onUndo}  disabled=${!canUndo} title="Undo (Ctrl+Z)"        icon=${html`<${Icon} name="undo" />`} />
                  <${ToolButton} onClick=${onRedo}  disabled=${!canRedo} title="Redo (Ctrl+Shift+Z)"  icon=${html`<${Icon} name="redo" />`} />
                  <${ToolButton} onClick=${onErase}                     title="Erase formatting"     icon=${html`<${Icon} name="eraser" />`} />
                <//>

                <${Divider} />

                <${ToolGroup}>
                  <${ToolButton} onClick=${onBullet} title="Bullet list"   icon=${html`<${Icon} name="list" />`} />
                  <${ToolButton} onClick=${onNumber} title="Numbered list" icon=${html`<${Icon} name="listOrdered" />`} />
                <//>

                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-zinc-400 tabular-nums">${charCount.toLocaleString()} chars</span>
                  <button
                    type="button"
                    onClick=${onCopy}
                    className=${`inline-flex items-center gap-1.5 h-8 px-3 text-sm font-medium rounded-md border transition-colors ${copyClass}`}
                  >
                    <${Icon} name=${copied ? "check" : "copy"} />
                    ${copied ? "Copied!" : "Copy text"}
                  </button>
                </div>
              </div>
            </div>
          ` : null}

          <textarea
            ref=${textareaRef}
            value=${value}
            onChange=${handleChange}
            onKeyDown=${onKeyDown}
            placeholder=${PLACEHOLDER}
            spellCheck=${true}
            className=${`block w-full flex-1 px-5 py-4 text-[15px] leading-relaxed text-zinc-900 placeholder:text-zinc-400 outline-none bg-transparent ${
              isMobile ? "min-h-0" : "min-h-[400px] resize-y"
            }`}
          />
        </div>

        ${isMobile ? html`
          <div className="fixed bottom-0 inset-x-0 z-30 h-14 bg-white border-t border-zinc-200 flex items-center px-1 gap-1">
            <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto scrollbar-hide h-full px-1">
              <${ToolButton} onClick=${onBold}         title="Bold"          icon=${html`<${Icon} name="bold" />`} />
              <${ToolButton} onClick=${onItalic}       title="Italic"        icon=${html`<${Icon} name="italic" />`} />
              <${ToolButton} onClick=${onBoldItalic}   title="Bold Italic"   icon=${html`<span className="font-semibold italic text-base leading-none">𝘽</span>`} />
              <${ToolButton} onClick=${onScript}       title="Script"        icon=${html`<span className="text-base leading-none -mt-0.5">𝒮</span>`} />
              <${ToolButton} onClick=${onBoldScript}   title="Bold Script"   icon=${html`<span className="font-semibold text-base leading-none -mt-0.5">𝓢</span>`} />
              <${ToolButton} onClick=${onFraktur}      title="Fraktur"       icon=${html`<span className="text-base leading-none">𝔉</span>`} />
              <${ToolButton} onClick=${onDoubleStruck} title="Double-struck" icon=${html`<span className="text-base leading-none">𝔻</span>`} />
              <${ToolButton} onClick=${onFullwidth}    title="Fullwidth"     icon=${html`<span className="text-sm leading-none">Ａ</span>`} />
              <${ToolButton} onClick=${onCircled}      title="Circled"       icon=${html`<span className="text-base leading-none">Ⓒ</span>`} />
              <${ToolButton} onClick=${onMono}         title="Monospace"     icon=${html`<span className="font-mono text-base leading-none">𝙼</span>`} />
              <${Divider} />
              <${ToolButton} onClick=${onUnderline}    title="Underline"     icon=${html`<${Icon} name="underline" />`} />
              <${ToolButton} onClick=${onStrike}       title="Strikethrough" icon=${html`<${Icon} name="strikethrough" />`} />
              <${Divider} />
              <${ToolButton} onClick=${onBullet}       title="Bullet list"   icon=${html`<${Icon} name="list" />`} />
              <${ToolButton} onClick=${onNumber}       title="Numbered list" icon=${html`<${Icon} name="listOrdered" />`} />
              <${Divider} />
              ${emojiButton}
              ${symbolsButton}
              <${Divider} />
              <${ToolButton} onClick=${onUndo}  disabled=${!canUndo} title="Undo"             icon=${html`<${Icon} name="undo" />`} />
              <${ToolButton} onClick=${onRedo}  disabled=${!canRedo} title="Redo"             icon=${html`<${Icon} name="redo" />`} />
              <${ToolButton} onClick=${onErase}                     title="Erase formatting" icon=${html`<${Icon} name="eraser" />`} />
            </div>
            <button
              type="button"
              onClick=${onCopy}
              aria-label=${copied ? "Copied" : "Copy text"}
              title=${copied ? "Copied!" : "Copy text"}
              className=${`flex-shrink-0 inline-flex items-center justify-center h-11 w-11 rounded-md border ${copyClass}`}
            >
              <${Icon} name=${copied ? "check" : "copy"} />
            </button>
          </div>
        ` : null}
      <//>
    `;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // App shell
  // ────────────────────────────────────────────────────────────────────────────

  function App() {
    return html`
      <div className="h-dvh md:h-auto md:min-h-screen flex flex-col pb-14 md:pb-0">
        <header className="max-w-3xl mx-auto w-full px-4 pt-4 pb-3 md:pt-10 md:pb-6 lg:pt-14 lg:pb-8">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-blue-600 to-sky-500 flex items-center justify-center text-white font-bold text-lg shadow-sm">in</div>
            <div>
              <h1 className="text-xl font-semibold text-slate-900 leading-tight">LinkedIn Post Formatter</h1>
              <p className="text-xs text-slate-500">Bold, italic, lists, emoji — paste-ready Unicode</p>
            </div>
          </div>
        </header>
        <main className="flex-1 max-w-3xl mx-auto w-full px-4 pb-6 md:pb-20 flex flex-col min-h-0">
          <${Editor} />
          <footer className="mt-6 text-center text-xs text-slate-400 space-y-1">
            <p>Formatting uses Unicode math characters & combining marks — pastes directly into LinkedIn.</p>
            <p>
              Copyright 2026 ${" "}
              <a href="https://robustagile.com/" target="_blank" rel="noopener noreferrer"
                 className="text-slate-500 hover:text-slate-700 underline underline-offset-2">
                Robust Agile
              </a>
            </p>
          </footer>
        </main>
      </div>
    `;
  }

  ReactDOM.createRoot(document.getElementById("root")).render(html`<${App} />`);
})();
