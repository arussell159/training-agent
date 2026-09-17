import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// The user's supplied prompt is a deployed server resource, not conversation
// history or a browser preference. Send it unchanged on every Responses request.
export async function readCoachInstructions() {
  const text = await readFile(new URL("../coach/PROJECT_INSTRUCTIONS.md", import.meta.url), "utf8");
  if (!text.startsWith("# AI Coach Instructions") || text.length > 60000)
    throw new Error("The persistent coach instructions are missing or invalid.");
  return { text, revision: createHash("sha256").update(text).digest("hex") };
}
