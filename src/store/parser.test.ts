import { describe, it, expect } from "vitest";
import { parseDecision, serializeDecision, slugify } from "./parser.js";
import type { Decision } from "./types.js";

const SAMPLE_MARKDOWN = `---
id: dec_20260212_001
summary: Use Zod for all runtime validation
rationale: Type-safe, composable, works with TS inference
scope:
  - "src/**/*.ts"
  - "api/**/*.ts"
tags:
  - validation
  - schema
author: rheapatel
source: conversation
confidence: explicit
status: active
created: "2026-02-12T09:30:00Z"
---

## Context

Evaluated Joi, Yup, and Zod during API layer implementation.

## Consequences

All API schemas defined with Zod. Types inferred, no duplication.
`;

const SAMPLE_DECISION: Decision = {
  id: "dec_20260212_001",
  summary: "Use Zod for all runtime validation",
  rationale: "Type-safe, composable, works with TS inference",
  scope: ["src/**/*.ts", "api/**/*.ts"],
  tags: ["validation", "schema"],
  author: "rheapatel",
  source: "conversation",
  confidence: "explicit",
  status: "active",
  created: "2026-02-12T09:30:00Z",
  context: "Evaluated Joi, Yup, and Zod during API layer implementation.",
  consequences:
    "All API schemas defined with Zod. Types inferred, no duplication.",
};

describe("parseDecision", () => {
  it("parses frontmatter and body sections", () => {
    const decision = parseDecision(SAMPLE_MARKDOWN);
    expect(decision.id).toBe("dec_20260212_001");
    expect(decision.summary).toBe("Use Zod for all runtime validation");
    expect(decision.rationale).toBe(
      "Type-safe, composable, works with TS inference"
    );
    expect(decision.scope).toEqual(["src/**/*.ts", "api/**/*.ts"]);
    expect(decision.tags).toEqual(["validation", "schema"]);
    expect(decision.author).toBe("rheapatel");
    expect(decision.source).toBe("conversation");
    expect(decision.confidence).toBe("explicit");
    expect(decision.status).toBe("active");
    expect(decision.created).toBe("2026-02-12T09:30:00Z");
  });

  it("extracts context section", () => {
    const decision = parseDecision(SAMPLE_MARKDOWN);
    expect(decision.context).toBe(
      "Evaluated Joi, Yup, and Zod during API layer implementation."
    );
  });

  it("extracts consequences section", () => {
    const decision = parseDecision(SAMPLE_MARKDOWN);
    expect(decision.consequences).toBe(
      "All API schemas defined with Zod. Types inferred, no duplication."
    );
  });

  it("handles missing body sections", () => {
    const minimal = `---
id: dec_test
summary: Minimal decision
rationale: Testing
scope: []
tags: []
author: test
source: cli
confidence: explicit
status: active
created: "2026-01-01T00:00:00Z"
---
`;
    const decision = parseDecision(minimal);
    expect(decision.context).toBeUndefined();
    expect(decision.consequences).toBeUndefined();
  });
});

describe("serializeDecision", () => {
  it("produces valid markdown with frontmatter", () => {
    const markdown = serializeDecision(SAMPLE_DECISION);
    expect(markdown).toContain("id: dec_20260212_001");
    expect(markdown).toContain("summary: Use Zod for all runtime validation");
    expect(markdown).toContain("## Context");
    expect(markdown).toContain("## Consequences");
  });

  it("round-trips through parse and serialize", () => {
    const serialized = serializeDecision(SAMPLE_DECISION);
    const parsed = parseDecision(serialized);
    expect(parsed.id).toBe(SAMPLE_DECISION.id);
    expect(parsed.summary).toBe(SAMPLE_DECISION.summary);
    expect(parsed.rationale).toBe(SAMPLE_DECISION.rationale);
    expect(parsed.scope).toEqual(SAMPLE_DECISION.scope);
    expect(parsed.tags).toEqual(SAMPLE_DECISION.tags);
    expect(parsed.context).toBe(SAMPLE_DECISION.context);
    expect(parsed.consequences).toBe(SAMPLE_DECISION.consequences);
  });

  it("omits undefined body sections", () => {
    const decision: Decision = {
      ...SAMPLE_DECISION,
      context: undefined,
      consequences: undefined,
    };
    const markdown = serializeDecision(decision);
    expect(markdown).not.toContain("## Context");
    expect(markdown).not.toContain("## Consequences");
  });
});

describe("slugify", () => {
  it("converts to lowercase kebab-case", () => {
    expect(slugify("Use Zod for all runtime validation")).toBe(
      "use-zod-for-all-runtime-validation"
    );
  });

  it("removes special characters", () => {
    expect(slugify("React + TypeScript: Best Practices!")).toBe(
      "react-typescript-best-practices"
    );
  });

  it("truncates to 60 characters", () => {
    const long =
      "This is a very long decision summary that should be truncated to sixty characters maximum";
    expect(slugify(long).length).toBeLessThanOrEqual(60);
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("  --hello world--  ")).toBe("hello-world");
  });
});
