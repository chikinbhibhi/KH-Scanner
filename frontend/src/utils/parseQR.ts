/**
 * Parse QR code string into { netto, brutto, name? } in grams.
 * Supports multiple flexible formats:
 *  - JSON: {"netto":3.79,"brutto":5.94,"name":"Item 1"}
 *  - Key-value: "netto:3.79,brutto:5.94" or "netto=3.79;brutto=5.94"
 *  - CSV: "3.79,5.94" (netto, brutto)
 *  - CSV with name: "Item 1,3.79,5.94"
 *  - Tab/space separated: "Item 1\t3.79\t5.94" or "3.79 5.94"
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

export function parseQR(raw: string): ParsedWeight | null {
  if (!raw || typeof raw !== "string") return null;
  const input = raw.trim();

  // 1) JSON
  if (input.startsWith("{") && input.endsWith("}")) {
    try {
      const obj = JSON.parse(input);
      const netto =
        toNum(obj.netto ?? obj.net ?? obj.n ?? obj.Netto ?? obj.NETTO);
      const brutto =
        toNum(obj.brutto ?? obj.gross ?? obj.b ?? obj.Brutto ?? obj.BRUTTO);
      const name = obj.name ?? obj.item ?? obj.Item ?? obj.id;
      if (netto !== null && brutto !== null) {
        return { netto, brutto, name: name ? String(name) : undefined };
      }
    } catch {
      // fallthrough
    }
  }

  // 2) Key-value parsing (netto:x,brutto:y  OR  netto=x;brutto=y)
  const kvRegex = /(netto|net|brutto|brutt|gross|name|item)\s*[:=]\s*([^,;\n\t]+)/gi;
  const kv: Record<string, string> = {};
  let m: RegExpExecArray | null;
  while ((m = kvRegex.exec(input)) !== null) {
    kv[m[1].toLowerCase()] = m[2].trim();
  }
  if (Object.keys(kv).length > 0) {
    const netto = toNum(kv.netto ?? kv.net ?? "");
    const brutto = toNum(kv.brutto ?? kv.brutt ?? kv.gross ?? "");
    const name = kv.name ?? kv.item;
    if (netto !== null && brutto !== null) {
      return { netto, brutto, name };
    }
  }

  // 3) Delimited tokens (comma, tab, semicolon, whitespace)
  const tokens = input
    .split(/[,;\t\n]|\s{2,}/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (tokens.length >= 2) {
    // Last two tokens as netto, brutto
    const n = toNum(tokens[tokens.length - 2]);
    const b = toNum(tokens[tokens.length - 1]);
    if (n !== null && b !== null) {
      const nameParts = tokens.slice(0, tokens.length - 2);
      const name = nameParts.length > 0 ? nameParts.join(" ") : undefined;
      return { netto: n, brutto: b, name };
    }
  }

  // 4) Single line whitespace split, e.g., "Item 1 3.79 5.94" or "3.79 5.94"
  const ws = input.split(/\s+/).filter(Boolean);
  if (ws.length >= 2) {
    const n = toNum(ws[ws.length - 2]);
    const b = toNum(ws[ws.length - 1]);
    if (n !== null && b !== null) {
      const nameParts = ws.slice(0, ws.length - 2);
      const name = nameParts.length > 0 ? nameParts.join(" ") : undefined;
      return { netto: n, brutto: b, name };
    }
  }

  return null;
}
