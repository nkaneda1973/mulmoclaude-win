// Minimal `description:` reader for a SKILL.md YAML frontmatter envelope.
//
// The host (MulmoClaude) has a js-yaml-based SKILL.md parser, but @mulmoclaude/core
// deliberately carries no YAML dependency and export only needs the single
// `description` scalar for the registry meta.json (best-effort — it defaults to
// "" when absent). A full YAML parse would be overkill here, so we scan the
// frontmatter envelope for the first `description:` line. Block scalars
// (`description: |`) aren't expanded — they yield "" rather than a stray
// indicator character; skill descriptions are single-line in practice.

const FENCE = "---";
const KEY = "description:";
const BLOCK_SCALAR_INDICATORS = new Set(["|", ">", "|-", ">-"]);

function stripQuotes(value: string): string {
  const [first] = value;
  const last = value.at(-1);
  if (value.length >= 2 && ((first === '"' && last === '"') || (first === "'" && last === "'"))) return value.slice(1, -1);
  return value;
}

/** Extract the frontmatter `description` from raw SKILL.md text. Returns "" when
 *  there's no `---` envelope, no `description:` key, or the value is a block
 *  scalar indicator. */
export function parseSkillDescription(raw: string): string {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== FENCE) return "";
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === FENCE) return ""; // end of envelope, key not found
    if (!line.startsWith(KEY)) continue;
    const value = line.slice(KEY.length).trim();
    if (value === "" || BLOCK_SCALAR_INDICATORS.has(value)) return "";
    return stripQuotes(value);
  }
  return "";
}
