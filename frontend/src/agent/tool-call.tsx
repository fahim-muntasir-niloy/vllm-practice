// One tool step: icon, name and argument, a result line, and details on demand.
import { useState, type FC } from 'react'
import type { ToolCallMessagePartProps, ToolCallMessagePartStatus } from '@assistant-ui/react'
import { ChevronRightIcon, CornerDownRightIcon } from 'lucide-react'
import type { ToolActivity } from './stream'
import { Code, toolView, type Args } from './tool-views'

type StepProps = {
  toolName: string
  args: Args
  argsText: string
  result?: unknown
  isError?: boolean
  status: ToolCallMessagePartStatus
  activity?: ToolActivity
}

type State = 'running' | 'done' | 'error' | 'stopped'

const iconStyles: Record<State, string> = {
  running: 'border-agent/50 bg-agent/15 text-agent animate-pulse',
  done: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  error: 'border-red-500/40 bg-red-500/10 text-red-400',
  stopped: 'border-border bg-muted text-muted-foreground',
}

/** While the model is still writing the call, read the first value from the partial JSON. */
function partialArgument(argsText: string) {
  return /"[a-z_]+"\s*:\s*"((?:[^"\\]|\\.)*)/i.exec(argsText)?.[1] ?? ''
}

const ToolStep: FC<StepProps> = ({ toolName, args, argsText, result, isError, status, activity }) => {
  const view = toolView(toolName)
  const Icon = view.icon
  const output = result === undefined ? undefined : typeof result === 'string' ? result : JSON.stringify(result, null, 2)
  const failed = isError || output?.startsWith('Error')
  const state: State =
    status.type === 'running' ? 'running' : failed ? 'error' : status.type === 'incomplete' ? 'stopped' : 'done'

  // A subagent is open while it works; everything else opens on click.
  const [choice, setChoice] = useState<boolean | null>(null)
  const open = choice ?? (toolName === 'task' && state === 'running')

  const argument =
    (view.argument && typeof args[view.argument] === 'string' ? (args[view.argument] as string) : '') ||
    (view.argument || !view.pinned ? partialArgument(argsText) : '')

  const subSteps = activity?.parts.filter((p) => p.type === 'tool-call').length ?? 0
  let summary: string | undefined
  if (state === 'running') summary = activity?.progress.at(-1)?.message ?? 'Running…'
  else if (state === 'stopped') summary = 'Stopped'
  else if (output !== undefined) {
    if (failed) summary = output.slice(0, 160)
    else if (toolName === 'task') summary = `Done · ${subSteps} tool ${subSteps === 1 ? 'use' : 'uses'}`
    else summary = view.outcome?.(output, args) ?? (view.pinned ? undefined : 'Done')
  }

  return (
    <div data-slot="agent-tool-step" data-state={state} className="min-w-0 text-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setChoice(!open)}
        className="group hover:bg-muted/40 -mx-1.5 flex w-[calc(100%+0.75rem)] items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition-colors"
      >
        <span className={`flex size-6 shrink-0 items-center justify-center rounded-md border ${iconStyles[state]}`}>
          <Icon className="size-3.5" />
        </span>
        <span className="shrink-0 font-semibold">{view.label}</span>
        {argument && <span className="text-muted-foreground min-w-0 truncate font-mono text-xs">({argument})</span>}
        <ChevronRightIcon
          className={`text-muted-foreground ms-auto size-4 shrink-0 transition-transform group-hover:opacity-100 ${open ? 'rotate-90' : 'opacity-0'}`}
        />
      </button>

      <div className="border-border ms-3 flex flex-col gap-2 border-s ps-5">
        {summary && (
          <p
            className={`flex items-start gap-1.5 pt-0.5 text-xs ${failed ? 'text-red-400' : 'text-muted-foreground'}`}
          >
            <CornerDownRightIcon className="mt-0.5 size-3 shrink-0" />
            <span className={`min-w-0 break-words ${state === 'running' ? 'shimmer' : ''}`}>{summary}</span>
          </p>
        )}
        {view.pinned?.(args, output)}

        {open && (
          <div className="flex flex-col gap-2 pb-1">
            {activity && activity.parts.length > 0 && <Subagent activity={activity} running={state === 'running'} />}
            {view.details ? (
              view.details(args, output)
            ) : view.pinned ? null : (
              <>
                {argsText && <Code>{argsText}</Code>}
                {output !== undefined && <Code>{output}</Code>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** The subagent's own replies and tool steps, nested under its `task` call. */
const Subagent: FC<{ activity: ToolActivity; running: boolean }> = ({ activity, running }) => (
  <div className="bg-muted/20 flex flex-col gap-2 rounded-lg border p-3">
    {activity.parts.map((part, i) => {
      if (part.type === 'text') {
        return (
          <p key={i} className="whitespace-pre-wrap">
            {part.text}
          </p>
        )
      }
      if (part.type !== 'tool-call') return null
      const waiting = part.result === undefined
      return (
        <ToolStep
          key={part.toolCallId}
          toolName={part.toolName}
          args={part.args as Args}
          argsText={part.argsText ?? ''}
          result={part.result}
          isError={part.isError}
          status={
            !waiting
              ? { type: 'complete' }
              : running
                ? { type: 'running' }
                : { type: 'incomplete', reason: 'cancelled' }
          }
          activity={part.artifact as ToolActivity | undefined}
        />
      )
    })}
  </div>
)

export const ToolCall: FC<ToolCallMessagePartProps> = ({ artifact, ...props }) => (
  <div className="py-1">
    <ToolStep {...props} args={props.args as Args} activity={artifact as ToolActivity | undefined} />
  </div>
)
