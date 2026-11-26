// Left sidebar: start a new chat or reopen a saved one.
import { useEffect, type FC } from 'react'
import { MessageSquareIcon, SquarePenIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useThreads, type ThreadSummary } from './threads'

const DAY = 24 * 60 * 60 * 1000

function dateGroup(updated: string) {
  const today = new Date().setHours(0, 0, 0, 0)
  const time = new Date(updated).getTime()
  if (time >= today) return 'Today'
  if (time >= today - DAY) return 'Yesterday'
  if (time >= today - 7 * DAY) return 'Previous 7 days'
  return 'Older'
}

/** The list arrives newest first, so each group is a run of neighbours. */
function groupByDate(threads: ThreadSummary[]) {
  const groups: { name: string; threads: ThreadSummary[] }[] = []
  for (const thread of threads) {
    const name = dateGroup(thread.updated_at)
    if (groups.at(-1)?.name !== name) groups.push({ name, threads: [] })
    groups.at(-1)!.threads.push(thread)
  }
  return groups
}

/** `onPick` lets a narrow screen close the sidebar after a choice. */
export const ThreadList: FC<{ onPick: () => void }> = ({ onPick }) => {
  const { list, current, error, refresh, startNew, open } = useThreads()

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <nav
      aria-label="Chats"
      className="bg-background absolute inset-y-0 left-0 z-20 flex w-64 shrink-0 flex-col border-r md:static"
    >
      <div className="p-2">
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={() => {
            startNew()
            onPick()
          }}
        >
          <SquarePenIcon className="size-4" />
          New chat
        </Button>
      </div>
      {error && <p className="px-3 pb-2 text-xs text-red-400">{error}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {list.length === 0 && <p className="text-muted-foreground px-2 text-sm">No saved chats yet.</p>}
        {groupByDate(list).map((group) => (
          <section key={group.name}>
            <h2 className="text-muted-foreground px-2 pt-3 pb-1 text-xs font-medium">{group.name}</h2>
            <ul className="flex flex-col gap-0.5">
              {group.threads.map((thread) => (
                <li key={thread.id}>
                  <button
                    type="button"
                    title={thread.title}
                    aria-current={thread.id === current.id ? 'page' : undefined}
                    onClick={() => {
                      void open(thread.id)
                      onPick()
                    }}
                    className="text-muted-foreground hover:bg-muted/60 hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
                  >
                    <MessageSquareIcon className="size-3.5 shrink-0" />
                    <span className="truncate">{thread.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  )
}
