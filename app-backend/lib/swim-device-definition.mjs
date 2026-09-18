// Garmin can skip the final recovery inside repeat-control blocks. Emit every
// work and recovery as a standalone step instead; yard amounts stay unchanged.
export function flattenSwimDefinition(definition) {
  const output = [];
  let count = 0,
    steps = [];
  const flush = () => {
    if (!count) return;
    if (!steps.length || count > 1000 || output.length + count * steps.length > 5000)
      throw Error("Invalid swim repetition block");
    for (let i = 0; i < count; i++) output.push(...steps);
    count = 0;
    steps = [];
  };
  for (const source of definition.split(/\r?\n/)) {
    const line = source.trim(),
      repeat = line.match(/^(.*?)\s*(\d+)x$/i);
    if (repeat) {
      flush();
      count = Number(repeat[2]);
      if (!count) throw Error("Invalid swim repetition block");
      if (repeat[1].trim()) output.push(repeat[1].trim());
    } else if (count && line.startsWith("- ")) steps.push(line);
    else {
      flush();
      output.push(line);
    }
  }
  flush();
  return output.join("\n");
}

export function swimCalendarDefinition(description) {
  const text = description
    .replace(
      /^(\s*-\s*.*?)\b(\d+(?:\.\d+)?)\s*(?:yds?|yards?|y|mtr|meters?|metres?)\b/gim,
      "$1$2mtr"
    )
    .replace(/\/(?:100y|100yd|100m)(?=\s*Pace)/gi, "")
    .replace(/^Pool length:\s*(\d+(?:\.\d+)?)[my]\s*$/gim, "Pool length: $1y");
  return flattenSwimDefinition(/^Pool length:/im.test(text) ? text : `Pool length: 25y\n\n${text}`);
}
