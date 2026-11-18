// Incremental reader for one tool input as it streams (input_json_delta fragments). The build tools' inputs are flat
// objects of string fields, so this reads the top-level string values, decoding JSON escapes, and reports each
// field's text as it arrives. It only drives the live editor: the input that gets applied is always the whole
// fragment string parsed strictly at the end of the block (llm/assemble.ts), so anything this reader can't follow
// (a non-string value, malformed JSON) is skipped, never guessed.

export type FieldListener = (key: string, text: string, done: boolean) => void;

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\", "/": "/" };

export function createFieldReader(onField: FieldListener) {
  // Where we are: between fields, inside a key, between key and value, inside a string value, inside another value.
  let state: "between" | "key" | "colon" | "value" | "string" | "other" = "between";
  let depth = 0; // nesting inside a non-string value (skipped)
  let inOtherString = false;
  let key = "";
  let out = ""; // decoded text of the current value not yet reported
  let escape: string | null = null; // "\\", or "\\u" plus the hex digits read so far
  let highSurrogate: number | null = null;
  let started = false; // the opening brace was seen

  /** Decodes one character of a string; returns the text it adds (empty while an escape is incomplete). */
  function decode(c: string): string {
    if (escape === null) {
      if (c === "\\") { escape = "\\"; return ""; }
      return flushSurrogate() + c;
    }
    if (escape === "\\") {
      if (c === "u") { escape = "\\u"; return ""; }
      escape = null;
      return flushSurrogate() + (ESCAPES[c] ?? c);
    }
    escape += c;
    if (escape.length < 6) return "";
    const code = parseInt(escape.slice(2), 16);
    escape = null;
    if (Number.isNaN(code)) return flushSurrogate();
    if (code >= 0xd800 && code <= 0xdbff) {
      const before = flushSurrogate();
      highSurrogate = code;
      return before;
    }
    if (code >= 0xdc00 && code <= 0xdfff && highSurrogate !== null) {
      const pair = String.fromCharCode(highSurrogate, code);
      highSurrogate = null;
      return pair;
    }
    return flushSurrogate() + String.fromCharCode(code);
  }
  /** A high surrogate not followed by a low one stands alone (as JSON.parse keeps it). */
  function flushSurrogate(): string {
    if (highSurrogate === null) return "";
    const s = String.fromCharCode(highSurrogate);
    highSurrogate = null;
    return s;
  }

  return {
    push(chunk: string) {
      for (const c of chunk) {
        if (!started) { if (c === "{") started = true; continue; }
        switch (state) {
          case "between":
            if (c === '"') { state = "key"; key = ""; }
            break;
          case "key":
            if (escape !== null || c === "\\") key += decode(c);
            else if (c === '"') state = "colon";
            else key += c;
            break;
          case "colon":
            if (c === ":") state = "value";
            break;
          case "value":
            if (c === '"') { state = "string"; out = ""; }
            else if (!/\s/.test(c)) { state = "other"; depth = c === "{" || c === "[" ? 1 : 0; inOtherString = false; }
            break;
          case "string":
            if (escape === null && c === '"') {
              const text = out + flushSurrogate();
              out = "";
              onField(key, text, true);
              state = "between";
            } else out += decode(c);
            break;
          case "other":
            if (inOtherString) {
              if (escape !== null) escape = null;
              else if (c === "\\") escape = "\\";
              else if (c === '"') inOtherString = false;
            } else if (c === '"') inOtherString = true;
            else if (c === "{" || c === "[") depth++;
            else if (c === "}" || c === "]") { if (depth > 0) depth--; }
            else if (c === "," && depth === 0) state = "between";
            if (state === "other" && depth === 0 && !inOtherString && (c === "}" || c === "]")) state = "between";
            break;
        }
      }
      // Report what this chunk added to a string value (escapes still incomplete stay held).
      if (state === "string" && out) {
        onField(key, out, false);
        out = "";
      }
    },
  };
}
