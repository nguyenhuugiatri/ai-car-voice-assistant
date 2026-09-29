/**
 * A single door for executing commands, whether they come from a finger or
 * from the voice.
 *
 * Every button in the UI goes through here instead of calling `useCarStore`
 * actions directly. That way manual adjustments also produce a `ToolResult`,
 * also go through `describeResult`, also show up in the debug panel — i.e. the
 * finger's path and the voice's path differ only in who calls this function.
 */

import { describeResult } from '@/domain/say'
import type { ToolResult } from '@/domain/tool-result'

import { useCarStore, type CarStore } from './car-store'
import { useSessionStore, type CommandSource } from './session-store'

export type CommandContext = {
  source?: CommandSource
  input?: string
  rawToolCall?: string
  latencyMs?: number
  steps?: Array<{ label: string; ms: number }>
  retried?: boolean
}

/**
 * `command` receives **state and actions** together, not just actions: the `+`
 * button must read the temperature *at the moment of the press*, not the value
 * React just rendered. Three presses in one frame registering only once is a
 * real bug caught while testing by hand.
 */
export function runCommand(
  command: (car: CarStore) => ToolResult,
  context: CommandContext = {},
): ToolResult {
  const result = command(useCarStore.getState())
  record(result, context)
  return result
}

/**
 * Same door as `runCommand`, for commands that have to wait (`play_music`
 * waits for YouTube).
 *
 * State is still read **when it starts running**; only writing the status bar
 * and the debug panel waits for the result. `isStale` lets the caller drop the
 * result of a turn already cut off by a later command — by then the status bar
 * belongs to the new turn and must not be overwritten.
 */
export async function runCommandAsync(
  command: (car: CarStore) => ToolResult | Promise<ToolResult>,
  context: CommandContext = {},
  isStale: () => boolean = () => false,
): Promise<ToolResult | null> {
  const result = await command(useCarStore.getState())
  if (isStale()) return null
  record(result, context)
  return result
}

function record(result: ToolResult, context: CommandContext): void {
  const session = useSessionStore.getState()

  session.setStatusLine({
    phase:
      result.kind === 'rejected' || result.kind === 'musicSearchFailed'
        ? 'failed'
        : 'done',
    text: describeResult(result),
  })
  session.pushEvent({
    source: context.source ?? 'manual',
    input: context.input,
    rawToolCall: context.rawToolCall,
    latencyMs: context.latencyMs,
    steps: context.steps,
    retried: context.retried,
    result,
  })
}
