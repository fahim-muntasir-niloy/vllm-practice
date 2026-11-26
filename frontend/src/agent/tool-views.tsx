// How each tool looks: its icon, name, one-line summary and expanded details.
import type { ReactNode } from 'react'
import {
  BotIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleIcon,
  FilePenIcon,
  FilePlusIcon,
  FileSearchIcon,
  FileTextIcon,
  FolderIcon,
  FolderSearchIcon,
  GlobeIcon,
  ListTodoIcon,
  SquareTerminalIcon,
  Trash2Icon,
  WrenchIcon,
  type LucideIcon,
} from 'lucide-react'

export type Args = Record<string, unknown>

export type ToolView = {
  label: string
  icon: LucideIcon
  /** The argument shown next to the name. */
  argument?: string
  /** One line describing a finished call. */
  outcome?: (result: string, args: Args) => string
  /** Details shown when the row is opened. Defaults to the raw arguments and result. */
  details?: (args: Args, result: string | undefined) => ReactNode
  /** Content that stays visible while the row is closed. */
  pinned?: (args: Args, result: string | undefined) => ReactNode
}

type SearchResult = { title: string; url: string; content: string; published?: string }

function searchResults(result: string | undefined): SearchResult[] | undefined {
  if (result === undefined) return undefined
  try {
    const data = JSON.parse(result) as { results?: SearchResult[] }
    return data.results
  } catch {
    return undefined
  }
}

/** Search results come from the web, so only ordinary web links become clickable. */
const isWebUrl = (url: string) => /^https?:\/\//i.test(url)

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')
const lineCount = (value: string) => (value ? value.replace(/\n$/, '').split('\n').length : 0)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export const Code = ({ children, tone }: { children: ReactNode; tone?: 'added' | 'removed' }) => (
  <pre
    className={[
      'max-h-72 overflow-auto rounded-md p-2.5 font-mono text-xs break-words whitespace-pre-wrap',
      tone === 'added'
        ? 'bg-emerald-500/10 text-emerald-300'
        : tone === 'removed'
          ? 'bg-red-500/10 text-red-300'
          : 'bg-muted/50 text-foreground/80',
    ].join(' ')}
  >
    {children}
  </pre>
)

const prefixLines = (value: string, prefix: string) =>
  value
    .split('\n')
    .map((line) => prefix + line)
    .join('\n')

function SearchDetails({ results }: { results: SearchResult[] }) {
  return (
    <ul className="flex max-h-80 flex-col gap-3 overflow-auto">
      {results.map((r) => (
        <li key={r.url} className="min-w-0">
          {isWebUrl(r.url) ? (
            <a href={r.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
              {r.title || r.url}
            </a>
          ) : (
            <span className="font-medium">{r.title}</span>
          )}
          <p className="text-muted-foreground text-xs">
            {hostname(r.url)}
            {r.published && ` · ${r.published}`}
          </p>
          <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">{r.content.slice(0, 300)}</p>
        </li>
      ))}
    </ul>
  )
}

function SourceChips({ results }: { results: SearchResult[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {results
        .filter((r) => isWebUrl(r.url))
        .map((r) => (
          <a
            key={r.url}
            href={r.url}
            target="_blank"
            rel="noreferrer"
            title={r.title}
            className="bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors"
          >
            <GlobeIcon className="size-3" />
            {hostname(r.url)}
          </a>
        ))}
    </div>
  )
}

type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed' }

function TodoList({ todos }: { todos: Todo[] }) {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {todos.map((todo, i) => {
        const Icon =
          todo.status === 'completed' ? CircleCheckIcon : todo.status === 'in_progress' ? CircleDashedIcon : CircleIcon
        return (
          <li key={i} className="flex items-start gap-2">
            <Icon
              className={[
                'mt-0.5 size-4 shrink-0',
                todo.status === 'completed'
                  ? 'text-emerald-400'
                  : todo.status === 'in_progress'
                    ? 'text-agent'
                    : 'text-muted-foreground',
              ].join(' ')}
            />
            <span
              className={
                todo.status === 'completed'
                  ? 'text-muted-foreground line-through'
                  : todo.status === 'in_progress'
                    ? 'font-medium'
                    : ''
              }
            >
              {todo.content}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

const views: Record<string, ToolView> = {
  search_web: {
    label: 'Web Search',
    icon: GlobeIcon,
    argument: 'query',
    outcome: (result) => {
      const results = searchResults(result)
      return results ? `Read ${plural(results.length, 'page')}` : result.slice(0, 120)
    },
    pinned: (_, result) => {
      const results = searchResults(result)
      return results?.length ? <SourceChips results={results} /> : null
    },
    details: (_, result) => {
      const results = searchResults(result)
      if (results) return <SearchDetails results={results} />
      return result ? <Code>{result}</Code> : null
    },
  },
  write_todos: {
    label: 'Update Todos',
    icon: ListTodoIcon,
    pinned: (args) => (Array.isArray(args.todos) ? <TodoList todos={args.todos as Todo[]} /> : null),
  },
  task: { label: 'Subagent', icon: BotIcon, argument: 'description' },
  ls: {
    label: 'List',
    icon: FolderIcon,
    argument: 'path',
    details: (_, result) => (result ? <Code>{result}</Code> : null),
  },
  read_file: {
    label: 'Read',
    icon: FileTextIcon,
    argument: 'file_path',
    outcome: (result) => `Read ${plural(lineCount(result), 'line')}`,
    details: (_, result) => (result ? <Code>{result}</Code> : null),
  },
  write_file: {
    label: 'Write',
    icon: FilePlusIcon,
    argument: 'file_path',
    outcome: (_, args) => `Wrote ${plural(lineCount(text(args.content)), 'line')}`,
    details: (args) => <Code tone="added">{prefixLines(text(args.content), '+ ')}</Code>,
  },
  edit_file: {
    label: 'Update',
    icon: FilePenIcon,
    argument: 'file_path',
    outcome: (_, args) =>
      `Added ${plural(lineCount(text(args.new_string)), 'line')}, removed ${plural(lineCount(text(args.old_string)), 'line')}`,
    details: (args) => (
      <div className="flex flex-col gap-1">
        <Code tone="removed">{prefixLines(text(args.old_string), '- ')}</Code>
        <Code tone="added">{prefixLines(text(args.new_string), '+ ')}</Code>
      </div>
    ),
  },
  glob: {
    label: 'Find Files',
    icon: FolderSearchIcon,
    argument: 'pattern',
    details: (_, result) => (result ? <Code>{result}</Code> : null),
  },
  grep: {
    label: 'Search Files',
    icon: FileSearchIcon,
    argument: 'pattern',
    details: (_, result) => (result ? <Code>{result}</Code> : null),
  },
  execute: {
    label: 'Run',
    icon: SquareTerminalIcon,
    argument: 'command',
    details: (args, result) => (
      <div className="flex flex-col gap-1">
        <Code>{`$ ${text(args.command)}`}</Code>
        {result && <Code>{result}</Code>}
      </div>
    ),
  },
  delete: { label: 'Delete', icon: Trash2Icon, argument: 'file_path' },
}

export const toolView = (name: string): ToolView => views[name] ?? { label: name, icon: WrenchIcon }
