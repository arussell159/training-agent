import fs from "node:fs/promises"

export async function loadCoachingInstructions() {
  return fs.readFile(new URL("../vendor/open-triathlon-coach/API instructions.md", import.meta.url), "utf8")
}
