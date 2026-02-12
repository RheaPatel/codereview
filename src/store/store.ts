import fs from "node:fs/promises";
import path from "node:path";
import { minimatch } from "minimatch";
import type {
  Decision,
  DecisionIndex,
  DecisionStatus,
  QueryOptions,
} from "./types.js";
import { parseDecision, serializeDecision, slugify } from "./parser.js";
import { rebuildIndex } from "./index-builder.js";

const DECISIONS_DIR = ".decisions";
const STATUS_DIRS: DecisionStatus[] = ["active", "superseded", "archived"];

export class DecisionStore {
  private root: string;
  private decisionsDir: string;

  constructor(projectRoot: string) {
    this.root = projectRoot;
    this.decisionsDir = path.join(projectRoot, DECISIONS_DIR);
  }

  async init(): Promise<void> {
    for (const dir of STATUS_DIRS) {
      await fs.mkdir(path.join(this.decisionsDir, dir), { recursive: true });
    }

    const indexPath = path.join(this.decisionsDir, "index.json");
    try {
      await fs.access(indexPath);
    } catch {
      const emptyIndex: DecisionIndex = {
        version: 1,
        updated: new Date().toISOString(),
        decisions: [],
      };
      await fs.writeFile(indexPath, JSON.stringify(emptyIndex, null, 2));
    }
  }

  async create(decision: Decision): Promise<Decision> {
    const statusDir = path.join(this.decisionsDir, decision.status);
    await fs.mkdir(statusDir, { recursive: true });

    const slug = slugify(decision.summary);
    const filename = `${slug}.md`;
    const filePath = path.join(statusDir, filename);

    const markdown = serializeDecision(decision);
    await fs.writeFile(filePath, markdown);

    await this.rebuildIndex();
    return decision;
  }

  async get(id: string): Promise<Decision | null> {
    for (const status of STATUS_DIRS) {
      const dir = path.join(this.decisionsDir, status);
      let files: string[];
      try {
        files = await fs.readdir(dir);
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const content = await fs.readFile(path.join(dir, file), "utf-8");
        const decision = parseDecision(content);
        if (decision.id === id) {
          return decision;
        }
      }
    }
    return null;
  }

  async list(options: QueryOptions = {}): Promise<Decision[]> {
    const results: Decision[] = [];
    const statusDirs = options.status ? [options.status] : STATUS_DIRS;

    for (const status of statusDirs) {
      const dir = path.join(this.decisionsDir, status);
      let files: string[];
      try {
        files = await fs.readdir(dir);
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const content = await fs.readFile(path.join(dir, file), "utf-8");
        const decision = parseDecision(content);

        if (options.tags && options.tags.length > 0) {
          const hasTag = options.tags.some((t) => decision.tags.includes(t));
          if (!hasTag) continue;
        }

        if (options.scope) {
          const matchesScope = decision.scope.some((pattern) =>
            minimatch(options.scope!, pattern)
          );
          if (!matchesScope) continue;
        }

        results.push(decision);
      }
    }

    return results.sort(
      (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()
    );
  }

  async queryByFilePath(filePath: string): Promise<Decision[]> {
    const relativePath = path.isAbsolute(filePath)
      ? path.relative(this.root, filePath)
      : filePath;

    return this.list({ scope: relativePath, status: "active" });
  }

  async rebuildIndex(): Promise<DecisionIndex> {
    return rebuildIndex(this.decisionsDir);
  }

  get projectRoot(): string {
    return this.root;
  }

  get decisionsPath(): string {
    return this.decisionsDir;
  }
}
