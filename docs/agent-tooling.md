# Agent guidance, skills, and MCP

This guide defines how Morphazoid stores and maintains instructions and agent
integrations. It is a decision and acceptance standard, not evidence that an
integration exists.

Repository status as reviewed on 2026-09-06: Morphazoid has repo-scoped skills
under `.agents/skills/`, but it does not ship an MCP server or committed MCP
client configuration. Do not add placeholder services, empty configuration, or
credentials in anticipation of a possible integration.

## Choose the smallest durable mechanism

| Need | Canonical mechanism | Example |
| --- | --- | --- |
| A rule that should affect nearly every repository task | Root `AGENTS.md` | Static browser architecture, generated WAX handling, verification expectations |
| A standing rule for one genuine subtree | A nested `AGENTS.md` | Native build rules that differ from browser rules |
| A specialized, repeatable workflow that should load only when relevant | `.agents/skills/<name>/SKILL.md` | Perceptual QA or safe publication |
| A reusable structured runtime capability, especially live external data, authenticated access, or controlled actions | An MCP server | Querying an issue tracker or operating a deployment service |
| Human explanation, onboarding, architecture, or a runbook | `README.md`, `CONTRIBUTING.md`, or `docs/` | This guide |
| A deterministic invariant | Source validation, tests, and CI | Catalogue parity or schema conformance |

An MCP server supplies a capability. A skill teaches an agent a reusable method
for applying capabilities. `AGENTS.md` supplies standing repository policy.
Human documentation explains the system, and executable checks enforce it.
One layer may point to another, but copying the same policy into every layer
creates drift.

## Read-only instrument discovery

Run `node scripts/inspect-instrument.mjs puggler` before opening many unrelated
files. Use a catalogue ID; `--json` includes dependency edges and test candidates.
The helper resolves its own checkout even when invoked by absolute path from
another directory, reports the running Node executable and Git state, and uses
the live public navigation, catalogue, and MIDI-capability exports. It neither
imports the page application nor starts audio, a server, a build, or tests. It
requires no installed npm packages. Use the Node versions documented in
`CONTRIBUTING.md` for subsequent commands.

The inventory follows static HTML/CSS/module references and literal module URLs.
It labels template-expanded and quoted binary paths as candidates; runtime
expressions and externally fetched dependencies still need source/browser
inspection. WAX byte differences can be expected build transformations, and a
tracked file may still need a build allowlist entry. Use `npm run check:wax-dist`
for fresh-build parity. Test candidates and capability declarations are starting
points, not proof of behavior. Select the commands appropriate to the edit;
the helper's output is not a request to run every listed suite.

## Repository placement

- Keep the public overview and quick start in root `README.md`.
- Keep the human contributor workflow in root `CONTRIBUTING.md`, a location
  GitHub recognizes and surfaces automatically.
- Keep cross-agent rules in root `AGENTS.md`. Add a nested `AGENTS.md` only when
  a subtree truly differs; guidance closer to the working directory wins.
  `AGENTS.override.md` is Codex-specific and replaces only the `AGENTS.md`
  candidate in the same directory; broader files in the instruction chain still
  load. It is not portable shared guidance, so reserve it for an intentional
  provider-specific case.
- Keep repository skills in `.agents/skills/<lowercase-name>/SKILL.md`. Both
  Codex and GitHub Copilot discover this shared location.
- Keep GitHub workflows and review templates under `.github/`. Create
  `.github/copilot-instructions.md` only for a genuinely Copilot-specific rule;
  do not mirror `AGENTS.md` into it.
- If an MCP server is actually added, co-locate its source, package metadata,
  schemas, README, and tests in the owning package or service location selected
  by the approved design. GitHub defines no standard MCP source directory. A
  remotely deployed service changes the current static architecture and needs
  an explicit design and operations decision.
- Add project-scoped `.codex/config.toml` or `.github/mcp.json` only for a real,
  tested connection. GitHub-hosted Copilot MCP connections are configured in
  repository settings. Commit endpoint metadata and environment-variable names
  only; keep all credential values in the host's secret store.

## Skill lifecycle

### Create

Create a skill when a workflow is specialized, non-obvious, and likely to be
reused, or when a fragile/high-consequence procedure benefits from one reviewed
path. Do not create a skill for a one-off task, generic engineering advice, or
a short always-on rule. Do not use a skill to simulate live external access; a
repeatable workflow may pair a skill with MCP and declare that dependency in
`agents/openai.yaml` where the host supports it.

Every skill has one focused job. Its directory name and frontmatter `name` use
lowercase letters, digits, and hyphens. Its `description` states what it does,
when it should trigger, and a nearby case that should route elsewhere when that
boundary prevents confusion.

Keep the entrypoint concise:

```text
.agents/skills/example-skill/
|-- SKILL.md             required instructions and frontmatter
|-- scripts/             optional deterministic helpers
|-- references/          optional details loaded only when needed
|-- assets/              optional files copied or adapted into outputs
`-- agents/openai.yaml   optional UI metadata and dependencies
```

Start instruction-only. Add a script when repeatable deterministic execution is
more reliable than regenerating commands or code. Add a reference only when a
conditional workflow needs substantial detail. Do not add empty directories,
duplicated manuals, changelogs, or examples without a concrete consumer.

### Use

Use a skill when the user names it or the request matches its description.
Read its complete `SKILL.md`, then only the supporting references required for
the selected path. A skill guides the authorized task; it does not broaden the
user's scope or grant permission for external mutations.

### Validate and update

For a new or substantially changed skill:

1. Validate its structure and frontmatter against each target host's current
   requirements, using that host's validator when one is available.
2. Exercise a prompt that should trigger it, a close prompt that should not,
   and an ambiguous prompt that tests its routing boundary.
3. Run every added or changed helper script with representative input.
4. Confirm commands, file paths, dependencies, outputs, and permission
   boundaries against the current repository.

Update a skill when a referenced command, contract, dependency, tool name,
expected output, or trigger boundary changes, or when real use demonstrates a
specific failure. Prefer a narrow correction backed by that evidence. Review
callers before renaming, merging, or removing a skill, and update any
project-specific routing entry in the root `AGENTS.md` when it adds information
beyond the skill's own description.

## MCP lifecycle

### Decide and design

Start from user outcomes and required permissions, not from an upstream REST
API inventory. Use the MCP primitives deliberately:

- **Tools** are model-invoked queries, computations, and actions.
- **Resources** are URI-addressable context that a host can list, read, attach,
  cache, or subscribe to.
- **Prompts** are user-selected message templates. Mandatory authorization and
  safety policy belongs in server code, never only in a prompt.

Split reads from writes and separate operations with different authorization or
risk. Avoid exposing the same operation as several near-identical tools. Before
implementation, record the target hosts, transport, supported protocol
revisions, auth model, scopes, data classification, retention, rate limits,
upstream dependencies, owner, deployment, rollback, and deprecation plan.

### Current protocol baseline

The protocol review for this guide used MCP `2026-07-28`, the current revision
on 2026-09-06. That revision is stateless and uses required per-request
protocol/client metadata. Servers implementing it must support
`server/discover`. A client may call discovery to select a version up front,
but that call is optional; it may instead send another request directly and
handle `UnsupportedProtocolVersion`.

New work should use an official, actively maintained SDK and pin its version.
Use stdio for a local child process or Streamable HTTP for a shared service.
Do not build new features on deprecated HTTP+SSE transport, protocol Logging,
Roots, Sampling, or Dynamic Client Registration. Use Streamable HTTP,
stderr/OpenTelemetry, explicit parameters/resources/configuration, direct
provider APIs, and Client ID Metadata Documents respectively. Advertise only
the protocol revisions exercised against every supported host; older stateful
revisions require their own compatibility tests.

Review the current specification, SDK tier/status, and deprecated-feature
registry before each release. The review date above makes protocol drift
visible; it does not freeze `latest` into a permanent dependency.

### Tool and data contracts

- Give each tool a stable action-oriented name and a description that explains
  its user outcome, prerequisites, important limits, and distinction from
  nearby tools. Names are case-sensitive, unique within the server, 1–128
  characters, and limited to ASCII letters, digits, `_`, `-`, and `.`.
- Define and server-validate bounded JSON Schema inputs and outputs. Reject
  unknown fields where they cannot be meaningful. Return structured results
  and stable opaque identifiers for follow-up operations. JSON Schema defaults
  to draft 2020-12. `outputSchema` is optional, but when present the returned
  `structuredContent` must conform to it; current results also carry
  `resultType`.
- Set read-only, destructive, idempotent, and open-world annotations truthfully,
  but treat them as interface hints rather than authorization enforcement.
- Keep list and search results bounded. Use opaque cursors with deterministic
  ordering, a unique tie-breaker, authorization/filter binding, and a maximum
  page size.
- Under `2026-07-28`, complete results from exactly `server/discover`,
  `tools/list`, `prompts/list`, `resources/list`, `resources/templates/list`,
  and `resources/read` must include nonnegative `ttlMs` and `cacheScope`.
  `input_required` results are not cacheable. Use `private` whenever output
  varies by authorization context, and keep `cacheScope` consistent across all
  pages of one list request.
- Use JSON-RPC errors for malformed protocol requests and unknown methods. Use
  an error tool result for a correctable validation, business, or upstream
  failure. Return a stable safe category and actionable message without stack
  traces, tokens, SQL, internal paths, or raw upstream bodies.
- MCP is stateless. Make application state explicit with opaque, expiring
  handles bound to and reauthorized for the current principal.
- An idempotency annotation is not implementation. For non-idempotent writes
  that may be retried, accept an idempotency key or use an equivalent upstream
  deduplication or conditional-write mechanism. Bind a key to principal +
  operation + canonical request, replay the original result for an identical
  retry, reject reuse with another payload, and define retention and
  concurrent-call behavior.
- For Codex targets that consume server instructions, reserve them for concise
  cross-tool workflow, constraint, and rate-limit guidance. Keep the first 512
  characters self-contained and enforce every real boundary in server code.

### Security and operations

- MCP authorization is optional. Its OAuth profile applies to HTTP; stdio
  servers should obtain credentials from their environment instead. Require a
  valid access token for each protected MCP request and authorize every tool,
  resource, object, and state-handle access, while leaving required OAuth
  discovery metadata retrievable without a token. Use least-privilege scopes
  and separate read from write access.
- At an HTTP MCP resource server, validate each access token using the mechanism
  appropriate to its format: local verification for a self-contained token, or
  authorization-server introspection/shared state for a reference token.
  Confirm that it is active and unexpired, was issued by a trusted authorization
  server specifically for this MCP resource, and covers the current operation;
  publish Protected Resource Metadata. If the deployment also owns OAuth client,
  proxy, or authorization-server flows, separately enforce state, PKCE,
  issuer-response, redirect, and SSRF protections. Never accept or transit a
  token issued for another resource.
- For Streamable HTTP, validate `Origin` on every connection and return 403 when
  a present origin is invalid. Bind a local server to loopback rather than
  `0.0.0.0`. Use HTTPS remotely and authentication unless the endpoint is
  deliberately public.
- Validate and normalize all model-controlled input. Prevent traversal, SSRF,
  unsafe redirects, cross-tenant identifiers, prompt-injection propagation,
  oversized payloads, and unbounded output or concurrency.
- Servers treat model arguments and upstream content as untrusted. Clients
  treat metadata, annotations, and results from untrusted servers as untrusted.
  Require a clear host/user confirmation boundary for consequential actions and
  enforce permission again on the server.
- Keep secrets out of prompts, resources, tool results, `_meta`, URI query
  strings, and parameters marked `x-mcp-header`; access tokens must never appear
  in query strings. Return personal data only when necessary and authorized.
- Reserve stdout exclusively for JSON-RPC on stdio servers; write structured
  diagnostics to stderr. Use OpenTelemetry for a service. Redact credentials,
  cookies, personal data, prompts, and payloads by default, and test redaction.
- Set explicit upstream and tool timeouts, support cancellation where the
  operation can stop, bound retries with jitter, honor rate limits, and release
  processes, sockets, streams, and tasks during shutdown.
- Keep an audit trail for state-changing operations and monitor latency,
  outcomes, timeouts, cancellations, auth failures, rate limits, retries, and
  upstream health without logging sensitive content.

### Verify

An MCP change is complete only when the evidence matches what it claims:

1. Unit-test schemas, bounds, output validation, error mapping, authorization,
   cursors, idempotency, sanitization, and redaction.
2. Contract-test discovery, capability listings, tool/resource/prompt schemas,
   annotations, structured results, cache metadata, and server instructions.
3. Exercise invalid JSON-RPC, unauthorized and cross-tenant access, injection,
   traversal, SSRF, oversized data, upstream 401/403/429/5xx responses,
   timeouts, cancellation, retry-after-commit, and concurrent duplicate writes.
4. Run the official MCP conformance suite against each claimed protocol
   revision and use MCP Inspector for interactive protocol diagnosis.
5. Test tool selection with direct, implicit, close-confusion, and out-of-scope
   prompts, plus required read-before-write and consequential-action flows.
6. Smoke-test every advertised host, including Codex or GitHub Copilot where
   applicable. Protocol conformance alone does not prove host UX or good tool
   selection.

### Release and maintain

Track the MCP protocol revision, server/package semantic version, SDK version,
upstream API version, and transport independently. Treat tool names,
descriptions, schemas, scopes, and side effects as public API contracts. Make
compatible additions where possible; never silently repurpose a tool name.
Give incompatible changes a new major server version or versioned tool path,
a migration window, and rollback evidence.

A release review covers schema diffs, auth/scope changes, tests, conformance,
host smoke tests, dependency and secret scans, documentation, staging/canary
behavior, observability, and rollback. After deployment, verify discovery,
auth, representative reads and writes, advertised versions, public docs,
metrics, and redaction against the deployed bytes.

Revisit the specification, deprecations, SDK security/support status, OAuth
metadata and key rotation, scopes, tool-catalog drift, negative selection
tests, limits, retention, and removal dates whenever one changes and at least
quarterly for an operated service.

## Primary references

- [OpenAI: Codex MCP configuration and server instructions](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [OpenAI: build and locate skills](https://learn.chatgpt.com/docs/build-skills)
- [OpenAI: layer project instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [GitHub: choose custom instructions, AGENTS.md, or skills](https://docs.github.com/en/copilot/concepts/agents/code-review#choosing-between-custom-instructions-agentsmd-and-skills)
- [GitHub: add repository agent skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills)
- [MCP 2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28)
- [MCP versioning](https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning)
- [MCP deprecated-feature registry](https://modelcontextprotocol.io/specification/2026-07-28/deprecated)
- [MCP security best practices](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)
- [MCP Inspector](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector)
- [MCP conformance suite](https://github.com/modelcontextprotocol/conformance)
