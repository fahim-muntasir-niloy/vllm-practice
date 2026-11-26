// Reads the agent's event stream (see agent/streaming.py) and builds assistant-ui message parts.
import type { ThreadAssistantMessagePart, ToolCallMessagePart } from '@assistant-ui/react'
import type { ContextUsage } from './context-panel'

export type Progress = { message?: string; sources?: { title: string; url: string }[] }

/** UI-only data kept on a tool call: its progress updates and, for `task`, the subagent's output. */
export type ToolActivity = { progress: Progress[]; parts: ThreadAssistantMessagePart[] }

export type AgentEvent = { path: string[] } & (
  | { type: 'text'; message_id: string; delta: string }
  | {
      type: 'tool_call'
      message_id: string
      id: string
      name: string
      args?: Record<string, unknown>
      args_delta?: string
    }
  | { type: 'progress'; id: string; data: Progress }
  | { type: 'tool_result'; id: string; result: string; is_error: boolean }
  | { type: 'usage'; input_tokens: number; output_tokens: number }
  | ({ type: 'context' } & ContextUsage)
  | { type: 'error'; message: string }
)

export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent[]> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    // Hand over everything from one network read together, so the UI renders once for it.
    const events = lines.filter(Boolean).map((line) => JSON.parse(line) as AgentEvent)
    if (events.length) yield events
  }
}

// Text and tool parts remember which model reply they belong to.
type ToolPart = ToolCallMessagePart & { artifact?: ToolActivity; messageId?: string }
type TextPart = { type: 'text'; text: string; messageId: string }

const emptyActivity = (): ToolActivity => ({ progress: [], parts: [] })

function newToolPart(id: string, name: string): ToolPart {
  return { type: 'tool-call', toolCallId: id, toolName: name, args: {}, argsText: '', artifact: emptyActivity() }
}

// Parts are replaced, never mutated, so React sees every change.
function updateTool(
  parts: ThreadAssistantMessagePart[],
  id: string,
  change: (part: ToolPart) => ToolPart,
  name = 'tool',
): ThreadAssistantMessagePart[] {
  const index = parts.findIndex((p) => p.type === 'tool-call' && p.toolCallId === id)
  if (index === -1) return [...parts, change(newToolPart(id, name))]
  return parts.with(index, change(parts[index] as ToolPart))
}

function applyToParts(parts: ThreadAssistantMessagePart[], event: AgentEvent): ThreadAssistantMessagePart[] {
  switch (event.type) {
    case 'text': {
      // Some models write their narration after the tool call. It still belongs above that
      // step, so insert it before the first tool call of the same reply.
      const firstTool = parts.findIndex((p) => p.type === 'tool-call' && (p as ToolPart).messageId === event.message_id)
      const end = firstTool === -1 ? parts.length : firstTool
      const previous = parts[end - 1] as TextPart | undefined
      if (previous?.type === 'text' && previous.messageId === event.message_id) {
        return parts.with(end - 1, { ...previous, text: previous.text + event.delta })
      }
      const part: TextPart = { type: 'text', text: event.delta, messageId: event.message_id }
      return parts.toSpliced(end, 0, part)
    }
    case 'tool_call':
      return updateTool(
        parts,
        event.id,
        (part) => ({
          ...part,
          messageId: event.message_id,
          toolName: event.name || part.toolName,
          // Complete arguments replace the streamed pieces.
          ...(event.args
            ? { args: event.args as ToolPart['args'], argsText: JSON.stringify(event.args, null, 2) }
            : { argsText: part.argsText + (event.args_delta ?? '') }),
        }),
        event.name,
      )
    case 'progress':
      return updateTool(parts, event.id, (part) => {
        const activity = part.artifact ?? emptyActivity()
        return { ...part, artifact: { ...activity, progress: [...activity.progress, event.data] } }
      })
    case 'tool_result':
      return updateTool(parts, event.id, (part) => ({ ...part, result: event.result, isError: event.is_error }))
    default:
      return parts
  }
}

/** Apply an event to the main agent's parts, or to the subagent named by `path`. */
export function applyEvent(
  parts: ThreadAssistantMessagePart[],
  event: AgentEvent,
  path: string[] = event.path,
): ThreadAssistantMessagePart[] {
  const [taskId, ...rest] = path
  if (taskId === undefined) return applyToParts(parts, event)
  return updateTool(
    parts,
    taskId,
    (part) => {
      const activity = part.artifact ?? emptyActivity()
      return { ...part, artifact: { ...activity, parts: applyEvent(activity.parts, event, rest) } }
    },
    'task',
  )
}
