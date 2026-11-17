import crypto from "node:crypto";

/** Content address of a file: hex SHA-256 of its UTF-8 text. */
export const contentHash = (content: string) => crypto.createHash("sha256").update(content).digest("hex");
