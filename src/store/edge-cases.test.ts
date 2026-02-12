import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DecisionStore } from "./store.js";
import { parseDecision, serializeDecision, slugify } from "./parser.js";
import type { Decision } from "./types.js";

let tmpDir: string;
let store: DecisionStore;

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "dec_20260212_edge01",
    summary: "Test decision",
    rationale: "Testing",
    scope: ["src/**/*.ts"],
    tags: ["test"],
    author: "testuser",
    source: "cli",
    confidence: "explicit",
    status: "active",
    created: "2026-02-12T09:30:00Z",
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dm-edge-test-"));
  store = new DecisionStore(tmpDir);
  await store.init();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("Edge cases", () => {
  describe("unicode and special characters", () => {
    it("handles unicode in summary", async () => {
      const decision = makeDecision({
        summary: "Utiliser les accents: éàü and 日本語",
        id: "dec_20260212_unicode",
      });
      await store.create(decision);

      const result = await store.get("dec_20260212_unicode");
      expect(result).not.toBeNull();
      expect(result!.summary).toBe("Utiliser les accents: éàü and 日本語");
    });

    it("handles emoji in tags", async () => {
      const decision = makeDecision({
        id: "dec_20260212_emoji",
        tags: ["🔥", "performance"],
      });
      await store.create(decision);

      const result = await store.get("dec_20260212_emoji");
      expect(result!.tags).toContain("🔥");
    });

    it("handles quotes in rationale", async () => {
      const decision = makeDecision({
        id: "dec_20260212_quotes",
        rationale: 'They said "use Zod" and we agreed it\'s the best',
      });
      await store.create(decision);

      const result = await store.get("dec_20260212_quotes");
      expect(result!.rationale).toContain('"use Zod"');
    });

    it("handles multiline context", async () => {
      const decision = makeDecision({
        id: "dec_20260212_multiline",
        context:
          "Line 1 of context.\n\nLine 2 with details.\n\n- Bullet point\n- Another bullet",
      });
      await store.create(decision);

      const result = await store.get("dec_20260212_multiline");
      expect(result!.context).toContain("Line 1");
      expect(result!.context).toContain("Bullet point");
    });
  });

  describe("empty and minimal values", () => {
    it("handles empty scope array", async () => {
      const decision = makeDecision({
        id: "dec_20260212_empty_scope",
        scope: [],
      });
      await store.create(decision);

      const result = await store.get("dec_20260212_empty_scope");
      expect(result!.scope).toEqual([]);
    });

    it("handles empty tags array", async () => {
      const decision = makeDecision({
        id: "dec_20260212_empty_tags",
        tags: [],
      });
      await store.create(decision);

      const result = await store.get("dec_20260212_empty_tags");
      expect(result!.tags).toEqual([]);
    });

    it("queryByFilePath returns empty for decision with empty scope", async () => {
      await store.create(
        makeDecision({ id: "dec_empty_scope", scope: [] })
      );

      const results = await store.queryByFilePath("src/anything.ts");
      expect(results.length).toBe(0);
    });
  });

  describe("overlapping scopes", () => {
    it("matches file against multiple overlapping decision scopes", async () => {
      await store.create(
        makeDecision({
          id: "dec_broad",
          summary: "Broad scope",
          scope: ["src/**/*.ts"],
        })
      );
      await store.create(
        makeDecision({
          id: "dec_narrow",
          summary: "Narrow scope",
          scope: ["src/api/**/*.ts"],
        })
      );
      await store.create(
        makeDecision({
          id: "dec_exact",
          summary: "Exact file",
          scope: ["src/api/users.ts"],
        })
      );

      const results = await store.queryByFilePath("src/api/users.ts");
      expect(results.length).toBe(3);
    });

    it("only matches relevant scopes", async () => {
      await store.create(
        makeDecision({
          id: "dec_api",
          summary: "API scope",
          scope: ["src/api/**/*.ts"],
        })
      );
      await store.create(
        makeDecision({
          id: "dec_db",
          summary: "DB scope",
          scope: ["src/db/**/*.ts"],
        })
      );

      const results = await store.queryByFilePath("src/api/users.ts");
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("dec_api");
    });
  });

  describe("many decisions (stress)", () => {
    it("handles 50 decisions without issue", async () => {
      for (let i = 0; i < 50; i++) {
        await store.create(
          makeDecision({
            id: `dec_stress_${String(i).padStart(3, "0")}`,
            summary: `Stress test decision ${i}`,
            scope: [`src/module${i}/**/*.ts`],
            tags: [`tag${i % 5}`],
          })
        );
      }

      const all = await store.list();
      expect(all.length).toBe(50);

      const filtered = await store.list({ tags: ["tag0"] });
      expect(filtered.length).toBe(10);

      const index = await store.rebuildIndex();
      expect(index.decisions.length).toBe(50);
    });
  });

  describe("slug edge cases", () => {
    it("handles very long summaries", () => {
      const long =
        "This is an extremely long decision summary that goes on and on and on and really should be truncated at some reasonable point because file names should not be too long";
      const slug = slugify(long);
      expect(slug.length).toBeLessThanOrEqual(60);
      expect(slug.endsWith("-")).toBe(false);
    });

    it("handles summaries that are all special characters", () => {
      const slug = slugify("!@#$%^&*()");
      // All special chars get stripped, resulting in empty string — that's correct
      expect(slug).toBe("");
    });

    it("handles single-word summary", () => {
      expect(slugify("PostgreSQL")).toBe("postgresql");
    });

    it("collapses multiple hyphens", () => {
      expect(slugify("foo   ---   bar")).toBe("foo-bar");
    });
  });

  describe("parser robustness", () => {
    it("handles frontmatter-only markdown (no body)", () => {
      const md = `---
id: dec_minimal
summary: Minimal
rationale: Test
scope: []
tags: []
author: test
source: cli
confidence: explicit
status: active
created: "2026-01-01T00:00:00Z"
---
`;
      const decision = parseDecision(md);
      expect(decision.id).toBe("dec_minimal");
      expect(decision.context).toBeUndefined();
      expect(decision.consequences).toBeUndefined();
    });

    it("handles extra whitespace in body sections", () => {
      const md = `---
id: dec_ws
summary: Whitespace test
rationale: Test
scope: []
tags: []
author: test
source: cli
confidence: explicit
status: active
created: "2026-01-01T00:00:00Z"
---

## Context

   Lots of leading spaces

## Consequences

   Trailing spaces too
`;
      const decision = parseDecision(md);
      expect(decision.context).toBe("Lots of leading spaces");
      expect(decision.consequences).toBe("Trailing spaces too");
    });

    it("round-trips a decision with all fields", () => {
      const original: Decision = {
        id: "dec_roundtrip",
        summary: "Full round-trip test",
        rationale: "Testing all fields survive serialization",
        scope: ["src/**/*.ts", "lib/**/*.js"],
        tags: ["test", "roundtrip"],
        author: "tester",
        source: "conversation",
        confidence: "inferred",
        status: "active",
        created: "2026-02-12T12:00:00Z",
        updated: "2026-02-12T13:00:00Z",
        context: "Testing the parser",
        consequences: "Confidence in the parser",
      };

      const serialized = serializeDecision(original);
      const parsed = parseDecision(serialized);

      expect(parsed.id).toBe(original.id);
      expect(parsed.summary).toBe(original.summary);
      expect(parsed.rationale).toBe(original.rationale);
      expect(parsed.scope).toEqual(original.scope);
      expect(parsed.tags).toEqual(original.tags);
      expect(parsed.author).toBe(original.author);
      expect(parsed.source).toBe(original.source);
      expect(parsed.confidence).toBe(original.confidence);
      expect(parsed.status).toBe(original.status);
      expect(parsed.context).toBe(original.context);
      expect(parsed.consequences).toBe(original.consequences);
    });
  });

  describe("index integrity", () => {
    it("index reflects all decisions after multiple creates", async () => {
      await store.create(makeDecision({ id: "dec_1", summary: "First" }));
      await store.create(makeDecision({ id: "dec_2", summary: "Second" }));
      await store.create(makeDecision({ id: "dec_3", summary: "Third" }));

      const content = await fs.readFile(
        path.join(tmpDir, ".decisions", "index.json"),
        "utf-8"
      );
      const index = JSON.parse(content);
      expect(index.decisions.length).toBe(3);

      const ids = index.decisions.map((d: any) => d.id);
      expect(ids).toContain("dec_1");
      expect(ids).toContain("dec_2");
      expect(ids).toContain("dec_3");
    });

    it("rebuildIndex recovers from a corrupted index", async () => {
      await store.create(makeDecision({ id: "dec_recover" }));

      // Corrupt the index
      await fs.writeFile(
        path.join(tmpDir, ".decisions", "index.json"),
        "corrupted!"
      );

      // Rebuild should recover
      const index = await store.rebuildIndex();
      expect(index.decisions.length).toBe(1);
      expect(index.decisions[0].id).toBe("dec_recover");
    });

    it("rebuildIndex handles deleted markdown files", async () => {
      await store.create(
        makeDecision({ id: "dec_keep", summary: "Keep this" })
      );
      await store.create(
        makeDecision({ id: "dec_delete", summary: "Delete this" })
      );

      // Delete one markdown file
      const files = await fs.readdir(
        path.join(tmpDir, ".decisions", "active")
      );
      const deleteFile = files.find((f) => f.includes("delete"));
      if (deleteFile) {
        await fs.unlink(
          path.join(tmpDir, ".decisions", "active", deleteFile)
        );
      }

      const index = await store.rebuildIndex();
      expect(index.decisions.length).toBe(1);
      expect(index.decisions[0].id).toBe("dec_keep");
    });
  });
});
