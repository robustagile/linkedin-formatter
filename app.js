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
  const BASES = {
    b:   { upper: 0x1d400, lower: 0x1d41a, digit: 0x1d7ce },
    i:   { upper: 0x1d434, lower: 0x1d44e, digit: null    },
    bi:  { upper: 0x1d468, lower: 0x1d482, digit: null    },
    s:   { upper: 0x1d5a0, lower: 0x1d5ba, digit: 0x1d7e2 },
    bs:  { upper: 0x1d5d4, lower: 0x1d5ee, digit: 0x1d7ec },
    is:  { upper: 0x1d608, lower: 0x1d622, digit: null    },
    bis: { upper: 0x1d63c, lower: 0x1d656, digit: null    },
    bc:  { upper: 0x1d4d0, lower: 0x1d4ea, digit: null    }, // Bold Script
    m:   { upper: 0x1d670, lower: 0x1d68a, digit: 0x1d7f6 },
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
      STYLED_TO_PLAIN.set(b.upper + i, { plain: String.fromCodePoint(CP_A_UP + i), variant: v });
      STYLED_TO_PLAIN.set(b.lower + i, { plain: String.fromCodePoint(CP_A_LO + i), variant: v });
    }
    if (b.digit !== null) {
      for (let i = 0; i < 10; i++) {
        STYLED_TO_PLAIN.set(b.digit + i, { plain: String.fromCodePoint(CP_ZERO + i), variant: v });
      }
    }
  }
  STYLED_TO_PLAIN.set(0x210e, { plain: "h", variant: "i" });

  function variantChar(ch, variant) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) return ch;
    if (variant === "i" && ITALIC_EXCEPTIONS[ch]) return ITALIC_EXCEPTIONS[ch];
    const base = BASES[variant];
    if (cp >= CP_A_UP && cp <= CP_A_UP + 25) return String.fromCodePoint(base.upper + (cp - CP_A_UP));
    if (cp >= CP_A_LO && cp <= CP_A_LO + 25) return String.fromCodePoint(base.lower + (cp - CP_A_LO));
    if (cp >= CP_ZERO && cp <= CP_ZERO + 9 && base.digit !== null) {
      return String.fromCodePoint(base.digit + (cp - CP_ZERO));
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

  function detectVariants(text) {
    let total = 0, bold = 0, italic = 0, script = 0, mono = 0, underline = 0, strike = 0;
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
        if (styled) {
          const v = styled.variant;
          if (v === "bs" || v === "b" || v === "bis" || v === "bi") bold++;
          if (v === "is" || v === "i" || v === "bis" || v === "bi") italic++;
          if (v === "bc") script++;
          if (v === "m")  mono++;
        }
      } else {
        prevFormattable = false;
      }
    }
    if (total === 0) {
      return { bold: false, italic: false, script: false, monospace: false, underline: false, strike: false };
    }
    return {
      bold:      bold      === total,
      italic:    italic    === total,
      script:    script    === total,
      monospace: mono      === total,
      underline: underline > 0 && underline >= Math.floor(total * 0.5),
      strike:    strike    > 0 && strike    >= Math.floor(total * 0.5),
    };
  }

  function applyFormatting(text, opts) {
    let result = stripAllFormatting(text);
    let variant = null;
    // Script and Monospace are exclusive type styles — the toggle layer keeps
    // them mutually exclusive with bold/italic, but if both happen to be set
    // we honor script/monospace first.
    if      (opts.script)               variant = "bc";
    else if (opts.monospace)            variant = "m";
    else if (opts.bold && opts.italic)  variant = "bis";
    else if (opts.bold)                 variant = "bs";
    else if (opts.italic)               variant = "is";
    // Underline/strike on plain ASCII anchors the combining mark poorly,
    // so promote to Monospace as a fallback when no other variant is chosen.
    else if (opts.underline || opts.strike) variant = "m";

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

  function toggleStyle(text, style) {
    const current = detectVariants(text);
    const next = {
      bold:      current.bold,
      italic:    current.italic,
      script:    current.script,
      monospace: current.monospace,
      underline: current.underline,
      strike:    current.strike,
    };
    if (style === "bold" || style === "italic") {
      // Bold/italic family — clear script/monospace, flip the chosen flag.
      next.script = false;
      next.monospace = false;
      next[style] = !current[style];
    } else if (style === "script") {
      const turnOn = !current.script;
      next.bold = false; next.italic = false; next.monospace = false;
      next.script = turnOn;
    } else if (style === "monospace") {
      const turnOn = !current.monospace;
      next.bold = false; next.italic = false; next.script = false;
      next.monospace = turnOn;
    } else if (style === "underline" || style === "strike") {
      next[style] = !current[style];
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

  function EmojiPicker({ onSelect, onClose }) {
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
        pickerEl = new EmojiMart.Picker({
          data,
          onEmojiSelect: (emoji) => onSelect(emoji.native),
          onClickOutside: (e) => {
            // emoji-mart's outside detection covers the picker; also close on its signal.
            if (containerRef.current && !containerRef.current.contains(e.target)) {
              onClose();
            }
          },
          previewPosition: "none",
          navPosition: "bottom",
          maxFrequentRows: 1,
          autoFocus: true,
          theme: "light",
        });
        containerRef.current.appendChild(pickerEl);
      });

      return () => {
        cancelled = true;
        if (pickerEl && pickerEl.parentNode) pickerEl.parentNode.removeChild(pickerEl);
      };
    }, [onSelect, onClose]);

    return html`<div ref=${containerRef} className="rounded-lg overflow-hidden" />`;
  }

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
        className=${`inline-flex items-center justify-center h-9 w-9 rounded-md transition-colors ${cls}`}
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
    const [value, setValue] = useState("");
    const [emojiOpen, setEmojiOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const textareaRef = useRef(null);
    const emojiButtonRef = useRef(null);
    const emojiPopoverRef = useRef(null);

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

    const onBold      = () => transformSelection((t) => toggleStyle(t, "bold"));
    const onItalic    = () => transformSelection((t) => toggleStyle(t, "italic"));
    const onUnderline = () => transformSelection((t) => toggleStyle(t, "underline"));
    const onStrike    = () => transformSelection((t) => toggleStyle(t, "strike"));
    const onScript    = () => transformSelection((t) => toggleStyle(t, "script"));
    const onMono      = () => transformSelection((t) => toggleStyle(t, "monospace"));
    const onErase     = () => transformSelection(stripAllFormatting);
    const onBullet    = () => transformLineRange((t) => toggleList(t, "BULLETED"));
    const onNumber    = () => transformLineRange((t) => toggleList(t, "NUMBERED"));

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

    const insertEmoji = useCallback((emoji) => {
      const ta = textareaRef.current;
      const start = ta ? (ta.selectionStart || 0) : value.length;
      const end   = ta ? (ta.selectionEnd   || 0) : value.length;
      const newValue = value.slice(0, start) + emoji + value.slice(end);
      const cursor = start + emoji.length;
      commitChange(newValue, { start: cursor, end: cursor }, true);
      setEmojiOpen(false);
    }, [value]);

    const closeEmoji = useCallback(() => setEmojiOpen(false), []);

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

    // Escape to close emoji popover
    useEffect(() => {
      if (!emojiOpen) return;
      const handler = (e) => { if (e.key === "Escape") setEmojiOpen(false); };
      document.addEventListener("keydown", handler);
      return () => document.removeEventListener("keydown", handler);
    }, [emojiOpen]);

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

    return html`
      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-visible">
        <div className="flex items-center gap-1 px-3 py-2 border-b border-zinc-100 flex-wrap">
          <${ToolGroup}>
            <${ToolButton} onClick=${onBold}      title="Bold (Ctrl+B)"      icon=${html`<${Icon} name="bold" />`} />
            <${ToolButton} onClick=${onItalic}    title="Italic (Ctrl+I)"    icon=${html`<${Icon} name="italic" />`} />
            <${ToolButton} onClick=${onUnderline} title="Underline (Ctrl+U)" icon=${html`<${Icon} name="underline" />`} />
            <${ToolButton} onClick=${onStrike}    title="Strikethrough"      icon=${html`<${Icon} name="strikethrough" />`} />
          <//>

          <${Divider} />

          <${ToolGroup}>
            <${ToolButton}
              onClick=${onScript}
              title="Script"
              icon=${html`<span className="font-semibold text-base leading-none -mt-0.5">𝓢</span>`}
            />
            <${ToolButton}
              onClick=${onMono}
              title="Monospace"
              icon=${html`<span className="font-mono text-base leading-none">𝙼</span>`}
            />
          <//>

          <${Divider} />

          <${ToolGroup}>
            <div className="relative">
              <${ToolButton}
                ref=${emojiButtonRef}
                onClick=${() => setEmojiOpen((o) => !o)}
                title="Insert emoji"
                icon=${html`<${Icon} name="smilePlus" />`}
                active=${emojiOpen}
              />
              ${emojiOpen ? html`
                <div ref=${emojiPopoverRef} className="absolute z-50 left-0 mt-2">
                  <${EmojiPicker} onSelect=${insertEmoji} onClose=${closeEmoji} />
                </div>
              ` : null}
            </div>
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

        <textarea
          ref=${textareaRef}
          value=${value}
          onChange=${handleChange}
          onKeyDown=${onKeyDown}
          placeholder=${PLACEHOLDER}
          spellCheck=${true}
          className="block w-full min-h-[400px] resize-y px-5 py-4 text-[15px] leading-relaxed text-zinc-900 placeholder:text-zinc-400 outline-none bg-transparent"
        />
      </div>
    `;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // App shell
  // ────────────────────────────────────────────────────────────────────────────

  function App() {
    return html`
      <div className="min-h-screen">
        <header className="max-w-3xl mx-auto px-4 pt-10 pb-6 sm:pt-14 sm:pb-8">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-blue-600 to-sky-500 flex items-center justify-center text-white font-bold text-lg shadow-sm">in</div>
            <div>
              <h1 className="text-xl font-semibold text-slate-900 leading-tight">LinkedIn Post Formatter</h1>
              <p className="text-xs text-slate-500">Bold, italic, lists, emoji — paste-ready Unicode</p>
            </div>
          </div>
        </header>
        <main className="max-w-3xl mx-auto px-4 pb-20">
          <${Editor} />
          <footer className="mt-6 text-center text-xs text-slate-400">
            Formatting uses Unicode math characters & combining marks — pastes directly into LinkedIn.
          </footer>
        </main>
      </div>
    `;
  }

  ReactDOM.createRoot(document.getElementById("root")).render(html`<${App} />`);
})();
