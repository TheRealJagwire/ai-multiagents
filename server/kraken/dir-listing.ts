// Powers the spawn modal's directory autocomplete — lists directories under
// a prefix's parent that start with its final path segment.

import { basename, dirname, join } from "jsr:@std/path";

const MAX_RESULTS = 20;

// Never throws: a bad or inaccessible path just yields no suggestions
// rather than surfacing a filesystem error while the user is mid-keystroke.
export async function listDirectories(prefix: string): Promise<string[]> {
  if (!prefix || !prefix.startsWith("/")) return [];

  const endsWithSlash = prefix.endsWith("/");
  const parent = endsWithSlash ? (prefix.slice(0, -1) || "/") : dirname(prefix);
  const partial = endsWithSlash ? "" : basename(prefix);

  const results: string[] = [];
  try {
    for await (const entry of Deno.readDir(parent)) {
      if (!entry.isDirectory) continue;
      if (entry.name.startsWith(".") && !partial.startsWith(".")) continue;
      if (!entry.name.startsWith(partial)) continue;
      results.push(join(parent, entry.name));
      if (results.length >= MAX_RESULTS) break;
    }
  } catch {
    return [];
  }
  return results.sort();
}
