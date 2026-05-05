/**
 * Parse QR / barcode string into { netto, brutto, name? } in grams.
 *
 * Rules:
 *  - Bruto/Brutto (gross) is ALWAYS >= Netto. We enforce this by swapping if needed.
 *  - Supports multiple flexible formats (JSON, kv, csv, slash-separated jewelry tags, etc.)
 *
 * Strategies, in order of priority:
 *   1. Strict JSON
 *   2. Explicit labelled key:value pairs (netto=..., brutto=..., etc.)
 *   3. "Netto X gr" / "Bruto Y gr" phrases in free text
 *   4. Extract ALL numeric weight values (e.g. "8.18gr.", "10.95 gr."); find a triple
 *      (a, b, c) where a + b ≈ c → netto=a, packing=b, bruto=c
 *   5. Extract all numeric weight values; pick the two most-plausible:
 *      min → netto, max → bruto
 *   6. Fallback: last two numeric tokens in the string, min → netto, max → bruto
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

// Extract every "<number> [gr|gram|g|kg]" occurrence.
// Returns array of grams as numbers.
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

// Find the BEST triple (a, b, c) where a + b ≈ c.
// Returns the triple with the smallest |a+b-c| within tolerance.
// Returns [netto=max(a,b), brutto=c] or null.
const findTriple = (
  values: number[]
): { netto: number; brutto: number } | null => {
  const EPS = 0.011; // tight: < 1.1 cg tolerance
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
  if (best) {
    return { netto: Math.max(best.a, best.b), brutto: best.c };
  }
  return null;
};

// Try to find an item name from a slash-delimited string.
// Heuristic: the longest alphabetic token (2+ letters) before the first weight value.
const pickNameFromSlashed = (input: string): string | undefined => {
  const parts = input.split("/").map((p) => p.trim()).filter(Boolean);
  let best: string | undefined;
  for (const p of parts) {
    if (/\d/.test(p)) continue; // skip things with digits (codes, sizes with nums)
    if (/^[A-Za-z][A-Za-z\s.\-]{2,}$/.test(p)) {
      if (!best || p.length > best.length) best = p;
    }
  }
  return best;
};

export function parseQR(raw: string): ParsedWeight | null {
  if (!raw || typeof raw !== "string") return null;
  const input = raw.trim();

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
        const o = ensureOrder(netto, brutto);
        return { ...o, name: name ? String(name) : undefined };
      }
    } catch {
      // fall through
    }
  }

  // 2) Labelled key:value (netto:..., brutto:..., bruto:..., etc.)
  const kvRegex =
    /(netto|net|brutto|brutt|bruto|gross|name|item)\s*[:=]\s*([^,;\n\t]+)/gi;
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
      const o = ensureOrder(n, b);
      return { ...o, name };
    }
  }

  // 3) Free-text "Netto X gr" / "Bruto(Brutto) Y gr"
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
      const o = ensureOrder(n, b);
      const nameSlash = input.includes("/") ? pickNameFromSlashed(input) : undefined;
      return { ...o, name: nameSlash };
    }
  }

  // 4) Extract all weight-unit values, try triple-match (netto + packing = bruto)
  const weights = extractWeightValues(input);
  if (weights.length >= 3) {
    const triple = findTriple(weights);
    if (triple) {
      const nameSlash = input.includes("/") ? pickNameFromSlashed(input) : undefined;
      return { ...triple, name: nameSlash };
    }
  }

  // 5) Two or more weight-unit values → take min/max that are plausible
  if (weights.length >= 2) {
    const min = Math.min(...weights);
    const max = Math.max(...weights);
    if (min > 0 && max > min) {
      const nameSlash = input.includes("/") ? pickNameFromSlashed(input) : undefined;
      return { netto: min, brutto: max, name: nameSlash };
    }
  }

  // 6) Fallback: delimited tokens (comma/tab/semicolon) → last 2 numeric
  const tokens = input
    .split(/[,;\t\n]|\s{2,}/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length >= 2) {
    const last = toNum(tokens[tokens.length - 1]);
    const prev = toNum(tokens[tokens.length - 2]);
    if (last !== null && prev !== null) {
      const o = ensureOrder(prev, last);
      const nameParts = tokens.slice(0, tokens.length - 2);
      const name = nameParts.length > 0 ? nameParts.join(" ") : undefined;
      return { ...o, name };
    }
  }

  // 7) Whitespace split fallback
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
