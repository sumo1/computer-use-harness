# Driving Electron / Chromium apps via the mac-helper (field notes)

2026-06-09, while dogfooding computer-use to drive the Multica desktop client.

## Two things must both be right to read a Chromium app's AX tree

1. **Wake Chromium accessibility.** Chromium (Chrome, Electron, etc.) keeps the
   per-renderer AX tree dormant until an assistive client sets `AXManualAccessibility`
   (Chromium's documented opt-in) on the app AXUIElement. Without it,
   `AXUIElementCreateApplication(pid)` returns an app with windows but no
   descendant elements (empty AXWebArea). The mac-helper now sets this in
   `wakeChromiumAccessibility()` before every AX read (collectAXElements,
   action-element resolution, etc.). `AXEnhancedUserInterface` is set too as a
   fallback for non-Chromium toolkits.

   Verified: a standalone Swift AX dump against Multica Canary showed the tree
   only after setting AXManualAccessibility; the app's attribute list then
   includes "AXManualAccessibility".

2. **Call with the right target field.** `findRunningApp(target:)` reads
   `target["id"]` (bundle id) and `target["name"]` — NOT `appId`. Passing
   `{"appId": "..."}` makes the matcher return nil → collectAXElements returns
   `[]` (it guards on `findRunningApp`). This silently looks identical to "empty
   AX tree" but is actually "app not found". Always pass:
   `params: {"target": {"id": "<bundle-id>", "name": "<localized name>"}}`.

   The use-case YAML `target: {kind, id, name}` already uses the right shape;
   the trap is only when calling the helper's JSON-RPC by hand.

## Result

With both fixed, Multica Canary (com.github.Electron) returns 271 AX elements —
AXButton "Go back", AXPopUpButton "E E2E Test", nav AXLinks (助理/小队/收件箱),
etc. — fully drivable.

## macOS deprecation (pre-existing, not blocking)

`CGWindowListCreateImage` is deprecated in favor of ScreenCaptureKit; the
screenshot path needs porting to SCKit. AX-tree-driven interaction does not
depend on it.
