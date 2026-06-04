# Computer Use Hardening

## Goal

Close the highest-impact gaps against Codex-style computer use:

- Return a single coherent app state snapshot from `getAppState`.
- Keep the legacy flat `Observation.elements` contract compatible.
- Implement real `scroll` execution in the macOS helper.
- Re-observe after successful UI actions so verification works on post-action state.
- Make trace timestamps and latency metadata useful for diagnosis.
- Fail early when required macOS permissions are missing.

## Compatibility

The existing `Observation` fields remain intact:

- `id`
- `target`
- `source`
- `timestamp`
- `elements`
- `metadata`

The upgraded fields are optional:

- `screenshot`
- `accessibilityTree`
- `focusedElementId`
- `focusedWindow`
- `windows`
- `coordinateSpace`
- `permissions`

Existing consumers that only read `elements` should continue to work.

## Behavior Changes

- Native runs now preflight `accessibility` and `screenRecording`.
- Missing required permissions return a blocked run with a clear `PERMISSION_REQUIRED` result.
- Successful `click`, `type`, `key`, and `scroll` actions now call `getAppState` afterward.
- Successful `secondary-click`, `hover`, and `drag` actions also call `getAppState` afterward.
- Explicit state-change verification is available with `waitForStateChange` action input.
- Action retry metadata is available through explicit `retries` action input.
- Trace events now get per-event timestamps instead of sharing the run start timestamp.
- Result/trace metadata includes helper latency and first state/action timing.
- `scroll` direction and amount are parsed from use case step text when present.

## Implementation Notes

- The Swift helper keeps the top-level `getAppState` response shape: `target`, `windows`, `observation`.
- `observation.accessibilityTree` is derived from the existing AX path metadata, while `observation.elements` remains flat.
- `observation.screenshot` is omitted when Screen Recording is missing; permission state is still reported.
- `scroll` uses a real scroll wheel event against the target app and reports direction, amount, delta, and input method.
- `secondary-click` posts a verified right-button HID click at either the bound element center or explicit `x/y`.
- `hover` posts a verified HID mouse move at either the bound element center or explicit `x/y`.
- `drag` posts a verified HID drag from an element center or `x/y` to `toX/toY`, or by `deltaX/deltaY`.
- Drag input is normalized to `x/y/toX/toY` or `x/y/deltaX/deltaY`; runner code does not invent `0,0` fallback coordinates.
- `MacScreenshot` now aliases the core `Screenshot` contract to avoid duplicate screenshot types.

## Verification Entry

The optional regression script is:

```bash
npm run build
node scripts/validate-hardening.mjs
```

It covers:

- pointer action parsing for `secondary-click`, `hover`, and `drag`
- fake runner post-action observations
- explicit state-change wait failure semantics

## Verification Status

No build or test command was run in this task, per the repository instruction to avoid running tests/builds unless explicitly requested.

Recommended checks when allowed:

- `npm run typecheck`
- `npm run check`
- `swift build` from `native/mac-helper`
