// Right-hand panel: what fills the model's context window after its latest reply.
import { useState, type FC } from 'react'
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import { create } from 'zustand'

export type ContextUsage = {
  used: number
  max: number
  categories: Record<string, number>
  buffer: number
  free: number
  tools: { name: string; tokens: number; custom: boolean }[]
}

/** Filled by the chat adapter from the stream's `context` events. */
export const useContextUsage = create<{ usage: ContextUsage | null }>(() => ({ usage: null }))

const categories = [
  { id: 'messages', label: 'Messages', color: 'bg-blue-500' },
  { id: 'tool_results', label: 'Tool results', color: 'bg-violet-400' },
  { id: 'builtin_tools', label: 'Built-in tools', color: 'bg-orange-500' },
  { id: 'custom_tools', label: 'Custom tools', color: 'bg-teal-500' },
  { id: 'system_prompt', label: 'System prompt', color: 'bg-zinc-400' },
  { id: 'agent_instructions', label: 'Agent instructions', color: 'bg-zinc-500' },
]

const short = (n: number) =>
  n < 1000 ? String(n) : `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`

const Row: FC<{ color: string; label: string; tokens: number; max: number }> = ({ color, label, tokens, max }) => (
  <li className="flex items-center gap-2.5 py-1">
    <span className={`size-2.5 shrink-0 rounded-[3px] ${color}`} />
    <span className="text-muted-foreground truncate">{label}</span>
    <span className="text-muted-foreground ms-auto tabular-nums">{short(tokens)}</span>
    <span className="w-12 text-right font-medium tabular-nums">{((tokens / max) * 100).toFixed(1)}%</span>
  </li>
)

const Breakdown: FC<{ usage: ContextUsage }> = ({ usage }) => {
  const [showTools, setShowTools] = useState(false)
  const rows = categories.map((c) => ({ ...c, tokens: usage.categories[c.id] ?? 0 })).filter((c) => c.tokens > 0)
  return (
    <>
      <div className="flex items-baseline justify-between">
        <span className="text-base font-medium">{Math.round((usage.used / usage.max) * 100)}% used</span>
        <span className="text-muted-foreground tabular-nums">
          {short(usage.used)} / {short(usage.max)}
        </span>
      </div>
      <div className="bg-muted my-2 flex h-1.5 gap-px overflow-hidden rounded-full">
        {rows.map((row) => (
          <span key={row.id} className={row.color} style={{ width: `${(row.tokens / usage.max) * 100}%` }} />
        ))}
      </div>
      <p className="text-muted-foreground mb-2 text-xs">Size of the latest model call, plus its reply.</p>
      <ul>
        {rows.map((row) => (
          <Row key={row.id} color={row.color} label={row.label} tokens={row.tokens} max={usage.max} />
        ))}
        <Row color="bg-zinc-600" label="Autocompact buffer" tokens={usage.buffer} max={usage.max} />
        <Row color="bg-zinc-800" label="Free space" tokens={usage.free} max={usage.max} />
      </ul>
      <button
        type="button"
        aria-expanded={showTools}
        onClick={() => setShowTools(!showTools)}
        className="text-muted-foreground hover:text-foreground mt-3 flex w-full items-center gap-2 border-t pt-3"
      >
        <ChevronRightIcon className={`size-4 transition-transform ${showTools ? 'rotate-90' : ''}`} />
        Tools
        <span className="ms-auto tabular-nums">{usage.tools.length}</span>
      </button>
      {showTools && (
        <ul className="mt-1 ps-6">
          {usage.tools.map((tool) => (
            <li key={tool.name} className="flex justify-between gap-2 py-0.5">
              <span className="truncate font-mono text-xs">{tool.name}</span>
              <span className="text-muted-foreground tabular-nums">{short(tool.tokens)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

export const ContextPanel: FC = () => {
  const usage = useContextUsage((s) => s.usage)
  const [open, setOpen] = useState(true)
  return (
    <aside
      aria-label="Context usage"
      className="bg-background absolute inset-y-0 right-0 z-10 w-72 shrink-0 overflow-y-auto border-l p-3 text-sm lg:static"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="mb-3 flex items-center gap-1.5 font-medium"
      >
        Context
        <ChevronDownIcon className={`text-muted-foreground size-4 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open &&
        (usage ? (
          <Breakdown usage={usage} />
        ) : (
          <p className="text-muted-foreground">Send a message to measure the context.</p>
        ))}
    </aside>
  )
}
