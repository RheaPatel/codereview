export type DecisionStatus = "active" | "superseded" | "archived";
export type DecisionConfidence = "explicit" | "inferred" | "suggested";
export type DecisionSource = "conversation" | "cli" | "hook" | "review";

export interface Decision {
  id: string;
  summary: string;
  rationale: string;
  scope: string[];
  tags: string[];
  author: string;
  source: DecisionSource;
  confidence: DecisionConfidence;
  status: DecisionStatus;
  created: string;
  updated?: string;
  supersededBy?: string;
  context?: string;
  consequences?: string;
}

export interface DecisionFrontmatter {
  id: string;
  summary: string;
  rationale: string;
  scope: string[];
  tags: string[];
  author: string;
  source: DecisionSource;
  confidence: DecisionConfidence;
  status: DecisionStatus;
  created: string;
  updated?: string;
  supersededBy?: string;
}

export interface DecisionIndexEntry {
  id: string;
  summary: string;
  scope: string[];
  tags: string[];
  status: DecisionStatus;
  created: string;
  file: string;
}

export interface DecisionIndex {
  version: 1;
  updated: string;
  decisions: DecisionIndexEntry[];
}

export interface QueryOptions {
  status?: DecisionStatus;
  tags?: string[];
  scope?: string;
}
