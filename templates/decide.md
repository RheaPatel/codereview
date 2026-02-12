Review the conversation so far and identify any architectural decisions that were made — explicit choices about libraries, patterns, conventions, data models, or approaches.

For each decision you identify:

1. Summarize it in one line
2. Explain the rationale (why this choice, what alternatives were considered)
3. Determine the scope (which files/directories does this apply to, as glob patterns)
4. Add relevant tags for categorization

Then call the `record_decision` tool for each decision with:
- `summary`: One-line summary
- `rationale`: Why this was chosen
- `scope`: Array of glob patterns (e.g. `["src/**/*.ts"]`)
- `tags`: Array of tags (e.g. `["validation", "schema"]`)
- `author`: The user's name if known, otherwise "team"
- `context`: Brief description of what was being discussed when this decision was made
- `consequences`: What follows from this decision

If no clear decisions were made in this conversation, say so — don't fabricate decisions.

Focus on decisions that would be useful to surface later when someone (human or AI) is working in the same codebase. Skip trivial choices (variable names, formatting) and focus on architectural/structural ones.
