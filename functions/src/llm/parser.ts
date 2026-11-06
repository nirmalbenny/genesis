// Incremental parser for the strict <plan>/<file>/<delete> output format.
// Tags can be split across stream chunks, so text that might be the start of a tag is held back.

export type ParseEvent =
  | { type: "token"; text: string; path: string | null }
  | { type: "file_start"; path: string }
  | { type: "file_end"; path: string; content: string }
  | { type: "delete"; path: string }
  | { type: "refuse"; reason: string };

const FILE_CLOSE = "</file>";
const TAG = /^<(?:\/?plan>|\/?refuse>|file\s+path="([^"]*)"\s*>|delete\s+path="([^"]*)"\s*\/>)/;
const MAX_TAG_LEN = 300;
// The model occasionally leaks a tool-call closing tag as the last line of a file; it is never valid source.
const STRAY_TRAILER = /\r?\n?<\/parameter>\s*$/;

export function createParser(emit: (e: ParseEvent) => void) {
  let buf = "";
  let filePath: string | null = null;
  let content = "";
  let atFileStart = false;
  let refuseText: string | null = null; // non-null while inside <refuse>; its text is never streamed to the client

  const outsideText = (text: string) => {
    if (refuseText !== null) refuseText += text;
    else emit({ type: "token", text, path: null });
  };

  function pushFileText(text: string) {
    if (atFileStart) {
      text = text.replace(/^\r?\n/, "");
      if (text) atFileStart = false;
    }
    if (!text) return;
    content += text;
    emit({ type: "token", text, path: filePath });
  }

  function step(): boolean {
    if (filePath !== null) {
      const close = buf.indexOf(FILE_CLOSE);
      if (close >= 0) {
        pushFileText(buf.slice(0, close));
        buf = buf.slice(close + FILE_CLOSE.length);
        emit({ type: "file_end", path: filePath, content: content.replace(STRAY_TRAILER, "").replace(/\r?\n$/, "") });
        filePath = null;
        return true;
      }
      // Hold back a trailing partial "</file>" until more text arrives.
      let keep = 0;
      for (let n = Math.min(FILE_CLOSE.length - 1, buf.length); n > 0; n--) {
        if (FILE_CLOSE.startsWith(buf.slice(buf.length - n))) { keep = n; break; }
      }
      pushFileText(buf.slice(0, buf.length - keep));
      buf = buf.slice(buf.length - keep);
      return false;
    }

    const lt = buf.indexOf("<");
    if (lt < 0) {
      if (buf) outsideText(buf);
      buf = "";
      return false;
    }
    if (lt > 0) {
      outsideText(buf.slice(0, lt));
      buf = buf.slice(lt);
    }
    const m = TAG.exec(buf);
    if (m) {
      buf = buf.slice(m[0].length);
      if (m[1] !== undefined) {
        filePath = m[1];
        content = "";
        atFileStart = true;
        emit({ type: "file_start", path: filePath });
      } else if (m[2] !== undefined) {
        emit({ type: "delete", path: m[2] });
      } else if (m[0] === "<refuse>") {
        refuseText = "";
      } else if (m[0] === "</refuse>" && refuseText !== null) {
        emit({ type: "refuse", reason: refuseText.trim() });
        refuseText = null;
      }
      return true;
    }
    // Incomplete tag: wait for more input. Otherwise treat "<" as plain text.
    if (!buf.includes(">") && buf.length < MAX_TAG_LEN) return false;
    outsideText("<");
    buf = buf.slice(1);
    return true;
  }

  return {
    push(text: string) {
      buf += text;
      while (step());
    },
    /** Flush at end of stream. Returns the path of a <file> that was never closed, if any. */
    end(): string | null {
      if (filePath !== null) {
        pushFileText(buf);
        buf = "";
        return filePath;
      }
      if (buf) outsideText(buf);
      buf = "";
      if (refuseText !== null) emit({ type: "refuse", reason: refuseText.trim() });
      return null;
    },
  };
}
