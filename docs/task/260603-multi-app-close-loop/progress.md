# Progress

## Status

- Task: active
- Stage: M2 complete, M3 in progress
- Next: finalize architecture review notes and update knowledge

## What is already proven

- QQ Music UC-100 is already in the repo contract.
- Sublime Text UC-110 completed full closed loop with file-system verification.
- Native runner already carries app-specific verification logic for both apps.
- Swift helper already carries app-specific input fallbacks for both apps.
- Trace exists as a first-class artifact, not a debug afterthought.
- Policy is evaluated before every action and blocked paths are explicit.

## Evidence

- [usecases/cases.yaml](../../../usecases/cases.yaml) - UC-100 and UC-110 definitions
- [UC-110 pass evidence](../evidence/uc-110-pass.md) - complete trace and file-system proof
- [src/usecases/native-runner.ts](../../../src/usecases/native-runner.ts) - app-specific binding and verification
- [src/usecases/sublime-text.ts](../../../src/usecases/sublime-text.ts) - Sublime Text adapter logic
- [native/mac-helper/Sources/ComputerUseMacHelper/main.swift](../../../native/mac-helper/Sources/ComputerUseMacHelper/main.swift) - app-specific type fallbacks
- [README.md](../../../README.md)

## Decisions so far

- Keep app-specific logic isolated until the second app exposes a real common pattern.
- Use Sublime Text as the second app because it forces a different shape: text entry, menu or shortcut handling, and file-system verification.
- Treat the saved file contents as the primary success signal for Sublime, not just CLI `ok`.
- Sublime Text uses paste-based text input (no AX text input elements exposed).
- Dialog handling is explicit in steps for now; may be automated in app adapters later.

## Architecture review findings

- ✅ Protocol boundaries (CLI/Runtime/Helper/Policy/Trace) are very clear
- ⚠️ App-specific logic scattered across multiple files
- Recommendation: establish App adapter pattern before adding 3rd app
- See [review/architecture-review.md](../review/architecture-review.md) for full findings

## Next actions

1. Update README with UC-110 status
2. Extract architectural insights to long-term knowledge
3. Update ROADMAP M6/M7 status based on real implementation
