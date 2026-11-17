// Incremental parser for the strict plan / file / delete / refuse output format (tag names in ./format).
// Tags can be split across stream chunks, so text that might be the start of a tag is held back.
// It also repairs the model's known slips, reporting each one as a `fixup` event:
// - missing_close: a file not closed before the next tag (or at the natural end of the output);
// - tool_markup: lines of leaked tool-call markup (`</parameter>`, `</invoke>`, …) inside a file;
// - fence: a whole file wrapped in a markdown code fence.

import { TAGS } from "./format";

export type Fixup = "missing_close" | "tool_markup" | "fence";

export type ParseEvent =
  | { type: "token"; text: string; path: string | null }
  | { type: "file_start"; path: string }
  | { type: "file_end"; path: string; content: string }
  | { type: "delete"; path: string }
  | { type: "refuse"; reason: string }
  | { type: "fixup"; path: string; fix: Fixup };

const { plan: PLAN, file: FILE, delete: DELETE, refuse: REFUSE } = TAGS;
const FILE_CLOSE = `</${FILE}>`;
const ATTR = String.raw`path\s*=\s*(?:"([^"]*)"|'([^']*)')`;
/** A complete tag at the start of the buffer. Stray closes of a file or delete outside a file are swallowed. */
const TAG = new RegExp(
  String.raw`^<(?:\/?${PLAN}>|\/?${REFUSE}>|${FILE}\s+${ATTR}\s*>|${DELETE}\s+${ATTR}\s*\/?>|\/${DELETE}>|\/${FILE}>)`,
);
const MAX_TAG_LEN = 300;
/**
 * Inside a file, a new file or delete tag at the start of a line means the model forgot to close the file. Only
 * those two, and only at a line start with a path: the generic names can appear in source (`<file-upload>`, an XML
 * string), and a line starting with `<file path=` can't.
 */
const NEXT_OP = new RegExp(String.raw`(?:^|\n)<(?:${FILE}|${DELETE})\s+path\s*=`, "g");
/** Starts held back at the end of a chunk until it's clear whether they begin the close or a NEXT_OP tag. */
const HELD = [FILE_CLOSE, `<${FILE} `, `<${DELETE} `];
const TAG_STARTS = [`<${PLAN}>`, `</${PLAN}>`, `<${REFUSE}>`, `</${REFUSE}>`, `<${FILE} `, `<${DELETE} `, FILE_CLOSE, `</${DELETE}>`];
/** True for the held-back start of a tag ("<fi", '<file path="src/A'): a cut-off tag, not text. */
const isPartialTag = (s: string) => TAG_STARTS.some((t) => t.startsWith(s) || s.startsWith(t));

// Tool-call markup the model occasionally leaks into a file (seen: a parameter close, then an invoke close, as
// the last lines). A whole line of it is never valid source; it is removed wherever it appears.
const TOOL_LINE = /^[ \t]*<\/?(?:[a-z]+:)?(?:parameter|invoke|function_calls)(?=[\s>])[^>\n]*>[ \t]*(?:\r?\n|$)/gm;
const TOOL_TRAILER = /(?:\s*<\/(?:[a-z]+:)?(?:parameter|invoke|function_calls)>)+\s*$/;
const FENCED = /^\s*```[\w.+-]*[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```\s*$/;

/** The file's content with known slips removed, and which repairs were made. */
export function cleanContent(raw: string): { content: string; fixes: Fixup[] } {
  const fixes: Fixup[] = [];
  let s = raw.replace(TOOL_LINE, "").replace(TOOL_TRAILER, "");
  if (s !== raw) fixes.push("tool_markup");
  const fenced = FENCED.exec(s);
  if (fenced) {
    s = fenced[1];
    fixes.push("fence");
  }
  return { content: s.replace(/\r?\n$/, ""), fixes };
}

export function createParser(emit: (e: ParseEvent) => void) {
  let buf = "";
  let filePath: string | null = null;
  let content = "";
  let atFileStart = false;
  let refuseText: string | null = null; // non-null while inside the refuse tag; its text is never streamed to the client

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

  function closeFile(fixes: Fixup[] = []) {
    const path = filePath!;
    const cleaned = cleanContent(content);
    for (const fix of [...fixes, ...cleaned.fixes]) emit({ type: "fixup", path, fix });
    emit({ type: "file_end", path, content: cleaned.content });
    filePath = null;
    content = "";
  }

  function step(): boolean {
    if (filePath !== null) {
      const close = buf.indexOf(FILE_CLOSE);
      // A line start: the start of the file or a newline already in the content.
      const atLineStart = content === "" || content.endsWith("\n");
      let nextAt = -1;
      for (const m of buf.matchAll(NEXT_OP)) {
        const newline = m[0].startsWith("\n");
        if (newline || atLineStart) { nextAt = m.index + (newline ? 1 : 0); break; }
      }
      if (close >= 0 && (nextAt < 0 || close < nextAt)) {
        pushFileText(buf.slice(0, close));
        buf = buf.slice(close + FILE_CLOSE.length);
        closeFile();
        return true;
      }
      if (nextAt >= 0) {
        pushFileText(buf.slice(0, nextAt));
        buf = buf.slice(nextAt);
        closeFile(["missing_close"]); // the tag stays in the buffer and is parsed outside the file
        return true;
      }
      // Hold back a trailing "<…" that could still become the close or a NEXT_OP tag (until its "=" arrives).
      const lt = buf.lastIndexOf("<");
      const tail = lt >= 0 ? buf.slice(lt) : "";
      const undecided = (t: string) => t.startsWith(tail) || (tail.startsWith(t) && t !== FILE_CLOSE && !tail.includes("=") && tail.length < 40);
      let keep = tail && HELD.some(undecided) ? tail.length : 0;
      if (atFileStart && buf === "\r") keep = 1; // the first half of the CRLF after the opening tag
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
      const file = m[1] ?? m[2];
      const del = m[3] ?? m[4];
      if (file !== undefined) {
        filePath = file;
        content = "";
        atFileStart = true;
        emit({ type: "file_start", path: filePath });
      } else if (del !== undefined) {
        emit({ type: "delete", path: del });
      } else if (m[0] === `<${REFUSE}>`) {
        refuseText = "";
      } else if (m[0] === `</${REFUSE}>` && refuseText !== null) {
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
    /**
     * Drops a file that is still open (the model called a tool mid-file) and returns its path, so the next
     * turn's text starts outside any file. Null when no file is open.
     */
    discardOpenFile(): string | null {
      if (filePath === null) return null;
      const path = filePath;
      filePath = null;
      content = "";
      buf = "";
      return path;
    },
    /**
     * Flush at end of stream. A file still open is kept (as a missing_close repair) only when the output ended
     * `complete`ly (the model finished its turn); otherwise it was cut off and its path is returned.
     */
    end({ complete = false }: { complete?: boolean } = {}): string | null {
      if (filePath !== null) {
        pushFileText(buf);
        buf = "";
        if (complete) {
          closeFile(["missing_close"]);
          return null;
        }
        return filePath;
      }
      if (buf && !isPartialTag(buf)) outsideText(buf); // a stream cut off mid-tag leaves half a tag behind
      buf = "";
      if (refuseText !== null) emit({ type: "refuse", reason: refuseText.trim() });
      return null;
    },
  };
}
