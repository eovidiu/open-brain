## Mistakes
- Reached for `mcp-remote` (a stdio proxy) as the Claude Desktop solution before
  checking whether the client natively supported HTTP headers. It did not fix the
  actual problem (token expiry) and Ovidiu correctly called it a hack.
- Jumped to configuring Claude Desktop when the stated request was to re-establish
  the connection for THIS CLI first. Changed target without saying so.
- Told Ovidiu the scratchpad research "survives" a session restart. It does not -
  the scratchpad is session-scoped. Caught before it cost anything; the research
  was moved into docs/ instead.
- Presented the OVI-138 score gap (Graphiti 80 vs Open Brain 31) in a way that
  read as a migration recommendation. The framework scores adoption fitness and
  has no migration-cost dimension; that limitation should have been stated in the
  report itself, not only when challenged.

## Learnings
- The MCP Worker's 1-hour JWT is a client-compatibility blocker, not just an
  inconvenience: every MCP client persists server config to a static file.
- MCP spec 2026-07-28: "Authorization is OPTIONAL." All OAuth machinery is
  conditional on opting into that chapter. Static bearer is spec-legal, and
  Security Best Practices explicitly endorses "require an authorization token".
- Claude Desktop and claude.ai take static headers only via a gated beta; their GA
  path is OAuth. This is the single fact that splits the client matrix.
- This session launched from the PARENT directory, so open-brain/.claude/settings.json
  never loaded and no hook fired all session. Nothing in the tooling announced this.

## Desires
- A startup check that says plainly "you launched outside the repo root, hooks are
  inert" instead of leaving it to be inferred from CLAUDE.md.
- A durable, non-session-scoped scratch location for research that is not yet ready
  to be a committed doc.
- A way to verify an MCP server config end-to-end without restarting the session -
  MCP servers only load at startup, so the configure/verify loop costs a restart.
