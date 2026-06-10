# Progress: React Loop Computer Use Runtime

## 2026-06-10

- [x] 明确任务范围：通用 ReAct/事件闭环，而不是 QQ 音乐或飞书专用链路。
- [x] 明确 virtual pointer 定义：trace/overlay 可视化状态，不是第二个系统鼠标。
- [x] 明确输入后端优先级：AX semantic -> app-targeted event -> global HID fallback。
- [x] 明确端到端验证是唯一通过标准。
- [x] Phase 1: Trace Contract
- [x] Phase 2: Input Backend Router
- [x] Phase 3: Observe-Action-Observe-Verify Loop
- [x] Phase 4: Virtual Pointer Overlay Metadata
- [x] Phase 5: E2E Validation

## Implementation Evidence

- Added shared `ActionTraceStep`, `InputBackendMetadata`, `VirtualPointerState`, and `ActionVerificationResult` contracts.
- Native atomic actions and native usecase runs now attach an `actionTraceStep` to result trace events.
- macOS helper success results now expose standardized `inputBackend` metadata for action methods.
- Click execution now uses the generic backend order: AX semantic first, app-targeted `postToPid` fallback, global HID only after that.
- Type/key execution now uses the same generic backend order and no longer branches on QQ Music or Sublime Text.
- Legacy helper functions for QQ Music search detection and Sublime Text target detection were removed from the macOS helper input path.
- Screenshot vision prompts no longer embed the old Jay Chou album example; extraction is now query-driven and returns generic insufficient-evidence status.
- CLI app aliases are resolved through the app registry before creating the action target; `--app Finder` now reaches `com.apple.finder` instead of leaking a display name into the helper.
- Result metadata includes a compact `actionTraceStep` summary with virtual pointer and SVG overlay data when screenshots are available.
- Virtual pointer trace coordinates stay in screen space, while SVG overlay coordinates are mapped into the captured window screenshot.
- Native action validation now asserts the overlay point is inside the screenshot bounds, preventing screen-coordinate leakage into window overlays.
- E2E validation now checks native action traces for before/after observations, verification, input backend, virtual pointer, and overlay metadata.
- Target-mode validation now checks settled target-loop actions for post-action observation evidence and input backend metadata.
- Target-mode candidates are now generic ordered records (`fields`, `ranking`, `evidenceText`) instead of album-specific `artist/releaseDate` objects.
- AX structured extraction is now driven by requested fields, textual constraints, and ranking value type (`date`, `file-size`, `number`) instead of date-ranked album heuristics.
- Added UC-120 as a non-music target-mode E2E: fake Finder Downloads list, ordered by `fileSize`, with scroll-until-stable coverage before returning the largest file.
- README and SKILL now document `actionTraceStep` as the observe -> action -> observe -> verify contract.

## Verification

- `npm run typecheck` passed on 2026-06-10 after the helper cleanup.
- `npm run build` passed on 2026-06-10 after the helper cleanup.
- `npm run validate:native-actions` passed on 2026-06-10 after the helper cleanup.
- `npm run validate:computer-use-loop` passed on 2026-06-10 after the helper cleanup.
- `npm run validate:e2e` passed on 2026-06-10 after the helper cleanup and screenshot-vision prompt cleanup.
- `swift build` passed in `native/mac-helper` on 2026-06-10 after the helper cleanup.
- `npm run typecheck && npm run validate:e2e` passed on 2026-06-10 after generic target-mode candidate/extractor refactoring and UC-120 addition.
- `npx biome check src/usecases/target-mode.ts src/capabilities/ax-structured-extractor.ts src/usecases/target-loop.ts src/usecases/native-runner.ts scripts/validate-computer-use-loop.mjs` passed on 2026-06-10 after the generic target-mode candidate/extractor refactoring.
- `npx biome check src/cli/index.ts src/capabilities/screenshot-vision.ts scripts/validate-native-actions.mjs src/actions/action-trace-step.ts src/actions/native-action-runner.ts src/core/contracts.ts src/usecases/native-runner.ts scripts/validate-computer-use-loop.mjs` passed on 2026-06-10 after the helper cleanup.
- Real macOS smoke passed on 2026-06-10: `open --app Finder --mac-helper native/mac-helper/.build/debug/computer-use-mac-helper` resolved `Finder` to `com.apple.finder`, completed `post-action-observe`, and captured 800 AX elements in `ax-only` mode.

Full `npm run check` still fails on pre-existing unrelated files outside this task scope.

## Notes

实现阶段不得新增 case-specific planner。真实应用 smoke 只能作为验证目标，不能反向污染核心决策逻辑。
