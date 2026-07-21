import { createHash } from "crypto";

/** Tag normalization per spec: lowercase, trim, collapse whitespace, strip punctuation. */
export function normalizeTagName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** SHA-256 over whitespace-normalized text — duplicate-paste detection. */
export function sourceHash(rawSource: string): string {
  const normalized = rawSource.replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}
