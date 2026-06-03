import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { type Interface, createInterface } from "node:readline"
import type { ActionResult, JsonObject, Target } from "../../core/contracts.js"
import type {
  MacActionParams,
  MacAppState,
  MacHelperClient,
  MacHelperError,
  MacHelperMethod,
  MacHelperRequest,
  MacHelperResponse,
  MacKeyParams,
  MacPermissionStatus,
  MacRunningApp,
  MacScrollParams,
  MacTypeParams,
  MacWindow,
} from "./helper-protocol.js"

export interface MacHelperProcessOptions {
  command: string
  args?: string[]
  cwd?: string
}

interface PendingRequest {
  resolve(value: object): void
  reject(error: Error): void
}

export class MacHelperRpcError extends Error {
  readonly code: MacHelperError["code"]
  readonly details?: JsonObject

  constructor(error: MacHelperError) {
    super(error.message)
    this.name = "MacHelperRpcError"
    this.code = error.code
    this.details = error.details
  }
}

export class MacHelperProcessClient implements MacHelperClient {
  private readonly process: ChildProcessWithoutNullStreams
  private readonly lines: Interface
  private readonly pending = new Map<string, PendingRequest>()

  constructor(options: MacHelperProcessOptions) {
    this.process = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      stdio: "pipe",
    })
    this.lines = createInterface({ input: this.process.stdout })

    this.lines.on("line", (line) => this.handleLine(line))
    this.process.once("error", (error) => this.rejectAll(error))
    this.process.once("close", (code) => {
      this.rejectAll(new Error(`mac-helper exited with code ${code ?? "unknown"}.`))
    })
  }

  async permissionStatus() {
    return this.send<MacPermissionStatus>("permissionStatus", {})
  }

  async listApps() {
    const result = await this.send<{ apps: MacRunningApp[] }>("listApps", {})
    return result.apps
  }

  async listWindows(target: Target) {
    const result = await this.send<{ windows: MacWindow[] }>("listWindows", { target })
    return result.windows
  }

  async getAppState(target: Target) {
    return this.send<MacAppState>("getAppState", { target })
  }

  async open(params: MacActionParams) {
    return this.send<ActionResult>("open", params)
  }

  async click(params: MacActionParams) {
    return this.send<ActionResult>("click", params)
  }

  async typeText(params: MacTypeParams) {
    return this.send<ActionResult>("type", params)
  }

  async key(params: MacKeyParams) {
    return this.send<ActionResult>("key", params)
  }

  async scroll(params: MacScrollParams) {
    return this.send<ActionResult>("scroll", params)
  }

  close(): void {
    this.lines.close()
    this.process.kill()
  }

  private send<TResult extends object>(method: MacHelperMethod, params: object): Promise<TResult> {
    const id = randomUUID()
    const request: MacHelperRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    }

    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as TResult),
        reject,
      })

      this.process.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
        if (!error) {
          return
        }

        this.pending.delete(id)
        reject(error)
      })
    })
  }

  private handleLine(line: string): void {
    let response: MacHelperResponse

    try {
      response = JSON.parse(line) as MacHelperResponse
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.rejectAll(new Error(`mac-helper returned invalid JSON: ${message}`))
      return
    }

    const pending = this.pending.get(response.id)
    if (!pending) {
      return
    }

    this.pending.delete(response.id)

    if (response.error) {
      pending.reject(new MacHelperRpcError(response.error))
      return
    }

    if (!response.result) {
      pending.reject(new Error("mac-helper response must include result or error."))
      return
    }

    pending.resolve(response.result)
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error)
    }

    this.pending.clear()
  }
}

export function createMacHelperProcessClient(options: MacHelperProcessOptions): MacHelperClient {
  return new MacHelperProcessClient(options)
}
