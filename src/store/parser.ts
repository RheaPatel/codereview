import matter from "gray-matter";
import type { Decision, DecisionFrontmatter } from "./types.js";

export function parseDecision(markdown: string): Decision {
  const { data, content } = matter(markdown);
  const fm = data as DecisionFrontmatter;

  let context: string | undefined;
  let consequences: string | undefined;

  const contextMatch = content.match(
    /## Context\s*\n([\s\S]*?)(?=\n## |\n*$)/
  );
  if (contextMatch) {
    context = contextMatch[1].trim();
  }

  const consequencesMatch = content.match(
    /## Consequences\s*\n([\s\S]*?)(?=\n## |\n*$)/
  );
  if (consequencesMatch) {
    consequences = consequencesMatch[1].trim();
  }

  return {
    ...fm,
    context,
    consequences,
  };
}

export function serializeDecision(decision: Decision): string {
  const {
    context,
    consequences,
    ...frontmatter
  } = decision;

  let body = "";

  if (context) {
    body += `\n## Context\n\n${context}\n`;
  }

  if (consequences) {
    body += `\n## Consequences\n\n${consequences}\n`;
  }

  return matter.stringify(body, frontmatter);
}

export function slugify(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/g, "");
}
