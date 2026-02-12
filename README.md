# decision-memory

Automatically capture, store, and surface architectural decisions made during AI-assisted coding sessions.

## This is not a CLAUDE.md

A `CLAUDE.md` or rules file tells an AI agent *what to do*: "use Zod", "format with Prettier", "run tests before committing." Those are instructions — static, universal, always-on.

**decision-memory** captures *why* something was decided, scoped to the code it affects. These are the contextual, nuanced choices that get made in conversation and then lost:

- "We chose not to expose the payments API to the browser extension because of PCI scope implications"
- "Kept the auth module synchronous to preserve backward compatibility with the v1 SDK consumers"
- "Went with server-side rendering for the dashboard to avoid exposing analytics API keys to the client"
- "Decided against caching user profiles because the data changes too frequently and stale data caused support tickets"

These aren't instructions. They're institutional memory — the kind of context that saves someone (or an AI) from re-making a bad decision three months later because they didn't know the history.

**decision-memory** records these decisions as structured markdown files, indexes them by file scope, and surfaces relevant ones when you (or your AI) touch affected code. It's advisory, not blocking — a nudge that says "hey, this area has context you should know about before changing things."

## How it works

```
AI Coding Session (Claude Code / Copilot CLI / any agent)
       |
  +---------+----------+
  |                    |
MCP Server          Hooks / CLI
(record/query)      (surface warnings)
  |                    |
  +--------+-----------+
           |
     DecisionStore
           |
     .decisions/
     (markdown + JSON index)
```

1. **Record**: During a session, decisions are captured — either explicitly via a command, or automatically by the AI calling the `record_decision` tool
2. **Store**: Each decision becomes a markdown file with YAML frontmatter in `.decisions/active/`, plus a generated `index.json` for fast lookups
3. **Surface**: When code is edited, relevant decisions are surfaced as advisory warnings — the AI sees them in context and can warn you about conflicts

## Quick start

### Install

```bash
npm install -g decision-memory
```

Or use without installing:

```bash
npx decision-memory init
```

### Initialize in your project

```bash
cd your-project
decision-memory init
```

This creates:
```
.decisions/
├── active/          # Current decisions
├── superseded/      # Replaced by newer decisions
├── archived/        # No longer relevant
└── index.json       # Auto-generated index for fast queries
```

### Record your first decision

```bash
decision-memory record \
  --summary "Use Zod for all runtime validation" \
  --rationale "Type-safe, composable, works with TS inference" \
  --scope "src/**/*.ts,api/**/*.ts" \
  --tags "validation,schema" \
  --author "rheapatel"
```

### Check decisions for a file

```bash
decision-memory check src/api/users.ts
```

Output:
```
1 decision(s) apply to src/api/users.ts:

  [dec_20260212_abc123] Use Zod for all runtime validation
    Rationale: Type-safe, composable, works with TS inference
    Scope: src/**/*.ts, api/**/*.ts
    Tags: validation, schema
```

---

## Integration with Claude Code

decision-memory integrates with Claude Code in two ways: as an **MCP server** (so Claude can record and query decisions) and as a **PostToolUse hook** (so Claude is automatically warned about relevant decisions when editing files).

### 1. MCP Server setup

Add to your Claude Code MCP configuration (`.claude/settings.json` or via the Claude Code UI):

```json
{
  "mcpServers": {
    "decision-memory": {
      "command": "npx",
      "args": ["-y", "decision-memory", "serve"]
    }
  }
}
```

This gives Claude four tools:

| Tool | Description |
|------|-------------|
| `query_decisions` | Find decisions relevant to a file path or topic |
| `record_decision` | Record a new architectural decision |
| `list_decisions` | List all decisions, filterable by status/tags |
| `get_decision` | Get full details of a specific decision by ID |

Claude will automatically use `query_decisions` when you ask about conventions, and `record_decision` when an architectural choice is made.

### 2. PostToolUse hook setup

Add to your project's `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "command": ".claude/hooks/check-decisions.sh"
      }
    ]
  }
}
```

The hook runs after every `Write` or `Edit` tool call. If the file being edited matches any active decision scopes, Claude receives an advisory system message:

> Advisory: 1 existing architectural decision(s) may apply to this file:
> - Use Zod for all runtime validation (scope: src/\*\*/\*.ts) [ID: dec_20260212_abc123]
>
> These are advisory — you may proceed, but consider whether your changes align with these decisions.

The hook script is created automatically by `decision-memory init` at `.claude/hooks/check-decisions.sh`.

### 3. `/decide` slash command

`decision-memory init` also creates a custom slash command at `.claude/commands/decide.md`. Use it during a conversation:

```
/decide
```

Claude will review the conversation, identify architectural decisions that were made, and call `record_decision` for each one. This is the easiest way to capture decisions — just have your normal conversation, then run `/decide` at the end.

---

## Integration with GitHub Copilot CLI

GitHub Copilot CLI (`gh copilot`) can work with decision-memory through the CLI interface. While Copilot doesn't support MCP servers directly, you can incorporate decision-memory into your workflow in several ways.

### 1. Pre-check before asking Copilot

Before asking Copilot to modify code, check what decisions apply:

```bash
# Check decisions before asking Copilot to edit a file
decision-memory check src/api/auth.ts

# Then ask Copilot with that context
gh copilot suggest "add OAuth support to src/api/auth.ts"
```

### 2. Shell alias for Copilot-aware editing

Add to your `.bashrc` or `.zshrc`:

```bash
# Wrapper that checks decisions before invoking Copilot
copilot-edit() {
  local file="$1"
  shift

  # Check for relevant decisions
  local decisions
  decisions=$(decision-memory check "$file" 2>/dev/null)
  if [ -n "$decisions" ] && ! echo "$decisions" | grep -q "No decisions"; then
    echo "--- Relevant decisions ---"
    echo "$decisions"
    echo "---"
    echo ""
  fi

  gh copilot suggest "$@"
}
```

### 3. Git pre-commit hook

Add decision awareness to your commit workflow. Create `.git/hooks/pre-commit`:

```bash
#!/usr/bin/env bash
# Check if any modified files conflict with recorded decisions

CHANGED_FILES=$(git diff --cached --name-only)
WARNINGS=""

for file in $CHANGED_FILES; do
  result=$(decision-memory check "$file" --json 2>/dev/null || echo "[]")
  count=$(echo "$result" | jq 'length' 2>/dev/null || echo "0")
  if [ "$count" -gt 0 ]; then
    summaries=$(echo "$result" | jq -r '.[].summary' 2>/dev/null)
    WARNINGS="${WARNINGS}\n  ${file}:"
    while IFS= read -r summary; do
      WARNINGS="${WARNINGS}\n    - ${summary}"
    done <<< "$summaries"
  fi
done

if [ -n "$WARNINGS" ]; then
  echo "Decision Memory: The following decisions may be relevant to your changes:"
  echo -e "$WARNINGS"
  echo ""
  echo "Review with: decision-memory check <file>"
  echo "Proceeding with commit (advisory only)."
fi
```

### 4. GitHub Actions for PR review

Add `.github/workflows/decision-check.yml` to surface decisions in pull request reviews:

```yaml
name: Decision Check
on: [pull_request]

jobs:
  check-decisions:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - run: npm install -g decision-memory

      - name: Check changed files against decisions
        run: |
          COMMENT=""
          for file in $(git diff --name-only origin/${{ github.base_ref }}...HEAD); do
            result=$(decision-memory check "$file" --json 2>/dev/null || echo "[]")
            count=$(echo "$result" | jq 'length' 2>/dev/null || echo "0")
            if [ "$count" -gt 0 ]; then
              summaries=$(echo "$result" | jq -r '.[] | "- **\(.summary)** (`\(.id)`)\n  Scope: \(.scope | join(", "))"')
              COMMENT="${COMMENT}\n### ${file}\n${summaries}\n"
            fi
          done

          if [ -n "$COMMENT" ]; then
            echo "## Decision Memory" > /tmp/comment.md
            echo "" >> /tmp/comment.md
            echo "The following architectural decisions may be relevant to this PR:" >> /tmp/comment.md
            echo -e "$COMMENT" >> /tmp/comment.md
            echo "" >> /tmp/comment.md
            echo "*These are advisory — review and proceed if the changes are intentional.*" >> /tmp/comment.md

            gh pr comment ${{ github.event.pull_request.number }} --body-file /tmp/comment.md
          fi
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## Integration with any AI agent

decision-memory is designed to work with any AI coding tool. The core pattern:

1. **Before editing**: Run `decision-memory check <file> --json` to get relevant decisions as structured data
2. **Include in prompt**: Feed the decisions into your agent's system prompt or context
3. **After decisions are made**: Run `decision-memory record` to capture new decisions

The MCP server follows the open [Model Context Protocol](https://modelcontextprotocol.io) standard, so any MCP-compatible client can use it natively.

---

## Decision file format

Each decision is a markdown file with YAML frontmatter:

```markdown
---
id: dec_20260212_abc123
summary: Do not expose payment endpoints to browser extension API
rationale: Browser extension context has weaker isolation; exposing payment APIs would bring the extension into PCI DSS scope
scope:
  - "src/api/payments/**/*.ts"
  - "src/extension/**/*.ts"
tags:
  - security
  - payments
  - extension
author: rheapatel
source: conversation
confidence: explicit
status: active
created: 2026-02-12T09:30:00Z
---

## Context

During the browser extension build-out, we considered letting the extension
call the payments API directly. After reviewing PCI DSS requirements, we
determined that exposing payment endpoints to the extension would require
the extension to be in scope for PCI compliance, which adds significant
audit and security overhead.

## Consequences

The extension must go through the main web app for any payment-related
actions. No payment types, schemas, or API clients should be imported in
the extension codebase. If a user needs to make a payment from the extension,
redirect them to the web app.
```

### Frontmatter fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ID (`dec_YYYYMMDD_<nanoid>`) |
| `summary` | string | One-line summary of the decision |
| `rationale` | string | Why this choice was made |
| `scope` | string[] | Glob patterns for files this applies to |
| `tags` | string[] | Categorization tags |
| `author` | string | Who made or recorded the decision |
| `source` | enum | `conversation`, `cli`, `hook`, or `review` |
| `confidence` | enum | `explicit` (stated), `inferred` (detected), or `suggested` |
| `status` | enum | `active`, `superseded`, or `archived` |
| `created` | ISO 8601 | When the decision was recorded |
| `updated` | ISO 8601 | When last modified (optional) |
| `supersededBy` | string | ID of the replacing decision (optional) |

### Body sections

- **Context**: Background on what was being discussed or evaluated
- **Consequences**: What follows from this decision — what changes, what's locked in

### Index file

`.decisions/index.json` is auto-generated for fast file-to-decision lookups:

```json
{
  "version": 1,
  "updated": "2026-02-12T10:00:00Z",
  "decisions": [
    {
      "id": "dec_20260212_abc123",
      "summary": "Do not expose payment endpoints to browser extension API",
      "scope": ["src/api/payments/**/*.ts", "src/extension/**/*.ts"],
      "tags": ["security", "payments", "extension"],
      "status": "active",
      "created": "2026-02-12T09:30:00Z",
      "file": "active/do-not-expose-payment-endpoints-to-browser-extension.md"
    }
  ]
}
```

---

## CLI reference

### `decision-memory init`

Initialize decision tracking in the current project. Creates the `.decisions/` directory structure, copies the hook script to `.claude/hooks/`, and copies the `/decide` slash command to `.claude/commands/`.

### `decision-memory record`

Record a new decision from the command line.

```bash
decision-memory record \
  --summary "Use PostgreSQL for persistence" \
  --rationale "ACID compliance, JSON support, mature ecosystem" \
  --scope "src/db/**/*.ts,src/models/**/*.ts" \
  --tags "database,persistence" \
  --author "rheapatel" \
  --confidence explicit \
  --context "Evaluated SQLite, MySQL, and PostgreSQL" \
  --consequences "All persistence goes through pg driver"
```

**Options:**
| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--summary` | Yes | — | One-line summary |
| `--rationale` | Yes | — | Why this was chosen |
| `--scope` | Yes | — | Comma-separated glob patterns |
| `--tags` | No | `""` | Comma-separated tags |
| `--author` | No | `cli-user` | Author name |
| `--confidence` | No | `explicit` | `explicit`, `inferred`, or `suggested` |
| `--context` | No | — | Additional context |
| `--consequences` | No | — | Expected consequences |

### `decision-memory check <file>`

Query decisions that apply to a specific file path.

```bash
decision-memory check src/api/users.ts
decision-memory check src/api/users.ts --json   # Structured output
```

### `decision-memory list`

List all recorded decisions.

```bash
decision-memory list
decision-memory list --status active
decision-memory list --tags validation,schema
decision-memory list --json
```

### `decision-memory serve`

Start the MCP server for use with Claude Code or other MCP-compatible clients. Communicates over stdio.

```bash
decision-memory serve
```

---

## MCP tools reference

When running as an MCP server, decision-memory exposes four tools:

### `query_decisions`

Find decisions relevant to a file path or topic.

**Parameters:**
- `file_path` (string, optional): File path to check against decision scopes
- `tags` (string[], optional): Filter by tags

### `record_decision`

Record a new architectural decision.

**Parameters:**
- `summary` (string, required): One-line summary
- `rationale` (string, required): Why this decision was made
- `scope` (string[], required): Glob patterns for affected files
- `tags` (string[], required): Categorization tags
- `author` (string, default: `"claude"`): Who made the decision
- `context` (string, optional): Additional context
- `consequences` (string, optional): Expected consequences
- `confidence` (enum, default: `"explicit"`): `explicit`, `inferred`, or `suggested`

### `list_decisions`

List all decisions with optional filters.

**Parameters:**
- `status` (enum, optional): `active`, `superseded`, or `archived`
- `tags` (string[], optional): Filter by tags

### `get_decision`

Get full details of a specific decision.

**Parameters:**
- `id` (string, required): Decision ID

---

## Philosophy

### Not instructions — context

A config file says "use Prettier with 2-space tabs." That's an instruction — it applies everywhere, always.

A decision says "we kept the auth module synchronous because the v1 SDK consumers depend on it being blocking, and migrating them is out of scope this quarter." That's context — it explains a constraint that might not be obvious, scoped to specific code, with a rationale that might change over time.

decision-memory is for the second kind. If you find yourself writing something that reads like a lint rule or a coding standard, it probably belongs in CLAUDE.md or your linter config instead.

### Advisory, not blocking

decision-memory never prevents you from doing anything. It surfaces information — "here's what was decided before, and why" — and lets you make the call. If the situation has changed, override the decision. The record updates.

### Decisions are living documents

Decisions aren't set in stone. They can be:
- **Superseded**: A new decision replaces the old one (the old one moves to `.decisions/superseded/`)
- **Archived**: The decision is no longer relevant (moved to `.decisions/archived/`)
- **Updated**: The rationale or scope changes as understanding evolves

This is different from rules, which are either on or off. Decisions evolve as the project evolves.

### Human-readable first

Decisions are markdown files. You can read them with `cat`, edit them with `vim`, review them in GitHub, diff them in PRs. The JSON index is a cache — the markdown files are the source of truth.

### Works with your version control

`.decisions/` lives in your repo. Decisions show up in diffs, get reviewed in PRs, and travel with the code. When someone forks your project, they get your architectural context too.

---

## Examples

### The kind of decisions this is for

These are real scenarios where decision-memory shines — situations where someone (or an AI) working in the code later would benefit from knowing the backstory:

| Decision | Why it matters |
|----------|---------------|
| "Don't add caching to the user profile endpoint" | Previous team tried it, stale data caused a wave of support tickets. Without this context, the next engineer will try caching again. |
| "Keep the notification service as a separate process" | Embedding it caused memory issues under load. Looks like unnecessary complexity if you don't know the history. |
| "Browser extension must not import anything from `src/api/payments/`" | PCI compliance scope. An AI agent would have no way to know this without being told. |
| "The `/admin` routes intentionally skip rate limiting" | Internal tooling, and rate limiting broke batch operations. Looks like a security bug if you don't know why. |
| "We chose Postgres over DynamoDB for the audit log" | Need complex queries for compliance reporting. Looks like it should be a simple append-only log, but the query patterns matter. |

### What this is NOT for

These belong in CLAUDE.md, `.eslintrc`, or your linter — not in decision-memory:

- "Use 2-space indentation" (that's a formatting rule)
- "Always use `const` instead of `let`" (that's a lint rule)
- "Run `npm test` before committing" (that's a workflow instruction)
- "Use Zod for validation" (that's an instruction — unless there's a *reason* you chose Zod over alternatives, in which case the rationale is the decision)

### Capture decisions from a coding session

During a session with Claude Code:

```
You: Can we add the payment flow to the browser extension?
Claude: Looking at this, exposing payment endpoints to the extension
        would bring it into PCI DSS scope. I'd recommend keeping
        payments in the main web app and redirecting from the extension.
You: Good call, let's do that.
Claude: [records decision via record_decision tool or you run /decide]
```

Later, when someone edits extension code:

```
Claude: Advisory: 1 existing architectural decision may apply:
  - Do not expose payment endpoints to browser extension API
    (PCI DSS scope implications)
  This file is in the extension codebase — payment-related imports
  are intentionally excluded here. Want to proceed?
```

### Review decisions before starting work

```bash
$ decision-memory list --status active

3 decision(s):

  [ACTIVE] Do not expose payment endpoints to browser extension API (dec_20260212_abc123)
    security, payments, extension
  [ACTIVE] Keep notification service as separate process (dec_20260210_def456)
    architecture, performance
  [ACTIVE] Skip rate limiting on /admin routes (dec_20260208_ghi789)
    security, admin, intentional
```

### Check a file before modifying it

```bash
$ decision-memory check src/extension/api/client.ts

1 decision(s) apply to src/extension/api/client.ts:

  [dec_20260212_abc123] Do not expose payment endpoints to browser extension API
    Rationale: Browser extension context has weaker isolation; exposing
    payment APIs would bring the extension into PCI DSS scope
    Scope: src/api/payments/**/*.ts, src/extension/**/*.ts
    Tags: security, payments, extension
```

---

## Tech stack

- **TypeScript** — Node.js 20+, ES2022 modules
- **[@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk)** — MCP server implementation
- **[commander](https://www.npmjs.com/package/commander)** — CLI framework
- **[gray-matter](https://www.npmjs.com/package/gray-matter)** — YAML frontmatter parsing
- **[minimatch](https://www.npmjs.com/package/minimatch)** — Glob pattern matching
- **[zod](https://www.npmjs.com/package/zod)** — Tool input validation
- **[nanoid](https://www.npmjs.com/package/nanoid)** — ID generation
- **[vitest](https://www.npmjs.com/package/vitest)** — Testing

## License

MIT
