// Garmin can skip the final recovery inside repeat-control blocks. Emit every
// work and recovery as a standalone step instead; yard amounts stay unchanged.
export function flattenSwimDefinition(definition) {
  return definition.split(/\n\s*\n/).map(block => {
    const lines = block.split('\n');
    const repeat = lines[0].match(/^(.*?)\s*(\d+)x$/i);
    if (!repeat) return block;
    const count = Number(repeat[2]);
    if (!(count > 0 && count <= 1000) || lines.slice(1).some(line => !line.startsWith('- '))) throw Error('Invalid swim repetition block');
    return [repeat[1].trim(), ...Array.from({length:count}, () => lines.slice(1)).flat()].filter(Boolean).join('\n');
  }).join('\n\n');
}
