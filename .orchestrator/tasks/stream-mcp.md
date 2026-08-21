# Stream: MCP server for agent control

**Worktree:** `.claude/worktrees/mcp` — branch `stream-mcp`. Work ONLY in there.

## Goal
Let an LLM agent discover, register, pair, and control Android TVs entirely through MCP,
mounted on the same FastAPI app and port as the REST API.

## Read first
- `docs/design/api-contract.md` — the "MCP" section lists every tool and resource. Frozen.
- `docs/design/architecture.md` — auth model and `/mcp` mount point
- `docs/design/conventions.md` — Python header format (`#` block, not a docstring)
- `server/app/models.py` and `server/app/errors.py` — the shared models and error codes

## Files to touch
- `server/app/mcp_server.py` — the whole MCP server
- `server/tests/test_mcp.py`
- `docs/mcp.md` — operator-facing setup guide

Nothing else. The backend stream owns the rest of `server/app/` and is being written in
parallel, so **code against the `DeviceManager` facade exactly as the contract declares it**
and do not assume any other internals.

## Requirements
- Use the official `mcp` Python SDK's `FastMCP`, exposed over **streamable HTTP** so remote
  agents can reach it across the LAN. Expose the ASGI app as
  `def build_mcp_app(manager: DeviceManager) -> ASGIApp` (or a `FastMCP` whose
  `.streamable_http_app()` the backend can mount at `/mcp`). Keep the coupling to a single
  factory function so the backend stream can mount it with one line.
- Import `DeviceManager` lazily / under `TYPE_CHECKING` so this module imports cleanly even
  while `server/app/devices.py` is still landing on another branch.
- Implement every tool in the contract: `list_devices`, `discover_devices`,
  `register_device`, `pair_device`, `complete_pairing`, `unpair_device`, `remove_device`,
  `rename_device`, `get_device_state`, `send_key`, `send_keys`, `send_text`, `launch_app`,
  `set_power`, `set_volume`, `list_keys`, `list_apps`.
- Implement the four resources: `androidtv://devices`, `androidtv://devices/{device_id}`,
  `androidtv://keys`, `androidtv://apps`.
- **Never raise out of a tool.** Catch `RemoteError` and return
  `{"error": {"code", "message"}}` so the agent can recover and retry.
- **Pairing is human-in-the-loop.** An agent cannot see the TV screen. `pair_device` must
  return text that explicitly instructs the agent to ask the human to read the code off the
  television and then call `complete_pairing`. Write that instruction into the tool's
  docstring/description too — the description is what the agent actually reads.
- Every tool description must be written for an agent audience: say what it does, when to
  reach for it, and what it returns. Vague descriptions make the tools unusable in practice.
- `send_keys` takes a list and sends them in order with a small delay, so an agent can do
  "launch Netflix, then down three, then select" in one call.
- Honour `REMOTE_API_TOKEN` — the same bearer token as the REST API guards `/mcp`.

## `docs/mcp.md`
Operator-facing: the `/mcp` URL, how to add it to Claude Code / Claude Desktop
(`claude mcp add --transport http androidtv http://<host>:7433/mcp`), how to pass the token,
the full tool list, and a worked example of an agent pairing a new TV end to end.

## Acceptance criteria
- [ ] `python -m pytest server/tests/test_mcp.py -q` passes against a stub `DeviceManager`.
- [ ] Tests assert every contract tool exists, that errors come back as `{"error": ...}`
      rather than raising, and that `pair_device`'s response tells the caller to ask a human.
- [ ] `python -c "import app.mcp_server"` succeeds from `server/` with no running backend.
- [ ] `docs/mcp.md` exists and its instructions are literally runnable.
- [ ] Headers per conventions.md.

## Out of scope
Any other file in `server/app/`, anything under `web/`, `tray/`, or `docker/`.
