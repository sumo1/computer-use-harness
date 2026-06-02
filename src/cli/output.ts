import { CommandErrorCode } from "../core/errors.js"
import type { CommandResult } from "../core/result.js"

export function writeResult(result: CommandResult, pretty: boolean): void {
  const json = JSON.stringify(result, null, pretty ? 2 : 0)
  process.stdout.write(`${json}\n`)
}

export function writeUnexpectedError(command: string, error: unknown, pretty: boolean): void {
  const message = error instanceof Error ? error.message : String(error)
  const result: CommandResult = {
    ok: false,
    command,
    error: {
      code: CommandErrorCode.UNEXPECTED_ERROR,
      message,
    },
  }
  writeResult(result, pretty)
}
