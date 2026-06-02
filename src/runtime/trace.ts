import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { TraceEvent } from "../core/contracts.js"

const TRACE_DIR = ".computer-use/traces"
const LAST_TRACE_FILE = ".computer-use/traces/last"

export interface TraceWriteResult {
  traceId: string
  tracePath: string
  eventCount: number
}

export interface StoredTrace {
  traceId: string
  tracePath: string
  events: TraceEvent[]
}

export async function writeTrace(traceId: string, events: TraceEvent[]): Promise<TraceWriteResult> {
  const traceDir = resolve(process.cwd(), TRACE_DIR)
  const tracePath = resolve(traceDir, `${traceId}.jsonl`)
  const lastTracePath = resolve(process.cwd(), LAST_TRACE_FILE)
  const content = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`

  await mkdir(traceDir, { recursive: true })
  await writeFile(tracePath, content, "utf8")
  await writeFile(lastTracePath, tracePath, "utf8")

  return {
    traceId,
    tracePath,
    eventCount: events.length,
  }
}

export async function readLastTrace(): Promise<StoredTrace | undefined> {
  const lastTracePath = resolve(process.cwd(), LAST_TRACE_FILE)

  try {
    const tracePath = (await readFile(lastTracePath, "utf8")).trim()
    return await readTraceFile(tracePath)
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined
    }
    throw error
  }
}

async function readTraceFile(tracePath: string): Promise<StoredTrace | undefined> {
  try {
    const content = await readFile(tracePath, "utf8")
    const events = content
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as TraceEvent)
    const traceId = events[0]?.traceId

    if (!traceId) {
      return undefined
    }

    return {
      traceId,
      tracePath,
      events,
    }
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined
    }
    throw error
  }
}

function isMissingFile(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT"
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
