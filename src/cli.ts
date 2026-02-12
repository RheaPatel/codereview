#!/usr/bin/env node

import { Command } from "commander";
import { DecisionStore } from "./store/store.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server/server.js";
import { nanoid } from "nanoid";
import fs from "node:fs/promises";
import path from "node:path";
import type { DecisionConfidence, DecisionSource, DecisionStatus } from "./store/types.js";

const program = new Command();

program
  .name("decision-memory")
  .description(
    "Capture, store, and surface architectural decisions from AI-assisted coding sessions"
  )
  .version("0.1.0");

program
  .command("init")
  .description("Initialize decision tracking in the current project")
  .action(async () => {
    const projectRoot = process.cwd();
    const store = new DecisionStore(projectRoot);
    await store.init();

    // Copy hook script
    const hookSrc = new URL("./hooks/check-decisions.sh", import.meta.url).pathname;
    const hookDir = path.join(projectRoot, ".claude", "hooks");
    await fs.mkdir(hookDir, { recursive: true });

    try {
      const hookContent = await fs.readFile(hookSrc, "utf-8");
      const hookDest = path.join(hookDir, "check-decisions.sh");
      await fs.writeFile(hookDest, hookContent, { mode: 0o755 });
    } catch {
      // Hook script not found in distribution, skip
    }

    // Copy slash command
    const cmdDir = path.join(projectRoot, ".claude", "commands");
    await fs.mkdir(cmdDir, { recursive: true });

    try {
      const templateSrc = new URL("../templates/decide.md", import.meta.url).pathname;
      const templateContent = await fs.readFile(templateSrc, "utf-8");
      await fs.writeFile(path.join(cmdDir, "decide.md"), templateContent);
    } catch {
      // Template not found in distribution, skip
    }

    console.log("Initialized decision tracking:");
    console.log("  .decisions/active/");
    console.log("  .decisions/superseded/");
    console.log("  .decisions/archived/");
    console.log("  .decisions/index.json");
    console.log("");
    console.log("Add to your Claude Code MCP config:");
    console.log("");
    console.log('  "decision-memory": {');
    console.log('    "command": "npx",');
    console.log('    "args": ["decision-memory", "serve"]');
    console.log("  }");
    console.log("");
    console.log("Or configure the PostToolUse hook in .claude/settings.json:");
    console.log("");
    console.log("  {");
    console.log('    "hooks": {');
    console.log('      "PostToolUse": [');
    console.log("        {");
    console.log('          "matcher": "Write|Edit",');
    console.log('          "command": ".claude/hooks/check-decisions.sh"');
    console.log("        }");
    console.log("      ]");
    console.log("    }");
    console.log("  }");
  });

program
  .command("check <file>")
  .description("Check if any decisions apply to a file path")
  .option("--json", "Output as JSON")
  .action(async (file: string, opts: { json?: boolean }) => {
    const store = new DecisionStore(process.cwd());
    const decisions = await store.queryByFilePath(file);

    if (opts.json) {
      console.log(JSON.stringify(decisions, null, 2));
      return;
    }

    if (decisions.length === 0) {
      console.log(`No decisions apply to ${file}`);
      return;
    }

    console.log(`${decisions.length} decision(s) apply to ${file}:\n`);
    for (const d of decisions) {
      console.log(`  [${d.id}] ${d.summary}`);
      console.log(`    Rationale: ${d.rationale}`);
      console.log(`    Scope: ${d.scope.join(", ")}`);
      console.log(`    Tags: ${d.tags.join(", ")}`);
      console.log("");
    }
  });

program
  .command("list")
  .description("List all decisions")
  .option(
    "-s, --status <status>",
    "Filter by status (active, superseded, archived)"
  )
  .option("-t, --tags <tags>", "Filter by tags (comma-separated)")
  .option("--json", "Output as JSON")
  .action(
    async (opts: { status?: string; tags?: string; json?: boolean }) => {
      const store = new DecisionStore(process.cwd());
      const decisions = await store.list({
        status: opts.status as DecisionStatus | undefined,
        tags: opts.tags?.split(",").map((t) => t.trim()),
      });

      if (opts.json) {
        console.log(JSON.stringify(decisions, null, 2));
        return;
      }

      if (decisions.length === 0) {
        console.log("No decisions found.");
        return;
      }

      console.log(`${decisions.length} decision(s):\n`);
      for (const d of decisions) {
        console.log(
          `  [${d.status.toUpperCase()}] ${d.summary} (${d.id})`
        );
        console.log(`    ${d.tags.join(", ")}`);
      }
    }
  );

program
  .command("record")
  .description("Record a new decision")
  .requiredOption("--summary <summary>", "One-line summary")
  .requiredOption("--rationale <rationale>", "Why this decision was made")
  .requiredOption(
    "--scope <scope>",
    "Comma-separated glob patterns for files"
  )
  .option("--tags <tags>", "Comma-separated tags", "")
  .option("--author <author>", "Author name", "cli-user")
  .option(
    "--confidence <confidence>",
    "Confidence level (explicit, inferred, suggested)",
    "explicit"
  )
  .option("--context <context>", "Additional context")
  .option("--consequences <consequences>", "Expected consequences")
  .action(
    async (opts: {
      summary: string;
      rationale: string;
      scope: string;
      tags: string;
      author: string;
      confidence: string;
      context?: string;
      consequences?: string;
    }) => {
      const store = new DecisionStore(process.cwd());
      await store.init();

      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
      const short = nanoid(6);
      const id = `dec_${dateStr}_${short}`;

      const decision = {
        id,
        summary: opts.summary,
        rationale: opts.rationale,
        scope: opts.scope.split(",").map((s) => s.trim()),
        tags: opts.tags
          ? opts.tags.split(",").map((t) => t.trim())
          : [],
        author: opts.author,
        source: "cli" as DecisionSource,
        confidence: opts.confidence as DecisionConfidence,
        status: "active" as DecisionStatus,
        created: now.toISOString(),
        context: opts.context,
        consequences: opts.consequences,
      };

      await store.create(decision);
      console.log(`Decision recorded: ${decision.summary}`);
      console.log(`ID: ${id}`);
    }
  );

program
  .command("serve")
  .description("Start the MCP server (for use with Claude Code)")
  .action(async () => {
    const projectRoot = process.cwd();
    const server = createServer(projectRoot);
    const transport = new StdioServerTransport();
    await server.connect(transport);
  });

program.parse();
