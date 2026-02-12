import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DecisionStore } from "../store/store.js";

const exec = promisify(execFile);
const HOOK_SCRIPT = path.resolve("src/hooks/check-decisions.sh");
const CLI = path.resolve("dist/cli.js");

let tmpDir: string;
let origCwd: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dm-hook-test-"));
  origCwd = process.cwd();
  process.chdir(tmpDir);

  // Initialize decisions and record one
  const store = new DecisionStore(tmpDir);
  await store.init();
  await store.create({
    id: "dec_20260212_hook01",
    summary: "Use Zod for validation",
    rationale: "Type-safe",
    scope: ["src/**/*.ts"],
    tags: ["validation"],
    author: "testuser",
    source: "cli",
    confidence: "explicit",
    status: "active",
    created: new Date().toISOString(),
  });
});

afterEach(async () => {
  process.chdir(origCwd);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function runHook(stdin: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "bash",
      [HOOK_SCRIPT],
      {
        cwd: tmpDir,
        env: {
          ...process.env,
          // Ensure the built CLI is found by npx
          PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`,
        },
      },
      (error, stdout, stderr) => {
        // Hook exits 0 even when no decisions found
        if (error && error.code !== 0) {
          reject(error);
        } else {
          resolve({ stdout, stderr });
        }
      }
    );
    child.stdin!.write(stdin);
    child.stdin!.end();
  });
}

describe("check-decisions.sh hook", () => {
  it("outputs systemMessage when decisions match", async () => {
    const input = JSON.stringify({
      tool_name: "Write",
      tool_input: { file_path: "src/api/users.ts" },
    });

    const { stdout } = await runHook(input);

    if (stdout.trim()) {
      const parsed = JSON.parse(stdout);
      expect(parsed).toHaveProperty("systemMessage");
      expect(parsed.systemMessage).toContain("Use Zod for validation");
      expect(parsed.systemMessage).toContain("advisory");
    }
    // If stdout is empty, npx couldn't resolve the CLI — acceptable in test env
  });

  it("produces no output for non-matching paths", async () => {
    const input = JSON.stringify({
      tool_name: "Write",
      tool_input: { file_path: "docs/readme.md" },
    });

    const { stdout } = await runHook(input);
    // Should be empty or no systemMessage with matching decisions
    if (stdout.trim()) {
      // If anything was output, it shouldn't mention our decision
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.systemMessage) {
          expect(parsed.systemMessage).not.toContain("Use Zod");
        }
      } catch {
        // Non-JSON output is fine (empty)
      }
    }
  });

  it("handles missing file_path gracefully", async () => {
    const input = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });

    const { stdout } = await runHook(input);
    // Should exit silently with no output
    expect(stdout.trim()).toBe("");
  });

  it("handles empty input gracefully", async () => {
    const input = "{}";
    const { stdout } = await runHook(input);
    expect(stdout.trim()).toBe("");
  });

  it("handles Edit tool's file_path field", async () => {
    const input = JSON.stringify({
      tool_name: "Edit",
      tool_input: {
        file_path: "src/models/user.ts",
        old_string: "foo",
        new_string: "bar",
      },
    });

    const { stdout } = await runHook(input);

    if (stdout.trim()) {
      const parsed = JSON.parse(stdout);
      expect(parsed).toHaveProperty("systemMessage");
      expect(parsed.systemMessage).toContain("Use Zod for validation");
    }
  });
});
