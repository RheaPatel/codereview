import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const exec = promisify(execFile);
const CLI = path.resolve("dist/cli.js");

let tmpDir: string;
let origCwd: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dm-cli-test-"));
  origCwd = process.cwd();
});

afterEach(async () => {
  process.chdir(origCwd);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function run(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
  return exec("node", [CLI, ...args], { cwd: cwd ?? tmpDir });
}

describe("CLI", () => {
  describe("init", () => {
    it("creates .decisions directory structure", async () => {
      await run(["init"]);

      const dirs = ["active", "superseded", "archived"];
      for (const dir of dirs) {
        const stat = await fs.stat(path.join(tmpDir, ".decisions", dir));
        expect(stat.isDirectory()).toBe(true);
      }
    });

    it("creates index.json", async () => {
      await run(["init"]);

      const content = await fs.readFile(
        path.join(tmpDir, ".decisions", "index.json"),
        "utf-8"
      );
      const index = JSON.parse(content);
      expect(index.version).toBe(1);
      expect(index.decisions).toEqual([]);
    });

    it("prints setup instructions", async () => {
      const { stdout } = await run(["init"]);
      expect(stdout).toContain("Initialized decision tracking");
      expect(stdout).toContain("decision-memory");
    });

    it("is idempotent", async () => {
      await run(["init"]);
      await run(["init"]);

      const stat = await fs.stat(
        path.join(tmpDir, ".decisions", "active")
      );
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe("record", () => {
    it("creates a decision markdown file", async () => {
      await run(["init"]);
      const { stdout } = await run([
        "record",
        "--summary",
        "Use Zod for validation",
        "--rationale",
        "Type-safe and composable",
        "--scope",
        "src/**/*.ts",
        "--tags",
        "validation,schema",
        "--author",
        "testuser",
      ]);

      expect(stdout).toContain("Decision recorded");
      expect(stdout).toContain("Use Zod for validation");

      const files = await fs.readdir(
        path.join(tmpDir, ".decisions", "active")
      );
      expect(files.length).toBe(1);
      expect(files[0]).toContain("use-zod-for-validation");
    });

    it("writes correct frontmatter", async () => {
      await run(["init"]);
      await run([
        "record",
        "--summary",
        "Use PostgreSQL",
        "--rationale",
        "ACID compliance",
        "--scope",
        "src/db/**/*.ts",
        "--tags",
        "database",
      ]);

      const files = await fs.readdir(
        path.join(tmpDir, ".decisions", "active")
      );
      const content = await fs.readFile(
        path.join(tmpDir, ".decisions", "active", files[0]),
        "utf-8"
      );
      expect(content).toContain("summary: Use PostgreSQL");
      expect(content).toContain("rationale: ACID compliance");
      expect(content).toContain("source: cli");
    });

    it("records with context and consequences", async () => {
      await run(["init"]);
      await run([
        "record",
        "--summary",
        "Use REST API",
        "--rationale",
        "Simplicity",
        "--scope",
        "src/api/**/*.ts",
        "--context",
        "Evaluated GraphQL and REST",
        "--consequences",
        "Standard endpoints",
      ]);

      const files = await fs.readdir(
        path.join(tmpDir, ".decisions", "active")
      );
      const content = await fs.readFile(
        path.join(tmpDir, ".decisions", "active", files[0]),
        "utf-8"
      );
      expect(content).toContain("## Context");
      expect(content).toContain("Evaluated GraphQL and REST");
      expect(content).toContain("## Consequences");
      expect(content).toContain("Standard endpoints");
    });

    it("fails without required options", async () => {
      await run(["init"]);
      try {
        await run(["record", "--summary", "Missing fields"]);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.stderr).toContain("required");
      }
    });
  });

  describe("check", () => {
    it("finds matching decisions", async () => {
      await run(["init"]);
      await run([
        "record",
        "--summary",
        "Use Zod for validation",
        "--rationale",
        "Type-safe",
        "--scope",
        "src/**/*.ts",
        "--tags",
        "validation",
      ]);

      const { stdout } = await run(["check", "src/api/users.ts"]);
      expect(stdout).toContain("1 decision(s)");
      expect(stdout).toContain("Use Zod for validation");
    });

    it("reports no matches for unrelated files", async () => {
      await run(["init"]);
      await run([
        "record",
        "--summary",
        "Use Zod",
        "--rationale",
        "Type-safe",
        "--scope",
        "src/**/*.ts",
        "--tags",
        "validation",
      ]);

      const { stdout } = await run(["check", "docs/readme.md"]);
      expect(stdout).toContain("No decisions apply");
    });

    it("outputs JSON with --json flag", async () => {
      await run(["init"]);
      await run([
        "record",
        "--summary",
        "Use Zod",
        "--rationale",
        "Type-safe",
        "--scope",
        "src/**/*.ts",
        "--tags",
        "validation",
      ]);

      const { stdout } = await run(["check", "src/foo.ts", "--json"]);
      const parsed = JSON.parse(stdout);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
      expect(parsed[0].summary).toBe("Use Zod");
    });

    it("returns empty JSON array for no matches", async () => {
      await run(["init"]);

      const { stdout } = await run(["check", "nope.txt", "--json"]);
      const parsed = JSON.parse(stdout);
      expect(parsed).toEqual([]);
    });
  });

  describe("list", () => {
    it("lists all decisions", async () => {
      await run(["init"]);
      await run([
        "record",
        "--summary",
        "Decision A",
        "--rationale",
        "Reason A",
        "--scope",
        "src/**/*.ts",
      ]);
      await run([
        "record",
        "--summary",
        "Decision B",
        "--rationale",
        "Reason B",
        "--scope",
        "lib/**/*.ts",
      ]);

      const { stdout } = await run(["list"]);
      expect(stdout).toContain("2 decision(s)");
      expect(stdout).toContain("Decision A");
      expect(stdout).toContain("Decision B");
    });

    it("filters by tags", async () => {
      await run(["init"]);
      await run([
        "record",
        "--summary",
        "Use Zod",
        "--rationale",
        "Validation",
        "--scope",
        "src/**/*.ts",
        "--tags",
        "validation",
      ]);
      await run([
        "record",
        "--summary",
        "Use Postgres",
        "--rationale",
        "Database",
        "--scope",
        "src/db/**/*.ts",
        "--tags",
        "database",
      ]);

      const { stdout } = await run(["list", "--tags", "database"]);
      expect(stdout).toContain("1 decision(s)");
      expect(stdout).toContain("Use Postgres");
      expect(stdout).not.toContain("Use Zod");
    });

    it("outputs JSON with --json flag", async () => {
      await run(["init"]);
      await run([
        "record",
        "--summary",
        "Use Zod",
        "--rationale",
        "Validation",
        "--scope",
        "src/**/*.ts",
      ]);

      const { stdout } = await run(["list", "--json"]);
      const parsed = JSON.parse(stdout);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
    });

    it("reports no decisions when empty", async () => {
      await run(["init"]);
      const { stdout } = await run(["list"]);
      expect(stdout).toContain("No decisions found");
    });
  });
});
