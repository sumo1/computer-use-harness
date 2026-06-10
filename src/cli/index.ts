#!/usr/bin/env node

import { randomUUID } from "node:crypto"
import { runNativeAction } from "../actions/native-action-runner.js"
import type { Action, ActionKind, JsonObject, Target } from "../core/contracts.js"
import { CommandErrorCode, ExitCode } from "../core/errors.js"
import { fail, ok } from "../core/result.js"
import { findAppCapability, listAppCapabilities } from "../runtime/app-registry.js"
import { readLastTrace, writeTrace } from "../runtime/trace.js"
import { runFakeUseCase } from "../usecases/fake-runner.js"
import { loadUseCases, toDryRunItem, toListItem } from "../usecases/load.js"
import { runNativeUseCase } from "../usecases/native-runner.js"
import { writeResult, writeUnexpectedError } from "./output.js"

interface ParsedArgs {
  command: string[]
  flags: Map<string, string | true>
}

const VALUE_FLAGS = new Set([
  "amount",
  "app",
  "description",
  "direction",
  "fields",
  "id",
  "key",
  "keyword",
  "mac-helper",
  "name",
  "observation-mode",
  "platform",
  "poll-interval-ms",
  "query",
  "retries",
  "settle-poll-interval-ms",
  "settle-stable-observations",
  "settle-timeout-ms",
  "target-id",
  "target-name",
  "target-state-kind",
  "target-state-keyword",
  "text",
  "timeout-ms",
  "to-x",
  "to-y",
  "x",
  "y",
  "delta-x",
  "delta-y",
  "disable-visual-fallback",
  "settle-after-action",
  "wait-for-state-change",
])

const ACTION_KIND_ALIASES = new Map<string, ActionKind>([
  ["observe", "observe"],
  ["open", "open"],
  ["click", "click"],
  ["secondary-click", "secondary-click"],
  ["right-click", "secondary-click"],
  ["hover", "hover"],
  ["drag", "drag"],
  ["type", "type"],
  ["key", "key"],
  ["scroll", "scroll"],
  ["policy-check", "policy-check"],
  ["extract", "extract"],
])

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv)
  const pretty = args.flags.has("pretty")

  try {
    if (args.command.length === 0 || args.flags.has("help")) {
      writeResult(ok("help", { usage: usageText() }), pretty)
      return ExitCode.OK
    }

    if (args.command[0] === "version") {
      writeResult(ok("version", { version: "0.1.0" }), pretty)
      return ExitCode.OK
    }

    if (args.command[0] === "action" || isTopLevelActionCommand(args.command[0])) {
      return await handleActionCommand(args, pretty)
    }

    if (args.command[0] === "usecases") {
      return await handleUseCases(args, pretty)
    }

    if (args.command[0] === "trace") {
      return await handleTrace(args, pretty)
    }

    if (args.command[0] === "apps") {
      writeResult(ok("apps.list", { apps: listAppCapabilities() }), pretty)
      return ExitCode.OK
    }

    if (args.command[0] === "capabilities") {
      return handleCapabilities(args, pretty)
    }

    writeResult(
      fail(
        "unknown",
        CommandErrorCode.UNKNOWN_COMMAND,
        `Unknown command '${args.command.join(" ")}'`,
        {
          usage: usageText(),
        },
      ),
      pretty,
    )
    return ExitCode.USAGE_OR_BUSINESS_ERROR
  } catch (error) {
    writeUnexpectedError(args.command.join(".") || "unknown", error, pretty)
    return ExitCode.UNEXPECTED_ERROR
  }
}

async function handleActionCommand(args: ParsedArgs, pretty: boolean): Promise<number> {
  const normalizedArgs =
    args.command[0] === "action" ? args : { ...args, command: ["action", ...args.command] }
  const actionKind = normalizeActionKind(normalizedArgs.command[1])

  if (!actionKind) {
    const providedKind = normalizedArgs.command[1]
    writeResult(
      fail(
        "action.run",
        providedKind ? CommandErrorCode.INVALID_ACTION_KIND : CommandErrorCode.MISSING_ACTION_KIND,
        providedKind ? `Unknown action kind '${providedKind}'.` : "Action kind is required.",
        {
          usage:
            "computer-use action <kind> --app <name-or-bundle-id> (--fake | --mac-helper <path>) [--pretty]",
          supportedKinds: [...ACTION_KIND_ALIASES.keys()],
        },
      ),
      pretty,
    )
    return ExitCode.USAGE_OR_BUSINESS_ERROR
  }

  const helperCommand = readFlagValue(normalizedArgs, "mac-helper")
  if (normalizedArgs.flags.has("fake") && helperCommand) {
    writeResult(
      fail(
        "action.run",
        CommandErrorCode.INVALID_RUN_MODE,
        "Use either --fake or --mac-helper, not both.",
      ),
      pretty,
    )
    return ExitCode.USAGE_OR_BUSINESS_ERROR
  }
  if (!normalizedArgs.flags.has("fake") && !helperCommand) {
    writeResult(
      fail(
        "action.run",
        CommandErrorCode.REAL_RUNNER_NOT_IMPLEMENTED,
        "Use --fake or --mac-helper <path>.",
      ),
      pretty,
    )
    return ExitCode.USAGE_OR_BUSINESS_ERROR
  }

  const target = createCliTarget(normalizedArgs)
  if (!target) {
    writeResult(
      fail(
        "action.run",
        CommandErrorCode.MISSING_APP_NAME,
        "App target requires --app, --id, or --name.",
        {
          usage:
            "computer-use action <kind> --app <name-or-bundle-id> (--fake | --mac-helper <path>)",
        },
      ),
      pretty,
    )
    return ExitCode.USAGE_OR_BUSINESS_ERROR
  }

  const actionInput = createCliActionInput(normalizedArgs, actionKind)
  if (!actionInput.ok) {
    writeResult(
      fail("action.run", CommandErrorCode.INVALID_ACTION_INPUT, actionInput.message),
      pretty,
    )
    return ExitCode.USAGE_OR_BUSINESS_ERROR
  }

  const action: Action = {
    id: `cli:${actionKind}:${randomUUID()}`,
    kind: actionKind,
    target,
    adapter: "mac-helper",
    input: actionInput.input,
  }
  const runResult = await runNativeAction({
    target,
    action,
    helperCommand,
    fake: normalizedArgs.flags.has("fake"),
  })
  const traceWrite = await writeTrace(runResult.traceId, runResult.trace)

  writeResult(ok("action.run", { ...runResult, tracePath: traceWrite.tracePath }), pretty)
  return ExitCode.OK
}

function handleCapabilities(args: ParsedArgs, pretty: boolean): number {
  const appName = readFlagValue(args, "app")

  if (!appName) {
    writeResult(
      fail("capabilities.get", CommandErrorCode.MISSING_APP_NAME, "App name is required.", {
        usage: "computer-use capabilities --app <name> [--pretty]",
      }),
      pretty,
    )
    return ExitCode.USAGE_OR_BUSINESS_ERROR
  }

  const capability = findAppCapability(appName)
  if (!capability) {
    writeResult(
      fail(
        "capabilities.get",
        CommandErrorCode.APP_CAPABILITY_NOT_FOUND,
        `No capability registered for app '${appName}'.`,
      ),
      pretty,
    )
    return ExitCode.USAGE_OR_BUSINESS_ERROR
  }

  writeResult(ok("capabilities.get", { capability }), pretty)
  return ExitCode.OK
}

function isTopLevelActionCommand(command: string | undefined): boolean {
  return normalizeActionKind(command) !== undefined
}

function normalizeActionKind(command: string | undefined): ActionKind | undefined {
  if (!command) {
    return undefined
  }

  return ACTION_KIND_ALIASES.get(command.toLowerCase())
}

function createCliTarget(args: ParsedArgs): Target | undefined {
  const app = readFlagValue(args, "app")
  const id = readFlagValue(args, "id") ?? readFlagValue(args, "target-id") ?? app
  const name = readFlagValue(args, "name") ?? readFlagValue(args, "target-name") ?? app

  if (!id && !name) {
    return undefined
  }

  return {
    kind: "app",
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    platform: readPlatform(args),
  }
}

function createCliActionInput(
  args: ParsedArgs,
  kind: ActionKind,
): { ok: true; input: JsonObject } | { ok: false; message: string } {
  const positional = args.command.slice(2)
  const x = readNumberFlag(args, "x") ?? readPositionalNumber(positional, 0)
  const y = readNumberFlag(args, "y") ?? readPositionalNumber(positional, 1)
  const explicitDescription = readFlagValue(args, "description")
  const text = readFlagValue(args, "text") ?? (kind === "type" ? positional[0] : undefined)
  const key =
    readFlagValue(args, "key") ?? (kind === "key" ? (positional[0] ?? "Enter") : undefined)
  const direction =
    readFlagValue(args, "direction") ?? (kind === "scroll" ? (positional[0] ?? "down") : undefined)
  const amount =
    readNumberFlag(args, "amount") ??
    readScrollPositionalAmount(kind, positional) ??
    (kind === "scroll" ? 1 : undefined)
  const keyword = readFlagValue(args, "keyword") ?? keywordFromDescription(explicitDescription)
  const query =
    readFlagValue(args, "query") ??
    (kind === "extract"
      ? positional.join(" ").trim() || queryFromDescription(explicitDescription)
      : undefined)
  const description =
    explicitDescription ??
    defaultActionDescription(kind, { x, y, text, key, direction, amount, keyword, query })
  const input: JsonObject = {
    description,
  }

  setStringInput(input, "text", text)
  setStringInput(input, "key", key)
  setStringInput(input, "direction", normalizeDirection(direction))
  setStringInput(input, "keyword", keyword)
  setStringInput(input, "query", query)
  setStringInput(input, "observationMode", readFlagValue(args, "observation-mode"))
  setNumberInput(input, "x", x)
  setNumberInput(input, "y", y)
  setNumberInput(input, "toX", readNumberFlag(args, "to-x"))
  setNumberInput(input, "toY", readNumberFlag(args, "to-y"))
  setNumberInput(input, "deltaX", readNumberFlag(args, "delta-x"))
  setNumberInput(input, "deltaY", readNumberFlag(args, "delta-y"))
  setNumberInput(input, "amount", amount)
  setNumberInput(input, "timeoutMs", readNumberFlag(args, "timeout-ms"))
  setNumberInput(input, "pollIntervalMs", readNumberFlag(args, "poll-interval-ms"))
  setNumberInput(input, "retries", readNumberFlag(args, "retries"))
  setNumberInput(input, "settleTimeoutMs", readNumberFlag(args, "settle-timeout-ms"))
  setNumberInput(input, "settlePollIntervalMs", readNumberFlag(args, "settle-poll-interval-ms"))
  setNumberInput(
    input,
    "settleStableObservations",
    readNumberFlag(args, "settle-stable-observations"),
  )
  setBooleanInput(input, "waitForStateChange", readBooleanFlag(args, "wait-for-state-change"))
  setBooleanInput(input, "settleAfterAction", readBooleanFlag(args, "settle-after-action"))
  setBooleanInput(input, "disableVisualFallback", readBooleanFlag(args, "disable-visual-fallback"))

  const targetStateKind = readFlagValue(args, "target-state-kind")
  if (targetStateKind) {
    input.targetState = {
      kind: targetStateKind,
      keyword: readFlagValue(args, "target-state-keyword") ?? "",
    }
  }

  const extractionFields = readListFlag(args, "fields")
  if (extractionFields.length > 0) {
    input.extractionFields = extractionFields
  }

  if (!validActionInput(kind, input)) {
    return {
      ok: false,
      message: `Invalid input for action '${kind}'.`,
    }
  }

  return { ok: true, input }
}

function validActionInput(kind: ActionKind, input: JsonObject): boolean {
  if (kind === "click" || kind === "secondary-click" || kind === "hover") {
    const hasCoordinates = typeof input.x === "number" && typeof input.y === "number"
    const hasSemanticTarget = typeof input.keyword === "string" && input.keyword.trim() !== ""
    return hasCoordinates || hasSemanticTarget
  }

  if (kind === "drag") {
    const hasStart = typeof input.x === "number" && typeof input.y === "number"
    const hasEnd =
      (typeof input.toX === "number" && typeof input.toY === "number") ||
      (typeof input.deltaX === "number" && typeof input.deltaY === "number")
    return hasStart && hasEnd
  }

  if (kind === "type") {
    return typeof input.text === "string"
  }

  if (kind === "key") {
    return typeof input.key === "string"
  }

  if (kind === "scroll") {
    return typeof input.direction === "string"
  }

  if (kind === "extract") {
    return typeof input.query === "string"
  }

  return true
}

function defaultActionDescription(
  kind: ActionKind,
  input: {
    x?: number
    y?: number
    text?: string
    key?: string
    direction?: string
    amount?: number
    keyword?: string
    query?: string
  },
): string {
  if ((kind === "click" || kind === "secondary-click" || kind === "hover") && input.keyword) {
    return `${kind === "hover" ? "hover" : "click"} item named ${input.keyword}`
  }

  if (
    (kind === "click" || kind === "secondary-click" || kind === "hover") &&
    input.x !== undefined &&
    input.y !== undefined
  ) {
    return `${kind} at ${input.x}, ${input.y}`
  }

  if (kind === "drag") {
    return "drag target"
  }

  if (kind === "type") {
    return input.keyword ? `type text into item named ${input.keyword}` : "type text"
  }

  if (kind === "key") {
    return `press key ${input.key ?? "Enter"}`
  }

  if (kind === "scroll") {
    return `scroll ${normalizeDirection(input.direction) ?? "down"} ${input.amount ?? 1}`
  }

  if (kind === "observe") {
    return "read app state"
  }

  if (kind === "open") {
    return "open app"
  }

  if (kind === "policy-check") {
    return "check permissions"
  }

  return `extract ${input.query ?? "visible information"}`
}

async function handleUseCases(args: ParsedArgs, pretty: boolean): Promise<number> {
  const subcommand = args.command[1]

  if (subcommand === "list") {
    const cases = await loadUseCases()
    writeResult(ok("usecases.list", { cases: cases.map(toListItem) }), pretty)
    return ExitCode.OK
  }

  if (subcommand === "dry-run") {
    const id = args.command[2]
    const cases = await loadUseCases()
    const selectedCases = id ? cases.filter((entry) => entry.id === id) : cases

    if (id && selectedCases.length === 0) {
      writeResult(
        fail("usecases.dry-run", CommandErrorCode.UNKNOWN_USE_CASE, `Unknown use case '${id}'.`),
        pretty,
      )
      return ExitCode.USAGE_OR_BUSINESS_ERROR
    }

    writeResult(ok("usecases.dry-run", { cases: selectedCases.map(toDryRunItem) }), pretty)
    return ExitCode.OK
  }

  if (subcommand === "run") {
    const id = args.command[2]
    const helperCommand = readFlagValue(args, "mac-helper")
    if (!id) {
      writeResult(
        fail("usecases.run", CommandErrorCode.MISSING_CASE_ID, "Use case id is required."),
        pretty,
      )
      return ExitCode.USAGE_OR_BUSINESS_ERROR
    }
    if (args.flags.has("fake") && helperCommand) {
      writeResult(
        fail(
          "usecases.run",
          CommandErrorCode.INVALID_RUN_MODE,
          "Use either --fake or --mac-helper, not both.",
        ),
        pretty,
      )
      return ExitCode.USAGE_OR_BUSINESS_ERROR
    }
    if (!args.flags.has("fake") && !helperCommand) {
      writeResult(
        fail(
          "usecases.run",
          CommandErrorCode.REAL_RUNNER_NOT_IMPLEMENTED,
          "Use --fake or --mac-helper <path>.",
        ),
        pretty,
      )
      return ExitCode.USAGE_OR_BUSINESS_ERROR
    }

    const cases = await loadUseCases()
    const useCase = cases.find((entry) => entry.id === id)
    if (!useCase) {
      writeResult(
        fail("usecases.run", CommandErrorCode.UNKNOWN_USE_CASE, `Unknown use case '${id}'.`),
        pretty,
      )
      return ExitCode.USAGE_OR_BUSINESS_ERROR
    }

    const runResult = helperCommand
      ? await runNativeUseCase(useCase, { helperCommand })
      : await runFakeUseCase(useCase)
    const traceWrite = await writeTrace(runResult.traceId, runResult.trace)

    writeResult(ok("usecases.run", { ...runResult, tracePath: traceWrite.tracePath }), pretty)
    return ExitCode.OK
  }

  writeResult(
    fail(
      "usecases",
      CommandErrorCode.UNKNOWN_USECASES_COMMAND,
      `Unknown usecases command '${subcommand ?? ""}'.`,
      {
        usage:
          "computer-use usecases list | computer-use usecases dry-run [id] | computer-use usecases run <id> (--fake | --mac-helper <path>)",
      },
    ),
    pretty,
  )
  return ExitCode.USAGE_OR_BUSINESS_ERROR
}

async function handleTrace(args: ParsedArgs, pretty: boolean): Promise<number> {
  if (args.flags.has("last")) {
    const trace = await readLastTrace()

    if (!trace) {
      writeResult(
        fail("trace.last", CommandErrorCode.TRACE_NOT_FOUND, "No trace has been recorded yet."),
        pretty,
      )
      return ExitCode.USAGE_OR_BUSINESS_ERROR
    }

    writeResult(ok("trace.last", trace), pretty)
    return ExitCode.OK
  }

  writeResult(
    fail("trace", CommandErrorCode.UNKNOWN_COMMAND, "Unknown trace command.", {
      usage: "computer-use trace --last [--pretty]",
    }),
    pretty,
  )
  return ExitCode.USAGE_OR_BUSINESS_ERROR
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string | true>()
  const command: string[] = []

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]

    if (arg.startsWith("--")) {
      const flag = arg.slice(2)
      const [name, inlineValue] = splitFlag(flag)

      if (inlineValue !== undefined) {
        flags.set(name, inlineValue)
        continue
      }

      const nextArg = argv[index + 1]
      if (VALUE_FLAGS.has(name) && nextArg !== undefined && !nextArg.startsWith("--")) {
        flags.set(name, nextArg)
        index++
        continue
      }

      flags.set(name, true)
    } else {
      command.push(arg)
    }
  }

  return { command, flags }
}

function splitFlag(flag: string): [string, string | undefined] {
  const separatorIndex = flag.indexOf("=")

  if (separatorIndex === -1) {
    return [flag, undefined]
  }

  return [flag.slice(0, separatorIndex), flag.slice(separatorIndex + 1)]
}

function readFlagValue(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name)
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function readPlatform(args: ParsedArgs): Target["platform"] {
  return readFlagValue(args, "platform") === "macos" ? "macos" : "any"
}

function readNumberFlag(args: ParsedArgs, name: string): number | undefined {
  const value = readFlagValue(args, name)
  if (value === undefined) {
    return undefined
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function readPositionalNumber(values: string[], index: number): number | undefined {
  const value = values[index]
  if (value === undefined) {
    return undefined
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function readScrollPositionalAmount(kind: ActionKind, positional: string[]): number | undefined {
  if (kind !== "scroll") {
    return undefined
  }

  return readPositionalNumber(positional, 1)
}

function readBooleanFlag(args: ParsedArgs, name: string): boolean | undefined {
  const value = args.flags.get(name)
  if (value === undefined) {
    return undefined
  }

  if (value === true) {
    return true
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false
  }

  return undefined
}

function readListFlag(args: ParsedArgs, name: string): string[] {
  const value = readFlagValue(args, name)
  if (!value) {
    return []
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function setStringInput(input: JsonObject, key: string, value: string | undefined): void {
  if (value !== undefined && value.trim() !== "") {
    input[key] = value
  }
}

function setNumberInput(input: JsonObject, key: string, value: number | undefined): void {
  if (value !== undefined && Number.isFinite(value)) {
    input[key] = value
  }
}

function setBooleanInput(input: JsonObject, key: string, value: boolean | undefined): void {
  if (value !== undefined) {
    input[key] = value
  }
}

function normalizeDirection(
  value: string | undefined,
): "up" | "down" | "left" | "right" | undefined {
  if (value === "up" || value === "down" || value === "left" || value === "right") {
    return value
  }

  return undefined
}

function keywordFromDescription(description: string | undefined): string | undefined {
  const match = description?.match(
    /\b(?:click|hover)\s+(?:tab|button|link|item|result|row|cell)\s+named\s+(.+)$/i,
  )
  return match?.[1]?.trim()
}

function queryFromDescription(description: string | undefined): string | undefined {
  const match = description?.match(/\bextract\s+(.+)$/i)
  return match?.[1]?.trim()
}

function usageText(): string {
  return [
    "computer-use version",
    "computer-use apps [--pretty]",
    "computer-use capabilities --app <name> [--pretty]",
    "computer-use action <kind> --app <name-or-bundle-id> (--fake | --mac-helper <path>) [--pretty]",
    "computer-use <observe|open|click|type|key|scroll|drag|hover|extract|policy-check> --app <name-or-bundle-id> (--fake | --mac-helper <path>) [--pretty]",
    "computer-use usecases list [--pretty]",
    "computer-use usecases dry-run [id] [--pretty]",
    "computer-use usecases run <id> (--fake | --mac-helper <path>) [--pretty]",
    "computer-use trace --last [--pretty]",
  ].join("\n")
}

const exitCode = await main(process.argv.slice(2))
process.exitCode = exitCode
