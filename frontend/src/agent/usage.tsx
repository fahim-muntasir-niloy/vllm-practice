// The line under each reply: what the run cost, and how big the context is afterwards.
import type { FC } from 'react'
import { useAssistantDataUI } from '@assistant-ui/react'

export type RunUsage = {
  calls: number
  /** Summed over every model call, so the conversation is counted once per call. */
  input_tokens: number
  output_tokens: number
  /** Size of the main agent's latest request plus its reply. */
  context: number
  /** Only known for runs watched live. */
  seconds?: number
}

export const emptyUsage = (): RunUsage => ({ calls: 0, input_tokens: 0, output_tokens: 0, context: 0 })

export function addUsage(total: RunUsage, call: { path: string[]; input_tokens: number; output_tokens: number }) {
  total.calls += 1
  total.input_tokens += call.input_tokens
  total.output_tokens += call.output_tokens
  // Subagents have their own context.
  if (call.path.length === 0) total.context = call.input_tokens + call.output_tokens
}

export const usagePart = (usage: RunUsage) => ({ type: 'data' as const, name: 'usage', data: { ...usage } })

const number = (n: number) => n.toLocaleString()

export const UsageLine: FC = () => {
  useAssistantDataUI({
    name: 'usage',
    render: (part) => {
      const usage = part.data as RunUsage
      return (
        <p
          className="text-muted-foreground mt-2 text-xs"
          title="Every model call reads the conversation again, so tokens read add up across calls. Context is the size after the last call."
        >
          Context {number(usage.context)} · {usage.calls} model {usage.calls === 1 ? 'call' : 'calls'} (
          {number(usage.input_tokens)} read, {number(usage.output_tokens)} written)
          {usage.seconds !== undefined && ` · ${usage.seconds.toFixed(1)} s`}
        </p>
      )
    },
  })
  return null
}
