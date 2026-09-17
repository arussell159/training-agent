// Presentation only: saved report content and its source evidence remain unchanged.
export function reportLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => {
      const plain = line
        .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|>\s*)/, "")
        .replace(/^\s*(?:---+|\*\*\*+|___+|```.*)\s*$/, "")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/\*\*|__|`/g, "")
        .trim();
      const field = plain.match(/^([^:\n]{1,100}:)(?:\s|$)/);
      return { label: field?.[1] || "", text: field ? plain.slice(field[1].length) : plain };
    });
}
