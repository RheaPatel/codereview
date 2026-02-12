import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "./server.js";

let tmpDir: string;
let client: Client;
let cleanup: () => Promise<void>;

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dm-server-test-"));
  const server = createServer(tmpDir);
  client = new Client({ name: "test-client", version: "1.0.0" });

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  cleanup = async () => {
    await client.close();
    await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  };
}

beforeEach(async () => {
  await setup();
});

afterEach(async () => {
  await cleanup();
});

describe("MCP Server", () => {
  describe("tool listing", () => {
    it("exposes all 4 tools", async () => {
      const result = await client.listTools();
      const names = result.tools.map((t) => t.name).sort();
      expect(names).toEqual([
        "get_decision",
        "list_decisions",
        "query_decisions",
        "record_decision",
      ]);
    });
  });

  describe("record_decision", () => {
    it("creates a decision and returns confirmation", async () => {
      const result = await client.callTool({
        name: "record_decision",
        arguments: {
          summary: "Use Zod for validation",
          rationale: "Type-safe and composable",
          scope: ["src/**/*.ts"],
          tags: ["validation"],
          author: "testuser",
        },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("Decision recorded");
      expect(text).toContain("Use Zod for validation");
      expect(text).toContain("dec_");
    });

    it("writes a markdown file to .decisions/active/", async () => {
      await client.callTool({
        name: "record_decision",
        arguments: {
          summary: "Use PostgreSQL",
          rationale: "ACID compliance",
          scope: ["src/db/**/*.ts"],
          tags: ["database"],
          author: "testuser",
        },
      });

      const files = await fs.readdir(
        path.join(tmpDir, ".decisions", "active")
      );
      expect(files).toContain("use-postgresql.md");
    });

    it("includes context and consequences when provided", async () => {
      await client.callTool({
        name: "record_decision",
        arguments: {
          summary: "Use REST over GraphQL",
          rationale: "Simpler for our use case",
          scope: ["src/api/**/*.ts"],
          tags: ["api"],
          author: "testuser",
          context: "Evaluated GraphQL but team lacks experience",
          consequences: "Standard REST endpoints, OpenAPI spec",
        },
      });

      const content = await fs.readFile(
        path.join(tmpDir, ".decisions", "active", "use-rest-over-graphql.md"),
        "utf-8"
      );
      expect(content).toContain("## Context");
      expect(content).toContain("Evaluated GraphQL");
      expect(content).toContain("## Consequences");
      expect(content).toContain("OpenAPI spec");
    });
  });

  describe("query_decisions", () => {
    it("returns matching decisions for a file path", async () => {
      await client.callTool({
        name: "record_decision",
        arguments: {
          summary: "Use Drizzle ORM",
          rationale: "Type-safe SQL",
          scope: ["src/db/**/*.ts"],
          tags: ["orm"],
          author: "testuser",
        },
      });

      const result = await client.callTool({
        name: "query_decisions",
        arguments: { file_path: "src/db/schema.ts" },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("Use Drizzle ORM");
      expect(text).toContain("1 relevant decision");
    });

    it("returns no results for non-matching path", async () => {
      await client.callTool({
        name: "record_decision",
        arguments: {
          summary: "Use Drizzle ORM",
          rationale: "Type-safe SQL",
          scope: ["src/db/**/*.ts"],
          tags: ["orm"],
          author: "testuser",
        },
      });

      const result = await client.callTool({
        name: "query_decisions",
        arguments: { file_path: "tests/unit/foo.test.ts" },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("No relevant decisions found");
    });

    it("filters by tags when no file path given", async () => {
      await client.callTool({
        name: "record_decision",
        arguments: {
          summary: "Use Zod",
          rationale: "Validation",
          scope: ["src/**/*.ts"],
          tags: ["validation"],
          author: "testuser",
        },
      });
      await client.callTool({
        name: "record_decision",
        arguments: {
          summary: "Use PostgreSQL",
          rationale: "Database",
          scope: ["src/db/**/*.ts"],
          tags: ["database"],
          author: "testuser",
        },
      });

      const result = await client.callTool({
        name: "query_decisions",
        arguments: { tags: ["database"] },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("Use PostgreSQL");
      expect(text).not.toContain("Use Zod");
    });
  });

  describe("list_decisions", () => {
    it("lists all decisions", async () => {
      await client.callTool({
        name: "record_decision",
        arguments: {
          summary: "Decision A",
          rationale: "Reason A",
          scope: ["src/**/*.ts"],
          tags: ["a"],
          author: "testuser",
        },
      });
      await client.callTool({
        name: "record_decision",
        arguments: {
          summary: "Decision B",
          rationale: "Reason B",
          scope: ["lib/**/*.ts"],
          tags: ["b"],
          author: "testuser",
        },
      });

      const result = await client.callTool({
        name: "list_decisions",
        arguments: {},
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("2 decision(s)");
      expect(text).toContain("Decision A");
      expect(text).toContain("Decision B");
    });

    it("filters by status", async () => {
      await client.callTool({
        name: "record_decision",
        arguments: {
          summary: "Active decision",
          rationale: "Active",
          scope: ["src/**/*.ts"],
          tags: ["test"],
          author: "testuser",
        },
      });

      const result = await client.callTool({
        name: "list_decisions",
        arguments: { status: "superseded" },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("No decisions found");
    });

    it("returns empty message when no decisions exist", async () => {
      const result = await client.callTool({
        name: "list_decisions",
        arguments: {},
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("No decisions found");
    });
  });

  describe("get_decision", () => {
    it("retrieves full decision details by ID", async () => {
      const recordResult = await client.callTool({
        name: "record_decision",
        arguments: {
          summary: "Use tRPC",
          rationale: "End-to-end type safety",
          scope: ["src/api/**/*.ts"],
          tags: ["api", "rpc"],
          author: "testuser",
          context: "Building internal API",
          consequences: "All endpoints via tRPC router",
        },
      });

      // Extract ID from the record result
      const recordText = (
        recordResult.content as Array<{ type: string; text: string }>
      )[0].text;
      const idMatch = recordText.match(/ID: (dec_[A-Za-z0-9_-]+)/);
      expect(idMatch).not.toBeNull();
      const id = idMatch![1];

      const result = await client.callTool({
        name: "get_decision",
        arguments: { id },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("Use tRPC");
      expect(text).toContain("End-to-end type safety");
      expect(text).toContain("Building internal API");
      expect(text).toContain("All endpoints via tRPC router");
      expect(text).toContain("api, rpc");
    });

    it("returns not found for invalid ID", async () => {
      const result = await client.callTool({
        name: "get_decision",
        arguments: { id: "dec_nonexistent_000000" },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("Decision not found");
    });
  });

  describe("multi-tool workflows", () => {
    it("record → query → get round-trip", async () => {
      // Record
      const recordResult = await client.callTool({
        name: "record_decision",
        arguments: {
          summary: "Use Tailwind CSS",
          rationale: "Utility-first, no context switching",
          scope: ["src/components/**/*.tsx", "src/styles/**/*.css"],
          tags: ["styling", "css"],
          author: "testuser",
        },
      });
      const recordText = (
        recordResult.content as Array<{ type: string; text: string }>
      )[0].text;
      const id = recordText.match(/ID: (dec_[A-Za-z0-9_-]+)/)![1];

      // Query by file
      const queryResult = await client.callTool({
        name: "query_decisions",
        arguments: { file_path: "src/components/Button.tsx" },
      });
      const queryText = (
        queryResult.content as Array<{ type: string; text: string }>
      )[0].text;
      expect(queryText).toContain("Use Tailwind CSS");

      // Get by ID
      const getResult = await client.callTool({
        name: "get_decision",
        arguments: { id },
      });
      const getText = (
        getResult.content as Array<{ type: string; text: string }>
      )[0].text;
      expect(getText).toContain("Utility-first");
      expect(getText).toContain("src/components/**/*.tsx");
    });

    it("multiple decisions match the same file", async () => {
      await client.callTool({
        name: "record_decision",
        arguments: {
          summary: "Use React Server Components",
          rationale: "Better performance",
          scope: ["src/components/**/*.tsx"],
          tags: ["react"],
          author: "testuser",
        },
      });
      await client.callTool({
        name: "record_decision",
        arguments: {
          summary: "Use Tailwind CSS",
          rationale: "Utility-first",
          scope: ["src/**/*.tsx"],
          tags: ["styling"],
          author: "testuser",
        },
      });

      const result = await client.callTool({
        name: "query_decisions",
        arguments: { file_path: "src/components/Header.tsx" },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("2 relevant decision");
      expect(text).toContain("React Server Components");
      expect(text).toContain("Tailwind CSS");
    });
  });
});
