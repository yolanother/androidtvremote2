<!--
Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
repository root.

Coding and workflow conventions for the Android TV Remote appliance rebuild. Records the
exact file-header format the orch pre-commit hook accepts per language, the branch and
worktree rules that keep parallel workstreams from colliding, the file-ownership map that
assigns every path to exactly one stream, and the verification gates each stream must pass
before integrating. Read this before writing any file in this repository.
-->

# Conventions

## File headers — exact format the hook accepts

`orch`'s pre-commit hook checks every source file for a copyright/LICENSE reference **and**
a purpose description. It is picky about the comment syntax, and a module docstring alone
does **not** satisfy it.

### Python — `#` comment block, then a short docstring

A docstring by itself is rejected with "missing a file-purpose description in the header",
no matter how good the docstring is. The header must be a `#` comment block at the very
top of the file:

```python
# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# <2-4 sentences describing what this module does and its responsibility in the system.
# Written to stand alone: this text is ingested into the knowledge base as the file's
# purpose, so "what does this file do?" must be answerable from the header alone.>
"""One-line module summary."""
```

### TypeScript / JavaScript / CSS — `/** */` block

```ts
/**
 * Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
 * repository root.
 *
 * <2-4 sentences describing the file's purpose.>
 */
```

### Markdown — HTML comment

```markdown
<!--
Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
repository root.

<2-4 sentences describing the document's purpose.>
-->
```

Keep headers current. If a file's behaviour changes, update its header in the same commit
— stale headers poison the knowledge base.

## Docs and symbols

Public classes, functions, and attributes get full docstrings with `:param:`, `:returns:`,
and `:raises:` (Python) or TSDoc `@param`/`@returns` (TypeScript). Private helpers get a
lighter version of the same. This is enforced by review, not a hook.

## Parallel workstreams

Every stream works in its **own git worktree on its own branch**, and touches only the
paths it owns. Worktrees live in `.claude/worktrees/<slug>` on branch `<slug>`.

| Stream | Branch | Owns |
|---|---|---|
| Container | `stream-container` | `docker/`, `docker-compose*.yml`, `.dockerignore`, `scripts/`, `.env.example` |
| Backend | `stream-backend` | `server/app/**` except `mcp_server.py`, `server/tests/**` |
| MCP | `stream-mcp` | `server/app/mcp_server.py`, `server/tests/test_mcp.py`, `docs/mcp.md` |
| Web UI | `stream-web` | `web/**` except `web/src/embed/**` |
| Embed | `stream-embed` | `web/src/embed/**`, `docs/embedding.md` |
| Tray | `stream-tray` | `tray/**` |

Shared, contract-only files (`docs/design/*.md`, `web/src/lib/api-types.ts`,
`server/app/{config,models,errors}.py`) are **frozen**. A stream that believes one must
change raises it on the epic instead of editing it.

## Verification gates

Before a stream integrates, from inside its worktree:

- **Backend / MCP**: `python -m pytest server/tests -q` passes, and
  `python -c "from app.main import create_app; create_app()"` succeeds from `server/`.
- **Web / Embed**: `npm run build` in `web/` passes (this runs `tsc -b` then `vite build`).
- **Container**: `docker compose build` succeeds and the container answers `/healthz`.
- **Tray**: `npm run build` in `tray/` passes and `cargo check` succeeds in `tray/src-tauri`.

## Integration

Integration into `main` happens one stream at a time, under the `.worktree-merge` lock,
via `.orchestrator/scripts/worktree-merge.sh <sha>...`. Build and test **inside the
worktree first** — never inside the lock window.
