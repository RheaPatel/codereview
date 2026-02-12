import fs from "node:fs/promises";
import path from "node:path";
import { parseDecision } from "./parser.js";
import type { DecisionIndex, DecisionIndexEntry, DecisionStatus } from "./types.js";

const STATUS_DIRS: DecisionStatus[] = ["active", "superseded", "archived"];

export async function rebuildIndex(decisionsDir: string): Promise<DecisionIndex> {
  const entries: DecisionIndexEntry[] = [];

  for (const status of STATUS_DIRS) {
    const dir = path.join(decisionsDir, status);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const filePath = path.join(dir, file);
      const content = await fs.readFile(filePath, "utf-8");
      const decision = parseDecision(content);

      entries.push({
        id: decision.id,
        summary: decision.summary,
        scope: decision.scope,
        tags: decision.tags,
        status: decision.status,
        created: decision.created,
        file: `${status}/${file}`,
      });
    }
  }

  entries.sort(
    (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()
  );

  const index: DecisionIndex = {
    version: 1,
    updated: new Date().toISOString(),
    decisions: entries,
  };

  await fs.writeFile(
    path.join(decisionsDir, "index.json"),
    JSON.stringify(index, null, 2)
  );

  return index;
}
