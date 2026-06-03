# UC-110 Sublime Text Evidence

## Run status

**PASSED** - 2026-06-03

## Command

```bash
./dist/cli/index.js usecases run UC-110 \
  --mac-helper ./native/mac-helper/.build/debug/computer-use-mac-helper
```

## Steps

All 7 steps passed:

1. open temp file in Sublime Text - **passed**
2. read app state - **passed**
3. dismiss registration dialog if present - **passed**
4. focus document window - **passed**
5. type computer-use-harness: uc-110 into document - **passed** (inputMethod: `sublime-text-pid-paste`)
6. press key Command+S - **passed**
7. verify saved file content - **passed** (verifier: `sublime-text-file-content`)

## File system evidence

```bash
$ cat /tmp/claude-501/computer-use-harness/uc-110.txt
computer-use-harness: uc-110
```

File exists at expected path with exact sentinel text.

## Key implementation details

### Dialog handling

Sublime Text shows an "unregistered copy" dialog on first launch. UC-110 includes a step to dismiss it by clicking the "Cancel" button.

### Text input method

Sublime Text does not expose standard AX text input elements (AXTextField, AXTextArea). The implementation uses `pasteTextToPid` to input text via clipboard, similar to QQ Music's search input.

Swift helper change:
- Added `isSublimeTextTarget` helper
- Added Sublime Text fallback in `performType` to use paste when no standard text element is found

### Verification

Step 7 uses `verifySublimeTextAction` in `src/usecases/sublime-text.ts` to read the saved file from disk and compare content byte-for-byte with the expected sentinel text.

This is stronger than relying on AX tree state, which does not reflect disk state.

## Trace artifact

Trace includes:
- All 7 steps with policy decisions
- Element bindings for Cancel button and document window
- File-system verification metadata with actual vs expected text

Run `./dist/cli/index.js trace --last` to inspect the full trace.
