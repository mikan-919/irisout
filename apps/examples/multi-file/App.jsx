import SplitCard from './components/SplitCard.jsx'
import { CARD_PREFIX } from './lib/constants.js'
import { formatTitle, matchesFilter, nextFilter } from './lib/format.js'

export function App() {
  const notes = signal([
    {
      id: 1,
      title: 'コンパイラを読む',
      summary: 'AST の境界を確認する',
      status: 'open',
      tags: ['code', 'design'],
    },
    {
      id: 2,
      title: '牛乳を買う',
      summary: '帰りに買い物をする',
      status: 'archived',
      tags: ['home'],
    },
  ])
  const filter = signal('all')
  const visibleNotes = derived(() => notes().filter((note) => matchesFilter(note, filter())))

  render(
    <main class="multi-file-notes">
      <h1>{formatTitle({ title: 'ノート' })}</h1>
      <button class="next-filter" onClick={() => filter(nextFilter(filter()))}>
        filter: {filter()}
      </button>
      <p class="count">{visibleNotes().length} 件</p>
      <ul class="note-list">
        {visibleNotes().map((note) => (
          <SplitCard
            key={note.id}
            note={note}
            heading={formatTitle(note)}
            prefix={CARD_PREFIX}
            onRemove={() => notes(notes().filter((candidate) => candidate.id !== note.id))}
          />
        ))}
      </ul>
    </main>,
  )
}
