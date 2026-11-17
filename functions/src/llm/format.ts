// The tags of Genesis's model format, in one place: the prompt, the parser, the files sent as context and the
// trace redaction all use them.
// Measured 2026-11-18 (4 builds per arm, production prompt): namespaced names (genesis-file, …) made Claude leak
// tool-call markup into files more often (10/19 files with the read_files tool attached, 6/19 without) than these
// generic ones (6/18 with the tool, 0/18 without), so the generic names stay. See docs/ARCHITECTURE.md §6.

export const TAGS = {
  plan: "plan",
  file: "file",
  delete: "delete",
  refuse: "refuse",
} as const;

/** A file as the model reads it (context, read_files) and writes it. */
export const fileBlock = (path: string, content: string) => `<${TAGS.file} path="${path}">\n${content}\n</${TAGS.file}>`;
