import { useEffect, useState } from 'react'
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from '@assistant-ui/react'
import { Thread } from '@/components/assistant-ui/elements/thread.aui'
import { TooltipProvider } from '@/components/ui/tooltip'

// Streams the reply from the FastAPI endpoint, which proxies to vLLM.
const vllmAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const payload = {
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content
          .filter((p) => p.type === 'text')
          .map((p) => p.text)
          .join(''),
      })),
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

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let text = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
      yield { content: [{ type: 'text', text }] }
    }
  },
}

export default function App() {
  const runtime = useLocalRuntime(vllmAdapter)
  const [model, setModel] = useState<string>('')

  // Read the model name from the server so the UI always shows what vLLM is serving.
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((data) => setModel(data.model ?? ''))
      .catch(() => setModel(''))
  }, [])

  return (
    <TooltipProvider>
      <AssistantRuntimeProvider runtime={runtime}>
        <div className="flex h-dvh flex-col">
          <header className="flex items-center justify-between gap-4 border-b px-4 py-3">
            <span className="font-semibold">VLLM x assistant UI</span>
            {model && <span className="truncate text-sm text-muted-foreground">{model}</span>}
          </header>
          <div className="min-h-0 flex-1">
            <Thread />
          </div>
        </div>
      </AssistantRuntimeProvider>
    </TooltipProvider>
  )
}
