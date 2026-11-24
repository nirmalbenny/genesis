import { createHash } from "node:crypto";
import { RUBRIC, SECURITY } from "./grade";
import { GUIDES } from "./guides";
import { planRequest } from "./plan";
import { buildSystemPrompt, uiGuide, type Ui } from "./prompt";
import { buildTools } from "./tools";

/**
 * What a variant build was given, so any score can be tied to the exact text that produced it: the guides and UI guide
 * sent, and a short content hash of every text involved (the build prompt, each guide, the UI guide, the build tools,
 * the planner's instructions, the quality rubric and the security brief). Hashes, not the texts: a hash changes
 * whenever its text does, and the text itself is in the repository at the commit with that content.
 */

/** The first 12 hex digits of the text's SHA-256: enough to tell versions apart. */
export const hashText = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 12);

export type BuildContext = {
  guides: string[];
  ui: Ui;
  contextTools: boolean;
  hashes: {
    buildPrompt: string;
    guides: Record<string, string>;
    uiGuide: string;
    buildTools: string;
    planner: string;
    rubric: string;
    security: string;
  };
};

export function describeContext(input: { guides: string[]; ui: Ui; contextTools: boolean }): BuildContext {
  const guideText = (id: string) => GUIDES.find((g) => g.id === id)?.text ?? "";
  return {
    guides: input.guides,
    ui: input.ui,
    contextTools: input.contextTools,
    hashes: {
      buildPrompt: hashText(buildSystemPrompt()),
      guides: Object.fromEntries(input.guides.map((id) => [id, hashText(guideText(id))])),
      uiGuide: hashText(uiGuide(input.ui)),
      buildTools: hashText(JSON.stringify(buildTools(input.contextTools))),
      planner: hashText(String(planRequest("", "").system)),
      rubric: hashText(RUBRIC),
      security: hashText(SECURITY),
    },
  };
}
