---
name: computer-use
description: Drive native macOS apps from the shell via the local `computer-use` CLI — observe app state, issue atomic open/click/type/key/scroll/drag/hover/extract actions, run predefined UI use cases, and read structured JSON traces. Use when a task needs to observe or operate a desktop app on this Mac. macOS 14+ only.
metadata:
  platform: macos
  version: "0.1.0"
---

# computer-use

A macOS-first local computer-use runtime. You invoke it as a plain CLI from your shell tool. **All output is JSON on stdout** — parse it, don't scrape prose. It is the only thing printed; logs never pollute stdout.

## When to use this

Use it when a task needs to look at or operate a native macOS application — read an app's window/accessibility state, or run a UI flow (open an app, find an element, click/type/scroll) and get an auditable trace back.

## Prerequisites (verify before relying on it)

- **macOS 14+ only.** On any other platform, stop and tell the user it's unsupported.
- The `computer-use` command should be on PATH. If `computer-use version` fails, it isn't installed — see *Install*.
- Real macOS runs auto-discover the helper in this order: `--mac-helper`, `COMPUTER_USE_MAC_HELPER`, `COMPUTER_USE_HARNESS_DIR`, then the repo default build path.
- **macOS permissions** for real (non-fake) runs: AX-first actions require **Accessibility**. Screenshot/OCR/vision modes additionally require **Screen Recording**. Check with `policy-check`; if the action returns `PERMISSION_REQUIRED`, tell the user which permission to grant — you cannot grant it for them.

## Command surface

```
computer-use version
computer-use doctor [--app <name-or-bundle-id> | --pid <pid> | --window-title <title>] [--fake | --mac-helper <path>] [--pretty]
computer-use apps [--running [--fake | --mac-helper <path>]] [--pretty]
computer-use resolve-app (--app <name-or-bundle-id> | --pid <pid> | --window-title <title>) [--fake | --mac-helper <path>] [--pretty]
computer-use capabilities --app <name> [--pretty]
computer-use screenshot (--app <name-or-bundle-id> | --pid <pid> | --window-title <title>) [--fake | --mac-helper <path>] [--out <path>] [--pretty]
computer-use text (--app <name-or-bundle-id> | --pid <pid> | --window-title <title>) [--fake | --mac-helper <path>] [--pretty]
computer-use action <kind> (--app <name-or-bundle-id> | --pid <pid> | --window-title <title>) [--fake | --mac-helper <path>] [--pretty]
computer-use <observe|open|click|type|key|scroll|drag|hover|extract|policy-check> (--app <name-or-bundle-id> | --pid <pid> | --window-title <title>) [--fake | --mac-helper <path>] [--pretty]
computer-use usecases list [--cases <path>] [--pretty]
computer-use usecases dry-run [id] [--cases <path>] [--pretty]
computer-use usecases run <id> [--cases <path>] [--fake | --mac-helper <path>] [--pretty]
computer-use trace --last [--pretty]
```

**Important model of how this tool works:** predefined use cases and atomic actions are both first-class:

- Use `computer-use usecases run ...` when the workflow is known and should be replayable as a named regression case.
- Use `computer-use observe/click/type/key/scroll/...` when an agent or shell loop is deciding step-by-step from the current app state.
- Every atomic action still does policy preflight, AX-first observation when needed, post-action observation, verification metadata, stable JSON output, and JSONL trace writing.
- Result trace events carry `actionTraceStep`: before/after observation evidence, `execution.inputBackend` (`ax-semantic` / `app-targeted-event` / `global-hid`), verification status, and virtual pointer overlay metadata when a screenshot is available.

- `doctor` — preflight CLI/helper/permissions/running-app/target-window readiness.
- `apps` — list registered app capabilities. It is not a running-process list.
- `apps --running` — list running apps from the helper.
- `resolve-app --app <target>` — resolve a user-facing app name against registry, running apps, and windows.
- `--pid <pid>` / `--window-title <title>` — target a specific running process or window when names/bundle ids are ambiguous.
- `capabilities --app <name>` — what the tool can do for one app.
- `observe --app <target>` — read AX-first app state without mutating UI.
- `observe --text --app <target>` — include a flat visible text list.
- `observe --summary --app <target>` — include compact UI summary: visible text, inputs, controls, windows.
- `text --app <target>` — return only visible text + summary from the current observation.
- `screenshot --app <target> --out /tmp/shot.png` — capture app screenshot evidence.
- `click --app <target> --keyword <name>` — bind a visible AX element by semantic name and click it.
- `click --app <target> --x <n> --y <n>` — coordinate click, guarded by target-window verification in the helper.
- `type --app <target> --text <text> [--keyword <input-name>]` — type text into the resolved/focused input.
- `type --pid <pid> --x <n> --y <n> --text <text>` — focus an unnamed/split input at a point, then paste text.
- `key --app <target> --key Enter` — send a key or chord; digits such as `--key 8` are supported.
- `scroll --app <target> --direction down --amount 2` — scroll then observe again.
- `extract --app <target> --query <question> [--fields a,b]` — extract structured data from the current observation.
- `policy-check --app <target>` — check helper permissions and policy without UI mutation.
- `usecases list` — every available use case (id, title, required permissions).
- `usecases dry-run [id]` — show the steps a use case *would* run, executing nothing. Safe to inspect.
- `usecases run <id> --fake` — run with a simulated adapter (no real UI touched). Use to validate wiring/output.
- `usecases run <id>` — run for real against macOS via the Swift helper. `--mac-helper <path>` is only needed to override auto-discovery. `--fake` and `--mac-helper` are mutually exclusive.
- `trace --last` — re-read the most recent trace.

## Output shape (every command)

```json
{ "ok": true,  "command": "<name>", "data": { ... } }
{ "ok": false, "command": "<name>", "error": { "code": "<CODE>", "message": "...", "details": {} } }
```

Always check `ok` first. A business failure still returns valid JSON with `ok:false` and an `error.code` (e.g. `INVALID_RUN_MODE`, `UNKNOWN_USE_CASE`, `MISSING_APP_NAME`, `TRACE_NOT_FOUND`). Exit code: `0` ok, `2` usage/business error, `1` unexpected.

An atomic action `data` carries: `mode: "native-action"`, `status`, `traceId`, `target`, `action`, `result`, optional final `observation`, full `trace[]`, and `tracePath`. Inspect both top-level `ok` and `data.status`; use `--fail-on-action-failed` when shell control flow should stop on `failed`/`blocked`. Inspect the final result event's `actionTraceStep` before trusting an action as complete; it is the contract for observe -> action -> observe -> verify.

A `usecases run` `data` carries: `caseId`, `title`, `status` (`passed`/…), `mode` (`fake`/`native`), `traceId`, `steps[]` (each with `description`/`status`), `success[]` (the asserted success criteria), `trace[]` (full event log), and `tracePath`. Traces are JSONL at `.computer-use/traces/<traceId>.jsonl`; the latest path is in `.computer-use/traces/last`.

## Typical flow

```sh
# 1. Confirm it runs at all
computer-use version

# 2. Check runtime readiness before any real run
computer-use doctor --app Finder --pretty
#   → AX-first commands need accessibility; visual modes also need screenRecording

# 3. See what's available
computer-use apps
computer-use apps --running --pretty
computer-use resolve-app --app Finder --pretty
computer-use resolve-app --pid 12345 --pretty
computer-use usecases list

# 4. Drive one step at a time when an agent is making live decisions
computer-use observe --app Finder --summary --text --pretty
computer-use observe --pid 12345 --summary --text --pretty
computer-use screenshot --app Finder --out /tmp/finder.png --pretty
computer-use click --app Finder --keyword Downloads --description "click item named Downloads" --pretty
computer-use type --pid 12345 --x 750 --y 498 --text 888888 --pretty
computer-use key --pid 12345 --key 8 --pretty
computer-use scroll --app Finder --direction down --amount 2 --pretty

# 5. Inspect a use case without touching anything
computer-use usecases dry-run UC-020 --pretty

# 6. Dry-validate the harness with a simulated run
computer-use usecases run UC-030 --fake

# 7. Run for real against macOS
computer-use usecases run UC-020 --pretty

# 8. Re-read the trace
computer-use trace --last --pretty
```

Prefer `--fake` or `dry-run` first when unsure — they prove the use case resolves and show the steps before anything real happens.

## Install / build (point the user here if the command is missing)

```sh
# In the computer-use-harness repo:
npm install          # Node >= 22
npm run build        # TS → dist/cli/index.js (made executable)
npm install -g .     # put `computer-use` on PATH

# Native macOS execution needs the Swift helper (macOS 14+, Swift 6):
cd native/mac-helper && swift build
# helper binary → native/mac-helper/.build/debug/computer-use-mac-helper
# CLI auto-discovers this path; set COMPUTER_USE_MAC_HELPER only for custom helper builds
```

## Hard limits — do not invent capability

- **No hidden app-specific scripts.** Atomic commands are generic. Do not add QQ Music/Feishu/Multica-only flow logic to the skill or CLI wrapper; let the agent observe, decide, act, then observe again.
- **Disambiguate before acting.** If multiple Electron windows share the same bundle/name, use `apps --running`, then target with `--pid` or `--window-title`; do not rely on fuzzy name matching.
- **Coordinates are last resort.** Prefer AX keyword/element binding first; use screenshot/vision or coordinates only when AX evidence is insufficient.
- **macOS only.** Don't claim it works elsewhere.
- **Permissions are the user's to grant.** If a real run returns `PERMISSION_REQUIRED`, report the missing permission and stop — don't retry blindly.
- Reads `ANTHROPIC_API_KEY` from env for vision/extraction capabilities; native runs that need extraction fail without it.
