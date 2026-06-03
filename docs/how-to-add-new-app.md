# How to Add a New App

This guide explains how to add support for a new app in computer-use-harness using the App adapter pattern.

## Overview

Each app has its own adapter module that implements the `AppAdapter` interface. The adapter provides:
- Use case preparation (create temp files, set up state)
- Action input binding (inject file paths, button names, etc.)
- Element binding (find app-specific UI elements)
- Action verification (check file system, external state)

## Step-by-step guide

### 1. Create adapter directory

```bash
mkdir -p src/adapters/apps/your-app
```

### 2. Implement adapter

Create `src/adapters/apps/your-app/adapter.ts`:

```typescript
import type { Action, ActionResult, Observation } from "../../../core/contracts.js"
import type { UseCase } from "../../../usecases/types.js"
import type { AppAdapter } from "../app-adapter.js"

export const yourAppAdapter: AppAdapter = {
  appId: "com.example.yourapp",
  appName: "Your App",

  // Optional: Prepare use case (e.g., create temp files)
  async prepareUseCase(useCase: UseCase): Promise<void> {
    // Your setup logic here
  },

  // Optional: Bind action inputs
  bindActionInput(useCase: UseCase, action: Action): Action {
    // Inject context-specific inputs
    return action
  },

  // Optional: Bind UI elements
  bindElement(action: Action, observation: Observation): Action {
    // Find app-specific elements
    return action
  },

  // Optional: Verify action results
  async verifyAction(action: Action, observation: Observation): Promise<ActionResult | undefined> {
    // Check external state (file system, APIs, etc.)
    return undefined
  },
}
```

### 3. Register adapter

Add your adapter to `src/adapters/apps/index.ts`:

```typescript
import { yourAppAdapter } from "./your-app/adapter.js"

registerAppAdapter(yourAppAdapter)
```

### 4. Add use case

Add your use case to `usecases/cases.yaml`:

```yaml
- id: UC-XXX
  title: Your use case title
  target:
    kind: app
    id: com.example.yourapp
    name: Your App
    platform: macos
  requires:
    platform: macos
    permissions:
      - accessibility
  steps:
    - step 1 description
    - step 2 description
  success:
    - success criterion 1
    - success criterion 2
```

### 5. Test

```bash
npm run build
./dist/cli/index.js usecases run UC-XXX \
  --mac-helper ./native/mac-helper/.build/debug/computer-use-mac-helper
```

## Examples

### Sublime Text adapter

- **Preparation**: Creates temp file before opening
- **Input binding**: Injects file path, sentinel text, button names
- **Element binding**: Finds Cancel button, document window
- **Verification**: Reads file from disk and compares content

See: `src/adapters/apps/sublime-text/adapter.ts`

### QQ Music adapter

- **Element binding**: Finds search input, playable results, calculates fixed coordinates for "Play All" button
- **Verification**: Checks AX tree for song name and playback state

See: `src/adapters/apps/qq-music/adapter.ts`

## Common patterns

### Finding UI elements

```typescript
bindElement(action: Action, observation: Observation): Action {
  if (action.kind !== "click") {
    return action
  }

  const description = action.input?.description?.toLowerCase() ?? ""
  
  if (description.includes("your button")) {
    const button = observation.elements.find(el => 
      el.role === "AXButton" && el.name === "Button Name"
    )
    
    if (button) {
      return { ...action, element: button }
    }
  }

  return action
}
```

### File system verification

```typescript
async verifyAction(action: Action, observation: Observation): Promise<ActionResult | undefined> {
  const description = action.input?.description?.toLowerCase() ?? ""
  
  if (!description.includes("verify file")) {
    return undefined
  }

  const filePath = action.input?.filePath as string
  const expectedContent = action.input?.expectedContent as string

  try {
    const actualContent = await readFile(filePath, "utf8")
    
    if (actualContent === expectedContent) {
      return {
        actionId: action.id,
        ok: true,
        status: "passed",
        adapter: "mac-helper",
        observation,
        metadata: {
          verifier: "your-app-file-content",
          filePath,
        },
      }
    }

    return failedResult(action, observation, { filePath, expectedContent, actualContent })
  } catch (error) {
    return failedResult(action, observation, { filePath, error: String(error) })
  }
}
```

### Coordinate-based clicks (last resort)

Only use when AX tree doesn't expose the element:

```typescript
bindElement(action: Action, observation: Observation): Action {
  if (action.kind !== "click") {
    return action
  }

  // Find container element
  const container = observation.elements.find(el => el.name === "Container")
  const frame = container?.metadata?.frame
  
  if (frame && typeof frame.x === "number" && typeof frame.y === "number") {
    return {
      ...action,
      input: {
        ...action.input,
        x: frame.x + 50,  // Relative to container, not screen
        y: frame.y + 100,
      },
    }
  }

  return action
}
```

## Best practices

1. **Keep adapters focused**: One app per adapter
2. **Use descriptive element bindings**: Add `elementBinding` metadata for debugging
3. **Verify externally when possible**: File system, screenshots, APIs > AX tree state
4. **Handle missing elements gracefully**: Return original action if element not found
5. **Document app-specific quirks**: Add comments for unusual behavior
6. **Test both success and failure paths**: Ensure verifiers correctly detect failures

## Troubleshooting

### Element not found

1. Run with `--pretty` to see AX tree
2. Check element roles and names in observation
3. Use `findWindowByTitle` or other helper functions
4. Consider coordinate-based click as last resort

### Verification fails

1. Check file paths are absolute
2. Ensure timing: verify after save completes
3. Add delays if needed (but prefer Swift helper waiting)
4. Log actual vs expected values in failure details

### Type errors

1. All `AppAdapter` methods are optional
2. Use type guards for action inputs
3. Return `undefined` from verifiers to skip verification
