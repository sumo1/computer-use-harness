# Step 01 - Sublime Text usecase contract

## Goal

Add a second real desktop App closed loop that exercises text editing and file save verification.

## Construction contract

- Introduce UC-110 in `usecases/cases.yaml`.
- Target the installed Sublime Text app; resolve the exact bundle id during implementation from the local app registry.
- Flow: open app -> new document -> type a sentinel string -> save to a temp file -> verify the file bytes on disk.
- Keep any Sublime-specific behavior isolated behind an app-specific adapter or fallback, not buried in the generic runner.
- Record trace events for open, type, save, and verification.
- Prefer the native helper path for real UI actions; do not trust AX state alone.

## Acceptance contract

- `computer-use usecases list` shows UC-110.
- `computer-use usecases dry-run UC-110` shows the planned steps and success criteria.
- `computer-use usecases run UC-110 --mac-helper <helper>` reaches `passed` on a real local Sublime Text session.
- The saved file exists at the expected path and contains the exact sentinel text.
- Trace includes ordered observation / action / result events and the file-system verification evidence.

## Sentinel

- Text: `computer-use-harness: uc-110`
- Save target: a temp path under `$TMPDIR/computer-use-harness/uc-110.txt`

## Non-goals

- Do not generalize file-saving heuristics until a second app forces a shared pattern.
- Do not move Sublime-specific quirks into the generic runtime without evidence.
- Do not treat CLI `ok` without file-system proof as success.
