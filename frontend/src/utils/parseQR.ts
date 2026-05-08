/**
 * Parse QR / barcode string into { netto, brutto, name? } in grams.
 *
 * Rule: bruto >= netto is always enforced (auto-swap if reversed).
 *
 * Strategies, in priority order:
 *   1. Strict JSON
 *   2. Explicit labelled key:value pairs (netto=..., brutto=..., bruto=..., gross=..., etc.)
 *   3. Free-text "Netto X gr" + "Bruto/Brutto Y gr" anywhere in string
 *   4. Triple-match: extract every weight value (number with gr/g/kg unit). Find
 *      the BEST triple where a + b ≈ c (smallest residual under tolerance).
 *      → netto=max(a,b), brutto=c.
 *   5. Decimal-only fallback: extract ALL numbers with a fractional part
 *      (e.g., "3.79", "8.18", "10.95"). If we have ≥2, treat the smallest
 *      plausible value as netto and the largest plausible value as brutto.
 *      ("Plausible" filters out very small values that are probably packing,
 *      preferring a min/max pair that satisfies bruto > netto.)
 *   6. Generic delimited fallback (last 2 numeric tokens), with min→netto.
 *   7. Whitespace-split fallback (last 2 numeric tokens), with min→netto.
 */

export type ParsedWeight = {
  name?: string;
  netto: number;
  brutto: number;
};

const toNum = (s: string): number | null => {
  const n = parseFloat(String(s).replace(",", ".").trim());
  return Number.isFinite(n) ? n : null;
};

const ensureOrder = (a: number, b: number) => ({
  netto: Math.min(a, b),
  brutto: Math.max(a, b),
});

// Strip control / non-printable characters that some HID scanners inject.
const sanitize = (raw: string): string =>
  raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ").trim();

// Extract every "<number> [gr|gram|g|kg]" occurrence (units required).
const extractWeightValues = (input: string): number[] => {
  const out: number[] = [];
  const re = /(\d+(?:[.,]\d+)?)\s*(kg|gr\.?|grams?|g)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const val = toNum(m[1]);
    if (val === null) continue;
    const unit = m[2].toLowerCase();
    const grams = unit.startsWith("k") ? val * 1000 : val;
    out.push(grams);
  }
  return out;
};

// Extract ALL numbers having a fractional part (with . or , as separator).
// These are very likely to be weight values (8.18, 10.95, 3.79 etc.).
const extractDecimalNumbers = (input: string): number[] => {
  const out: number[] = [];
  const re = /(\d+[.,]\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const v = toNum(m[1]);
    if (v !== null && v > 0) out.push(v);
  }
  return out;
};

// Find best (a,b,c) where a+b ≈ c. Returns { netto=max(a,b), brutto=c } or null.
const findTriple = (
  values: number[]
): { netto: number; brutto: number } | null => {
  const EPS = 0.011;
  let best: { diff: number; a: number; b: number; c: number } | null = null;
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      for (let k = 0; k < values.length; k++) {
        if (k === i || k === j) continue;
        const a = values[i];
        const b = values[j];
        const c = values[k];
        if (a >= c || b >= c) continue;
        const diff = Math.abs(a + b - c);
        if (diff <= EPS && (best === null || diff < best.diff)) {
          best = { diff, a, b, c };
        }
      }
    }
  }
  if (best) return { netto: Math.max(best.a, best.b), brutto: best.c };
  return null;
};

// Pick longest plausible item-name token from any free-form text:
// alphabetic words (≥3 letters) joined by spaces. Prefers slash/comma/newline-delimited segments.
const pickName = (input: string): string | undefined => {
  const segments = input.split(/[/,;\n\r\t|]/).map((s) => s.trim()).filter(Boolean);
  let best: string | undefined;
  for (const s of segments) {
    if (/\d/.test(s)) continue;
    if (/^[A-Za-z][A-Za-z\s.'\-]{2,}$/.test(s) && s.length <= 40) {
      if (!best || s.length > best.length) best = s;
    }
  }
  return best;
};

export function parseQR(raw: string): ParsedWeight | null {
  if (!raw || typeof raw !== "string") return null;
  const input = sanitize(raw);
  if (!input) return null;

  // 1) JSON
  if (input.startsWith("{") && input.endsWith("}")) {
    try {
      const obj = JSON.parse(input);
      const netto = toNum(
        obj.netto ?? obj.net ?? obj.n ?? obj.Netto ?? obj.NETTO
      );
      const brutto = toNum(
        obj.brutto ?? obj.bruto ?? obj.gross ?? obj.b ?? obj.Brutto ?? obj.BRUTTO
      );
      const name = obj.name ?? obj.item ?? obj.Item ?? obj.id;
      if (netto !== null && brutto !== null) {
        return { ...ensureOrder(netto, brutto), name: name ? String(name) : undefined };
      }
    } catch {
      // fallthrough
    }
  }

  // 2) Inventory short prefixes (e.g., "Ne:00008.18 Pa:00002.77 Br:00010.95")
  // Common in jewelry / GS1-style QR codes. Values may be zero-padded.
  // Brutto is computed as Netto + Packing if not explicitly given.
  {
const invRe = /\b(ne|pa|br|brt|net|nt)\s*[:=]\s*0*(\d+(?:[.,]\d+)?)/gi;
    const inv: Record<string, number> = {};
    let im: RegExpExecArray | null;
    while ((im = invRe.exec(input)) !== null) {
      const key = im[1].toLowerCase();
      const v = toNum(im[2]);
      if (v !== null) inv[key] = v;
    }
let brutto: number | null =
  inv.br ?? inv.brt ?? null;
    let brutto: number | null =
      inv.br ?? inv.brt ?? inv.gr ?? null;
    if (netto !== null && brutto === null && inv.pa !== undefined) {
      // Compute brutto = netto + packing, rounded to avoid float-math noise
      brutto = Math.round((netto + inv.pa) * 100) / 100;
    }
    if (netto !== null && brutto !== null) {
      return { ...ensureOrder(netto, brutto), name: pickName(input) };
    }
  }

  // 2) Labelled key:value pairs
  const kvRegex =
    /(netto|net|brutto|brutt|bruto|gross|name|item)\s*[:=]\s*([^,;\n\t|]+)/gi;
  const kv: Record<string, string> = {};
  let km: RegExpExecArray | null;
  while ((km = kvRegex.exec(input)) !== null) {
    kv[km[1].toLowerCase()] = km[2].trim();
  }
  if (Object.keys(kv).length > 0) {
    const n = toNum(kv.netto ?? kv.net ?? "");
    const b = toNum(kv.brutto ?? kv.brutt ?? kv.bruto ?? kv.gross ?? "");
    const name = kv.name ?? kv.item;
    if (n !== null && b !== null) {
      return { ...ensureOrder(n, b), name };
const netto =
  inv.ne ?? inv.net ?? inv.nt ?? null;
const packaging =
  inv.pa ?? null;
let brutto: number | null =
  inv.br ?? inv.brt ?? inv.gr ?? null;
if (netto !== null && brutto === null && packaging !== null) {
  brutto = Math.round((netto + packaging) * 100) / 100;
}
if (netto !== null && brutto !== null) {
  return { 
    ...ensureOrder(netto, brutto), 
    packaging: packaging ?? undefined,   // ← keeps packaging info
    name: pickName(input) 
  };
}    }
  }

  // 3) Free-text Netto / Bruto patterns
  const nettoRe =
    /netto\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*(?:kg|gr\.?|grams?|g)?/i;
  const brutoRe =
    /brutt?o\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*(?:kg|gr\.?|grams?|g)?/i;
  const nMatch = input.match(nettoRe);
  const bMatch = input.match(brutoRe);
  if (nMatch && bMatch) {
    const n = toNum(nMatch[1]);
    const b = toNum(bMatch[1]);
    if (n !== null && b !== null) {
      return { ...ensureOrder(n, b), name: pickName(input) };
    }
  }

  // 4) Triple-match using values with explicit weight units
  const unitWeights = extractWeightValues(input);
  if (unitWeights.length >= 3) {
    const triple = findTriple(unitWeights);
    if (triple) return { ...triple, name: pickName(input) };
  }
  if (unitWeights.length >= 2) {
    const min = Math.min(...unitWeights);
    const max = Math.max(...unitWeights);
    if (max > min) {
      // If we also see a third unit-value matching min+other = max, we already
      // returned in the triple branch. Here we have exactly 2 unit values.
      return { netto: min, brutto: max, name: pickName(input) };
    }
  }

  // 5) Decimal-only fallback (no unit required) — VERY tolerant
  const decimals = extractDecimalNumbers(input);
  if (decimals.length >= 3) {
    // Try triple-match on decimals first
    const triple = findTriple(decimals);
    if (triple) return { ...triple, name: pickName(input) };
  }
  if (decimals.length >= 2) {
    const min = Math.min(...decimals);
    const max = Math.max(...decimals);
    if (max > min) {
      return { netto: min, brutto: max, name: pickName(input) };
    }
  }

  // 6) Delimited (comma/tab/semicolon) — last 2 numeric tokens
  const tokens = input
    .split(/[,;\t\n|]/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length >= 2) {
    const last = toNum(tokens[tokens.length - 1]);
    const prev = toNum(tokens[tokens.length - 2]);
    if (last !== null && prev !== null) {
      const o = ensureOrder(prev, last);
      const nameParts = tokens.slice(0, tokens.length - 2);
      const name = nameParts.length > 0 ? nameParts.join(" ").trim() : undefined;
      return { ...o, name };
    }
  }

  // 7) Whitespace-split — last 2 numeric tokens
  const ws = input.split(/\s+/).filter(Boolean);
  if (ws.length >= 2) {
    const last = toNum(ws[ws.length - 1]);
    const prev = toNum(ws[ws.length - 2]);
    if (last !== null && prev !== null) {
      const o = ensureOrder(prev, last);
      const nameParts = ws.slice(0, ws.length - 2);
      const name = nameParts.length > 0 ? nameParts.join(" ") : undefined;
      return { ...o, name };
    }
  }

  return null;
}
