import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { Action, ActionResult, Observation } from "../core/contracts.js"
import { ActionErrorCode } from "../core/errors.js"
import type { UseCase } from "./types.js"

export const SUBLIME_TEXT_USE_CASE_ID = "UC-110"
export const SUBLIME_TEXT_APP_ID = "com.sublimetext.4"
export const SUBLIME_TEXT_SENTINEL = "computer-use-harness: uc-110"
export const SUBLIME_TEXT_SAVE_PATH = join(tmpdir(), "computer-use-harness", "uc-110.txt")

export async function prepareSublimeTextUseCase(useCase: UseCase): Promise<void> {
  if (useCase.id !== SUBLIME_TEXT_USE_CASE_ID) {
    return
  }

  await mkdir(dirname(SUBLIME_TEXT_SAVE_PATH), { recursive: true })
  await writeFile(SUBLIME_TEXT_SAVE_PATH, "", "utf8")
}

export function bindSublimeTextActionInput(useCase: UseCase, action: Action): Action {
  if (useCase.id !== SUBLIME_TEXT_USE_CASE_ID) {
    return action
  }

  const description = normalize(action.input?.description)
  const input = { ...(action.input ?? {}) }

  if (action.kind === "open") {
    input.filePath = SUBLIME_TEXT_SAVE_PATH
  }

  if (action.kind === "type") {
    input.text = SUBLIME_TEXT_SENTINEL
  }

  if (description.includes("verify saved file content")) {
    input.filePath = SUBLIME_TEXT_SAVE_PATH
    input.expectedText = SUBLIME_TEXT_SENTINEL
  }

  if (description.includes("dismiss registration dialog")) {
    input.buttonName = "Cancel"
  }

  if (description.includes("focus document window")) {
    input.windowTitle = "uc-110.txt"
  }

  return {
    ...action,
    input,
  }
}

export async function verifySublimeTextAction(
  action: Action,
  observation: Observation,
): Promise<ActionResult | undefined> {
  if (!isSublimeTextFileVerificationStep(action)) {
    return undefined
  }

  const filePath = stringInput(action, "filePath", SUBLIME_TEXT_SAVE_PATH)
  const expectedText = stringInput(action, "expectedText", SUBLIME_TEXT_SENTINEL)

  try {
    const content = await readFile(filePath, "utf8")
    if (content === expectedText) {
      return {
        actionId: action.id,
        ok: true,
        status: "passed",
        adapter: "mac-helper",
        observation,
        metadata: {
          helperMethod: "file-system-verifier",
          verifier: "sublime-text-file-content",
          filePath,
          expectedText,
        },
      }
    }

    return failedFileVerification(action, observation, {
      filePath,
      expectedText,
      actualText: content.slice(0, 200),
    })
  } catch (error) {
    return failedFileVerification(action, observation, {
      filePath,
      expectedText,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function failedFileVerification(
  action: Action,
  observation: Observation,
  details: Record<string, string>,
): ActionResult {
  return {
    actionId: action.id,
    ok: false,
    status: "failed",
    adapter: "mac-helper",
    observation,
    metadata: {
      helperMethod: "file-system-verifier",
      verifier: "sublime-text-file-content",
      verificationId: `verify_${randomUUID()}`,
    },
    error: {
      code: ActionErrorCode.ACTION_FAILED,
      message: "Sublime Text file verifier did not confirm the expected file content.",
      details,
    },
  }
}

function isSublimeTextFileVerificationStep(action: Action): boolean {
  const description = normalize(action.input?.description)
  return isSublimeTextTarget(action) && description.includes("verify saved file content")
}

function isSublimeTextTarget(action: Action): boolean {
  return normalize(action.target.id) === SUBLIME_TEXT_APP_ID
}

function stringInput(action: Action, key: string, fallback: string): string {
  const value = action.input?.[key]
  return typeof value === "string" && value.trim() !== "" ? value : fallback
}

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}
