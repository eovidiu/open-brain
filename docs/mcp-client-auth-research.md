# MCP Client Authentication — Research

**Date:** 2026-08-08
**Purpose:** Establish the common-denominator authentication mechanism for the Open Brain
MCP Worker across every AI client Ovidiu uses, as the evidence base for the F013 auth
rebuild and the accompanying `open-brain-spec.md` amendment.

**Problem being solved.** The MCP Worker currently issues a JWT from `POST /auth/token`
with a 1-hour expiry (`workers/mcp/src/auth/jwt.ts`, `TOKEN_EXPIRY_SECONDS = 3600`).
Every MCP client stores its server configuration in a static file. A credential that
dies after 60 minutes cannot be written into a static config, so no client can hold a
durable connection. This is a server-side design problem, not a client configuration
problem — no client-side workaround fixes it.

---

## 1. Client support matrix

Verified 2026-08-08 against official documentation and, where available, the clients'
own `--help` output.

| Client | Static `Authorization: Bearer` | OAuth 2.1 + DCR | Transport |
|---|---|---|---|
| Claude Code CLI | **Yes, GA** — `claude mcp add --transport http <name> <url> --header "Authorization: Bearer <k>"`; also `"headers"` in `.mcp.json` / `~/.claude.json` | Yes, GA (RFC 9728 + RFC 8414 discovery, DCR, CIMD) | Streamable HTTP, SSE (deprecated), stdio, ws |
| Claude Desktop | **Beta, gated** — `static_headers` in the hosted Custom Connectors backend; docs say "in beta… contact Anthropic for early access". Allowlisted header names only, max 4 | Yes, GA | Streamable HTTP, proxied through Anthropic's servers |
| claude.ai web | **Beta, gated** — same backend and same limitation as Desktop | Yes, GA | Streamable HTTP, Anthropic-hosted |
| Codex CLI | **Yes** — `bearer_token_env_var` (purpose-built), plus `http_headers` / `env_http_headers` in `~/.codex/config.toml` | Yes — `codex mcp login <server>`, `scopes`, `oauth_resource` (RFC 8707) | stdio, Streamable HTTP |
| Codex desktop / IDE extension | **Yes** — shares Codex CLI's `config.toml`; VS Code extension has a GUI writing the same file | Yes, same flow | stdio, Streamable HTTP |
| GitHub Copilot CLI | **Yes** — `"headers"` in `~/.copilot/mcp-config.json`; `copilot mcp add --transport http … --header` | Claimed in prose, **no config fields documented** — treat as unverified | stdio, Streamable HTTP, SSE (legacy) |
| GitHub Copilot — VS Code | **Yes** — `"headers"` in `mcp.json`, `${input:…}` supported for prompting | Yes — `oauth.clientId` block; DCR/PKCE mechanics not documented | Streamable HTTP, falls back to SSE |
| GitHub Copilot — JetBrains | **Yes** — note the different key: `"requestInit": {"headers": {…}}` | **Unverified** | stdio, remote URL |
| Antigravity CLI (`agy`) | **Yes** — first-class `"headers"` field alongside `"serverUrl"`, in `~/.gemini/config/mcp_config.json` or `.agents/mcp_config.json` | Yes, DCR — but not confirmed to be the MCP-spec discovery chain | stdio, SSE, Streamable HTTP, ws |

### Conclusions from the matrix

1. **Static bearer is the only mechanism with working, documented configuration on every
   client.** OAuth is confirmed-complete on fewer of them.
2. **It is nonetheless not sufficient for Anthropic's two hosted surfaces.** Claude
   Desktop and claude.ai accept static headers only through a gated beta; their GA path
   is OAuth 2.1 + DCR.
3. Therefore **neither mechanism alone covers all nine surfaces.** Static bearer covers
   seven immediately; OAuth would add the remaining two.

---

## 2. Is a static bearer token spec-legal?

Yes, unambiguously. Checked across three MCP specification revisions — 2025-06-18,
2025-11-25, and the current **2026-07-28** — with identical wording in the "Protocol
Requirements" section of `/basic/authorization`:

> "Authorization is **OPTIONAL** for MCP implementations. When supported:
> * Implementations using an HTTP-based transport **SHOULD** conform to this specification.
> * Implementations using an STDIO transport **SHOULD NOT** follow this specification, and instead retrieve credentials from the environment."

The OAuth 2.1 machinery — RFC 9728 protected-resource metadata, RFC 8414 authorization-
server metadata, RFC 7591 dynamic client registration, PKCE S256, `iss` mix-up validation
— becomes mandatory only *once a server opts into the spec's authorization mechanism*.
A server that gates access by another means is outside that chapter's scope, not in
violation of it.

The spec's Security Best Practices document positively endorses the token-gate pattern.
Under "Local MCP Server Compromise" it lists, as valid mitigations for HTTP transports:

> "Require an authorization token; Use unix domain sockets or other IPC mechanisms with restricted access."

There is no normative language discouraging static tokens, and no clause requiring
clients to refuse a server that is not an OAuth resource server.

**Bottom line:** a long-lived `Authorization: Bearer <key>` over HTTPS, for a
single-operator personal server, is a proportionate and spec-compatible design. OAuth's
additional guarantees — delegated third-party consent, per-client revocation without
server access, short-lived rotating tokens — address a multi-party threat model this
deployment does not have.

---

## 3. Decision (2026-08-08)

**Chosen: static long-lived API key now (F013); OAuth 2.1 + DCR deferred to F014.**

Rationale: F013 unblocks seven of nine surfaces permanently, is small enough to build and
verify to the project's coverage bar, and requires no authorization-server component. The
two Anthropic hosted surfaces wait for either header-auth beta access or F014.

**Key storage: an `api_keys` table in Neon, one key per client**, rather than a single
Worker secret. With nine client installations, revoking a lost machine must not force
reconfiguration of the other eight. Cost is one indexed lookup per request, negligible
beside the pgvector search already on the path.

### Consequences to handle in F013

- `docs/open-brain-spec.md` is authoritative and amended by PR only. It specifies the
  JWT/`/auth/token` design in §9.3, the API section, the threat table and the test plan.
  The amendment PR is part of the feature, not a follow-up.
- Nothing in code calls `/auth/token` — it appears only in `README.md`, `docs/`. Removal
  is therefore a documentation change plus the Worker route, consistent with the
  replace-don't-deprecate rule.
- A long-lived credential on a public endpoint needs rate limiting on `/mcp` itself.
  `workers/mcp/src/auth/rate-limiter.ts` currently protects only `/auth/token`.
- Keys must be stored hashed (SHA-256), compared in constant time, and never logged.

---

## 4. Known gaps

Recorded so a future reader does not mistake absence of evidence for evidence of absence:

- Whether GitHub Copilot CLI performs a real OAuth 2.1 handshake, or only accepts a
  pre-obtained token via header. Docs assert "OAuth 2.0" but document no config fields.
- Whether VS Code's `oauth` block implements full DCR + PKCE + `.well-known` discovery,
  or requires a server-operator-supplied `clientId`.
- Whether JetBrains Copilot supports any OAuth flow.
- Whether Antigravity's DCR support follows the MCP spec's discovery chain or a
  Google-specific flow.
- **Antigravity CLI has an open bug** (`google-antigravity/antigravity-cli` issue #71):
  remote MCP servers are discovered and cached but tool invocation silently fails, and
  the reporter states `Authorization` headers do not resolve it. The same config is
  reported working in Gemini CLI and Codex, isolating the fault to Antigravity. Treat
  Antigravity connectivity as unproven until tested directly — this is a client bug, not
  a server design problem, and must not be allowed to drive server-side decisions.
- The claim that `claude_desktop_config.json` rejects remote `url` entries is
  corroborated by search summaries and a GitHub issue but was not re-read against the
  primary source word-for-word.

## 5. Sources

MCP specification (`modelcontextprotocol.io/specification/2026-07-28/basic/authorization`
and `/basic/security_best_practices`); Anthropic docs (`code.claude.com`,
`claude.com/docs/connectors/building/authentication`, `support.claude.com/en/articles/11175166`);
OpenAI Codex MCP docs (`developers.openai.com/codex/mcp`); GitHub docs
(`docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers`,
`docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/enterprise-configuration`);
VS Code docs (`code.visualstudio.com/docs/agents/reference/mcp-configuration`);
Antigravity docs (`antigravity.google/docs/mcp`).
