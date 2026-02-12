import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DecisionStore } from "./store.js";
import type { Decision } from "./types.js";

let tmpDir: string;
let store: DecisionStore;

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "dec_20260212_test01",
    summary: "Use PostgreSQL for persistence",
    rationale: "ACID compliance, JSON support, mature ecosystem",
    scope: ["src/db/**/*.ts", "src/models/**/*.ts"],
    tags: ["database", "persistence"],
    author: "rheapatel",
    source: "conversation",
    confidence: "explicit",
    status: "active",
    created: "2026-02-12T09:30:00Z",
    context: "Evaluating database options for the backend.",
    consequences: "All persistence goes through PostgreSQL.",
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "decision-memory-test-"));
  store = new DecisionStore(tmpDir);
  await store.init();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("DecisionStore", () => {
  describe("init", () => {
    it("creates .decisions directory structure", async () => {
      const dirs = ["active", "superseded", "archived"];
      for (const dir of dirs) {
        const stat = await fs.stat(
          path.join(tmpDir, ".decisions", dir)
        );
        expect(stat.isDirectory()).toBe(true);
      }
    });

    it("creates index.json", async () => {
      const content = await fs.readFile(
        path.join(tmpDir, ".decisions", "index.json"),
        "utf-8"
      );
      const index = JSON.parse(content);
      expect(index.version).toBe(1);
      expect(index.decisions).toEqual([]);
    });

    it("does not overwrite existing index.json", async () => {
      // Create a decision first
      await store.create(makeDecision());

      // Re-init should not wipe the index
      await store.init();
      const content = await fs.readFile(
        path.join(tmpDir, ".decisions", "index.json"),
        "utf-8"
      );
      const index = JSON.parse(content);
      expect(index.decisions.length).toBe(1);
    });
  });

  describe("create", () => {
    it("writes a markdown file in the correct status directory", async () => {
      await store.create(makeDecision());
      const files = await fs.readdir(
        path.join(tmpDir, ".decisions", "active")
      );
      expect(files).toContain("use-postgresql-for-persistence.md");
    });

    it("updates the index after creation", async () => {
      await store.create(makeDecision());
      const content = await fs.readFile(
        path.join(tmpDir, ".decisions", "index.json"),
        "utf-8"
      );
      const index = JSON.parse(content);
      expect(index.decisions.length).toBe(1);
      expect(index.decisions[0].id).toBe("dec_20260212_test01");
    });

    it("returns the created decision", async () => {
      const result = await store.create(makeDecision());
      expect(result.id).toBe("dec_20260212_test01");
      expect(result.summary).toBe("Use PostgreSQL for persistence");
    });
  });

  describe("get", () => {
    it("retrieves a decision by ID", async () => {
      await store.create(makeDecision());
      const result = await store.get("dec_20260212_test01");
      expect(result).not.toBeNull();
      expect(result!.summary).toBe("Use PostgreSQL for persistence");
    });

    it("returns null for non-existent ID", async () => {
      const result = await store.get("dec_nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("list", () => {
    it("lists all decisions", async () => {
      await store.create(makeDecision());
      await store.create(
        makeDecision({
          id: "dec_20260212_test02",
          summary: "Use Redis for caching",
          tags: ["caching"],
          scope: ["src/cache/**/*.ts"],
        })
      );

      const results = await store.list();
      expect(results.length).toBe(2);
    });

    it("filters by status", async () => {
      await store.create(makeDecision());
      await store.create(
        makeDecision({
          id: "dec_20260212_test02",
          summary: "Old approach",
          status: "superseded",
        })
      );

      const active = await store.list({ status: "active" });
      expect(active.length).toBe(1);
      expect(active[0].status).toBe("active");
    });

    it("filters by tags", async () => {
      await store.create(makeDecision());
      await store.create(
        makeDecision({
          id: "dec_20260212_test02",
          summary: "Use Redis for caching",
          tags: ["caching"],
          scope: ["src/cache/**/*.ts"],
        })
      );

      const results = await store.list({ tags: ["caching"] });
      expect(results.length).toBe(1);
      expect(results[0].tags).toContain("caching");
    });

    it("returns results sorted by created date descending", async () => {
      await store.create(
        makeDecision({
          id: "dec_old",
          summary: "Old decision",
          created: "2026-01-01T00:00:00Z",
        })
      );
      await store.create(
        makeDecision({
          id: "dec_new",
          summary: "New decision",
          created: "2026-02-12T00:00:00Z",
        })
      );

      const results = await store.list();
      expect(results[0].id).toBe("dec_new");
      expect(results[1].id).toBe("dec_old");
    });
  });

  describe("queryByFilePath", () => {
    it("matches files against decision scopes", async () => {
      await store.create(makeDecision());

      const results = await store.queryByFilePath("src/db/connection.ts");
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("dec_20260212_test01");
    });

    it("returns empty for non-matching paths", async () => {
      await store.create(makeDecision());

      const results = await store.queryByFilePath("tests/unit/foo.test.ts");
      expect(results.length).toBe(0);
    });

    it("handles absolute paths by making them relative", async () => {
      await store.create(makeDecision());

      const absPath = path.join(tmpDir, "src/db/connection.ts");
      const results = await store.queryByFilePath(absPath);
      expect(results.length).toBe(1);
    });

    it("matches multiple decisions for the same file", async () => {
      await store.create(makeDecision());
      await store.create(
        makeDecision({
          id: "dec_20260212_test02",
          summary: "Use Drizzle ORM",
          scope: ["src/**/*.ts"],
          tags: ["orm"],
        })
      );

      const results = await store.queryByFilePath("src/db/connection.ts");
      expect(results.length).toBe(2);
    });
  });

  describe("rebuildIndex", () => {
    it("regenerates index from markdown files", async () => {
      await store.create(makeDecision());
      await store.create(
        makeDecision({
          id: "dec_20260212_test02",
          summary: "Use Redis for caching",
          scope: ["src/cache/**/*.ts"],
        })
      );

      const index = await store.rebuildIndex();
      expect(index.decisions.length).toBe(2);
      expect(index.version).toBe(1);
    });
  });
});
