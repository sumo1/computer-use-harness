#!/usr/bin/env node

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

const VALUE_FLAGS = new Set(["app", "mac-helper"])

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

function usageText(): string {
  return [
    "computer-use version",
    "computer-use apps [--pretty]",
    "computer-use capabilities --app <name> [--pretty]",
    "computer-use usecases list [--pretty]",
    "computer-use usecases dry-run [id] [--pretty]",
    "computer-use usecases run <id> (--fake | --mac-helper <path>) [--pretty]",
    "computer-use trace --last [--pretty]",
  ].join("\n")
}

const exitCode = await main(process.argv.slice(2))
process.exitCode = exitCode
