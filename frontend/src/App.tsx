import { useEffect, useMemo, useState, type FC, type PropsWithChildren } from 'react'
import {
  AssistantRuntimeProvider,
  AuiConfig,
  Tools,
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadAssistantMessagePart,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import { PanelLeftIcon, PanelRightIcon, SquarePenIcon } from 'lucide-react'
import { Welcome, Working } from '@/agent/chrome'
import { ContextPanel, useContextUsage } from '@/agent/context-panel'
import { Logo } from '@/agent/logo'
import { applyEvent, readEvents } from '@/agent/stream'
import { ThreadList } from '@/agent/thread-list'
import { useThreads } from '@/agent/threads'
import { ToolCall } from '@/agent/tool-call'
import { addUsage, emptyUsage, usagePart, UsageLine } from '@/agent/usage'
import { Thread, type ThreadComponents } from '@/components/assistant-ui/elements/thread.aui'
import { TooltipProvider } from '@/components/ui/tooltip'
import toolkit from '@/toolkit'

// Streams the deep agent's run from the FastAPI endpoint.
const agentAdapter = (threadId: string): ChatModelAdapter => ({
  async *run({ messages, abortSignal }) {
    // The server remembers the thread, so only the newest user message is sent.
    const userMessages = messages.filter((m) => m.role === 'user')
    const latest = userMessages.at(-1)
    if (!latest) return
    const payload = {
      thread_id: threadId,
      message_id: latest.id,
      content: latest.content
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n\n'),
      // Lets the server drop turns that were edited or regenerated.
      history: userMessages.slice(0, -1).map((m) => m.id),
    }

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abortSignal,
    })

    if (!response.ok || !response.body) {
      throw new Error(`Chat request failed: ${response.status} ${response.statusText}`)
    }

    const { refresh } = useThreads.getState()
    let parts: ThreadAssistantMessagePart[] = []
    const usage = emptyUsage()
    const started = performance.now()
    let listed = false

    try {
      for await (const events of readEvents(response.body)) {
        // The message is saved by now, so a new chat can appear in the list.
        if (!listed) {
          listed = true
          void refresh()
        }
        for (const event of events) {
          if (event.type === 'error') {
            yield { content: parts }
            throw new Error(event.message)
          }
          if (event.type === 'context') {
            // Another chat may have been opened while this one was running.
            if (useThreads.getState().current.id === threadId) useContextUsage.setState({ usage: event })
          } else if (event.type === 'usage') {
            addUsage(usage, event)
          } else {
            parts = applyEvent(parts, event)
          }
        }
        yield { content: parts }
      }
    } finally {
      void refresh()
    }

    usage.seconds = (performance.now() - started) / 1000
    yield { content: [...parts, usagePart(usage)] }
  },
})

// Show each tool call on its own line instead of folding them into a closed group.
const threadComponents: ThreadComponents = {
  Welcome,
  ComposerExtra: Working,
  ToolFallback: ToolCall,
  ToolGroup: ({ children }: PropsWithChildren) => <div className="my-2 flex flex-col gap-1">{children}</div>,
}

/** One conversation. Give it a new `key` to show a different thread. */
const Chat: FC<{ threadId: string; initialMessages: ThreadMessageLike[] }> = ({ threadId, initialMessages }) => {
  const adapter = useMemo(() => agentAdapter(threadId), [threadId])
  const runtime = useLocalRuntime(adapter, { initialMessages })

  // Leaving a chat stops its reply, so it can't keep running unseen.
  useEffect(
    () => () => {
      if (runtime.thread.getState().isRunning) runtime.thread.cancelRun()
    },
    [runtime],
  )

  return (
    <AssistantRuntimeProvider runtime={runtime} config={AuiConfig({ tools: Tools({ toolkit }) })}>
      <UsageLine />
      <Thread components={threadComponents} />
    </AssistantRuntimeProvider>
  )
}

const PanelButton: FC<PropsWithChildren<{ label: string; pressed: boolean; onClick: () => void }>> = ({
  label,
  pressed,
  onClick,
  children,
}) => (
  <button
    type="button"
    aria-label={label}
    aria-pressed={pressed}
    onClick={onClick}
    className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-md p-1.5"
  >
    {children}
  </button>
)

export default function App() {
  const current = useThreads((s) => s.current)
  const startNew = useThreads((s) => s.startNew)
  const [model, setModel] = useState<string>('')
  // Both sidebars start open where there's room beside the chat.
  const [showThreads, setShowThreads] = useState(() => window.innerWidth >= 768)
  const [showContext, setShowContext] = useState(() => window.innerWidth >= 1024)

  // Read the model name from the server so the UI always shows what vLLM is serving.
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((data) => setModel(data.model ?? ''))
      .catch(() => setModel(''))
  }, [])

  return (
    <TooltipProvider>
      <div className="flex h-dvh flex-col">
        <header className="flex items-center justify-between gap-4 border-b px-3 py-3">
          <span className="flex min-w-0 items-center gap-2 font-semibold">
            <PanelButton label="Toggle chat list" pressed={showThreads} onClick={() => setShowThreads(!showThreads)}>
              <PanelLeftIcon className="size-4" />
            </PanelButton>
            {!showThreads && (
              <button
                type="button"
                aria-label="New chat"
                onClick={startNew}
                className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-md p-1.5"
              >
                <SquarePenIcon className="size-4" />
              </button>
            )}
            <Logo className="size-5" />
            <span className="truncate">VLLM x assistant UI</span>
          </span>
          <span className="flex min-w-0 items-center gap-2">
            {model && (
              <span className="text-muted-foreground truncate rounded-full border px-2.5 py-0.5 font-mono text-xs">
                {model}
              </span>
            )}
            <PanelButton label="Toggle context panel" pressed={showContext} onClick={() => setShowContext(!showContext)}>
              <PanelRightIcon className="size-4" />
            </PanelButton>
          </span>
        </header>
        <div className="relative flex min-h-0 flex-1">
          {showThreads && (
            <ThreadList
              onPick={() => {
                if (window.innerWidth < 768) setShowThreads(false)
              }}
            />
          )}
          <div className="min-w-0 flex-1">
            <Chat key={current.id} threadId={current.id} initialMessages={current.messages} />
          </div>
          {showContext && <ContextPanel />}
        </div>
      </div>
    </TooltipProvider>
  )
}
