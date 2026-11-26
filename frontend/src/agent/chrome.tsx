// The parts around the conversation: welcome screen and working indicator.
import { useEffect, useState, type FC } from 'react'
import { ThreadPrimitive, useAuiState } from '@assistant-ui/react'
import { FileTextIcon, FolderIcon, GlobeIcon } from 'lucide-react'
import { Logo } from './logo'

const suggestions = [
  { icon: GlobeIcon, prompt: 'What is the latest released version of the vLLM library? Search the web.' },
  { icon: FolderIcon, prompt: 'What files are in the workspace?' },
  { icon: FileTextIcon, prompt: 'Save the text "GPUs hum at night" to /haiku.md' },
]

export const Welcome: FC = () => (
  <div className="mx-auto mb-6 flex w-full max-w-(--thread-max-width) flex-col gap-4 px-2">
    <h1 className="flex items-center gap-2 text-2xl font-semibold">
      <Logo className="size-7" />
      What should we work on?
    </h1>
    <div className="flex flex-col gap-1.5">
      {suggestions.map(({ icon: Icon, prompt }) => (
        <ThreadPrimitive.Suggestion
          key={prompt}
          prompt={prompt}
          send
          className="hover:bg-muted/50 text-muted-foreground hover:text-foreground flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors"
        >
          <Icon className="size-4 shrink-0" />
          {prompt}
        </ThreadPrimitive.Suggestion>
      ))}
    </div>
  </div>
)

const Timer: FC = () => {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250)
    return () => clearInterval(id)
  }, [])
  return (
    <span role="status" className="text-agent ms-1 flex items-center gap-1.5 text-xs">
      <Logo className="size-4 animate-pulse" />
      Working…
      <span className="text-muted-foreground tabular-nums">{seconds}s</span>
    </span>
  )
}

/** Shown in the composer while the agent runs. The timer restarts with each run. */
export const Working: FC = () => (useAuiState((s) => s.thread.isRunning) ? <Timer /> : null)
