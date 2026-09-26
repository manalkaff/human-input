/* Deterministic motion helpers shared by every scene. No clocks, no Math.random. */
(function () {
  function splitChars(el) {
    const text = el.textContent;
    el.textContent = "";
    const out = [];
    for (const ch of text) {
      const s = document.createElement("span");
      s.className = "ch";
      s.textContent = ch;
      s.style.whiteSpace = "pre";
      el.appendChild(s);
      out.push(s);
    }
    return out;
  }

  function splitWords(el) {
    const words = el.textContent.split(" ");
    el.textContent = "";
    return words.map((w, i) => {
      const s = document.createElement("span");
      s.className = "wd";
      s.style.display = "inline-block";
      s.textContent = w;
      el.appendChild(s);
      if (i < words.length - 1) el.appendChild(document.createTextNode(" "));
      return s;
    });
  }

  // Reveal characters one by one, like typing. Returns the end time.
  function typeOn(tl, el, start, cps) {
    const chars = splitChars(el);
    const step = 1 / (cps || 28);
    tl.set(chars, { opacity: 0 }, 0);
    chars.forEach((c, i) => tl.set(c, { opacity: 1 }, start + i * step));
    return start + chars.length * step;
  }

  // Seeded PRNG (mulberry32) for scramble glyphs.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Scramble-decode `el` from its current text to `to` between start and start+dur.
  function scramble(tl, el, to, start, dur, seed) {
    const from = el.textContent;
    const glyphs = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123456789{}$#%&*_:";
    const r = rng(seed || 1);
    const steps = Math.max(6, Math.round(dur * 30));
    const len = Math.max(from.length, to.length);
    for (let s = 1; s <= steps; s++) {
      const p = s / steps;
      let str = "";
      for (let i = 0; i < len; i++) {
        const settle = i / len;
        if (p > settle * 0.85 + 0.15) str += to[i] || "";
        else if (p < 0.12) str += from[i] || "";
        else str += i < to.length || i < from.length ? glyphs[Math.floor(r() * glyphs.length)] : "";
      }
      tl.set(el, { textContent: s === steps ? to : str }, start + (s - 1) * (dur / steps));
    }
  }

  window.HF = { splitChars, splitWords, typeOn, scramble, rng };
})();
