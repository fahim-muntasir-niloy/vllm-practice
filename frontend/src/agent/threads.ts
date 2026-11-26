// Saved chats: the list, which one is open, and loading its history.
import type { ThreadAssistantMessagePart, ThreadMessageLike } from '@assistant-ui/react'
import { create } from 'zustand'
import { useContextUsage, type ContextUsage } from './context-panel'
import { applyEvent, type AgentEvent } from './stream'
import { addUsage, emptyUsage, usagePart } from './usage'

export type ThreadSummary = { id: string; title: string; updated_at: string }

type SavedTurn =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; events: AgentEvent[] }

type OpenThread = { id: string; messages: ThreadMessageLike[] }

const newThreadId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
const emptyThread = (): OpenThread => ({ id: newThreadId(), messages: [] })

type Threads = {
  list: ThreadSummary[]
  current: OpenThread
  /** Why the last load failed, if it did. */
  error: string | null
  refresh: () => Promise<void>
  startNew: () => void
  open: (id: string) => Promise<void>
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json() as Promise<T>
}

/** Rebuild a saved reply with the same code that draws a live one. */
function toMessage(turn: SavedTurn): ThreadMessageLike {
  if (turn.role === 'user') return { id: turn.id, role: 'user', content: turn.text }
  let parts: ThreadAssistantMessagePart[] = []
  const usage = emptyUsage()
  for (const event of turn.events) {
    if (event.type === 'usage') addUsage(usage, event)
    else parts = applyEvent(parts, event)
  }
  if (usage.calls) parts = [...parts, usagePart(usage)]
  return { id: turn.id, role: 'assistant', content: parts as ThreadMessageLike['content'] }
}

// Only the most recent click wins if several threads are opened quickly.
let latestRequest = 0

export const useThreads = create<Threads>((set, get) => ({
  list: [],
  current: emptyThread(),
  error: null,

  refresh: async () => {
    try {
      set({ list: await getJson<ThreadSummary[]>('/api/threads') })
    } catch {
      // Keep the old list; the next refresh will try again.
    }
  },

  startNew: () => {
    latestRequest++
    useContextUsage.setState({ usage: null })
    set({ current: emptyThread(), error: null })
  },

  open: async (id) => {
    if (id === get().current.id) return
    const request = ++latestRequest
    try {
      const saved = await getJson<{ turns: SavedTurn[]; context: ContextUsage | null }>(`/api/threads/${id}`)
      if (request !== latestRequest) return
      useContextUsage.setState({ usage: saved.context })
      set({ current: { id, messages: saved.turns.map(toMessage) }, error: null })
    } catch (error) {
      if (request === latestRequest) set({ error: `Could not open the chat: ${(error as Error).message}` })
    }
  },
}))
