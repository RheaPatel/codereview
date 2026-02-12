import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DecisionStore } from "../store/store.js";
import type { DecisionConfidence, DecisionSource, DecisionStatus } from "../store/types.js";
import { nanoid } from "nanoid";

export function createServer(projectRoot: string): McpServer {
  const store = new DecisionStore(projectRoot);

  const server = new McpServer({
    name: "decision-memory",
    version: "0.1.0",
  });

  server.tool(
    "query_decisions",
    "Find decisions relevant to a file path or topic. Use this before writing or editing files to check if any architectural decisions apply.",
    {
      file_path: z
        .string()
        .optional()
        .describe("File path to check against decision scopes"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Filter by tags (e.g. ['validation', 'auth'])"),
    },
    async ({ file_path, tags }) => {
      await store.init();
      let decisions;

      if (file_path) {
        decisions = await store.queryByFilePath(file_path);
      } else {
        decisions = await store.list({ status: "active", tags });
      }

      if (decisions.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No relevant decisions found.",
            },
          ],
        };
      }

      const summaries = decisions.map((d) => {
        const age = getRelativeTime(d.created);
        return `- **${d.summary}** (${age})\n  Rationale: ${d.rationale}\n  Scope: ${d.scope.join(", ")}\n  Tags: ${d.tags.join(", ")}\n  ID: ${d.id}`;
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${decisions.length} relevant decision(s):\n\n${summaries.join("\n\n")}`,
          },
        ],
      };
    }
  );

  server.tool(
    "record_decision",
    "Record an architectural decision. Call this when a significant technical choice is made during a conversation.",
    {
      summary: z.string().describe("One-line summary of the decision"),
      rationale: z.string().describe("Why this decision was made"),
      scope: z
        .array(z.string())
        .describe("Glob patterns for files this applies to (e.g. ['src/**/*.ts'])"),
      tags: z.array(z.string()).describe("Categorization tags"),
      author: z.string().default("claude").describe("Who made the decision"),
      context: z
        .string()
        .optional()
        .describe("Additional context about the decision"),
      consequences: z
        .string()
        .optional()
        .describe("Expected consequences of the decision"),
      confidence: z
        .enum(["explicit", "inferred", "suggested"])
        .default("explicit")
        .describe("How confident we are this is a deliberate decision"),
    },
    async ({ summary, rationale, scope, tags, author, context, consequences, confidence }) => {
      await store.init();

      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
      const short = nanoid(6);
      const id = `dec_${dateStr}_${short}`;

      const decision = {
        id,
        summary,
        rationale,
        scope,
        tags,
        author,
        source: "conversation" as DecisionSource,
        confidence: confidence as DecisionConfidence,
        status: "active" as DecisionStatus,
        created: now.toISOString(),
        context,
        consequences,
      };

      await store.create(decision);

      return {
        content: [
          {
            type: "text" as const,
            text: `Decision recorded: **${summary}**\nID: ${id}\nFile: .decisions/active/${slugifyForDisplay(summary)}.md`,
          },
        ],
      };
    }
  );

  server.tool(
    "list_decisions",
    "List all recorded architectural decisions, optionally filtered by status or tags.",
    {
      status: z
        .enum(["active", "superseded", "archived"])
        .optional()
        .describe("Filter by status"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Filter by tags"),
    },
    async ({ status, tags }) => {
      await store.init();
      const decisions = await store.list({ status, tags });

      if (decisions.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No decisions found.",
            },
          ],
        };
      }

      const lines = decisions.map((d) => {
        const age = getRelativeTime(d.created);
        return `- [${d.status.toUpperCase()}] **${d.summary}** (${age}) — ${d.tags.join(", ")} — ${d.id}`;
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `${decisions.length} decision(s):\n\n${lines.join("\n")}`,
          },
        ],
      };
    }
  );

  server.tool(
    "get_decision",
    "Get full details of a specific decision by ID.",
    {
      id: z.string().describe("Decision ID (e.g. dec_20260212_abc123)"),
    },
    async ({ id }) => {
      await store.init();
      const decision = await store.get(id);

      if (!decision) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Decision not found: ${id}`,
            },
          ],
        };
      }

      let text = `# ${decision.summary}\n\n`;
      text += `- **ID**: ${decision.id}\n`;
      text += `- **Status**: ${decision.status}\n`;
      text += `- **Author**: ${decision.author}\n`;
      text += `- **Created**: ${decision.created}\n`;
      text += `- **Confidence**: ${decision.confidence}\n`;
      text += `- **Source**: ${decision.source}\n`;
      text += `- **Scope**: ${decision.scope.join(", ")}\n`;
      text += `- **Tags**: ${decision.tags.join(", ")}\n`;
      text += `- **Rationale**: ${decision.rationale}\n`;

      if (decision.context) {
        text += `\n## Context\n\n${decision.context}\n`;
      }
      if (decision.consequences) {
        text += `\n## Consequences\n\n${decision.consequences}\n`;
      }
      if (decision.supersededBy) {
        text += `\n*Superseded by: ${decision.supersededBy}*\n`;
      }

      return {
        content: [
          {
            type: "text" as const,
            text,
          },
        ],
      };
    }
  );

  return server;
}

function slugifyForDisplay(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function getRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
