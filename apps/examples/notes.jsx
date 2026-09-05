// 実用画面の作者向け網羅性fixture。フォーム、タブ、リスト項目ごとの局所状態、
// 条件分岐、入れ子リスト、同一ファイルのコンポーネント合成を1画面で使う。
export function NotesApp() {
  const notes = signal([
    {
      id: 1,
      title: '出張の準備',
      summary: '交通と宿泊を確認する',
      body: '新幹線の予約番号をチームへ共有する。',
      archived: false,
      tags: ['交通', '共有'],
    },
    {
      id: 2,
      title: '読書メモ',
      summary: '設計の判断を記録する',
      body: '測定結果と意味論を同じ記録に残す。',
      archived: true,
      tags: ['設計'],
    },
  ])
  const tab = signal('open')
  const composerOpen = signal(false)
  const draft = signal('')
  const visibleNotes = derived(() =>
    tab() === 'archived'
      ? notes().filter((note) => note.archived)
      : notes().filter((note) => !note.archived),
  )

  render(
    <main class="notes-app">
      <header>
        <h1>Notes</h1>
        <button type="button" onClick={() => composerOpen(!composerOpen())}>
          {composerOpen() ? 'Close' : 'New note'}
        </button>
      </header>

      <nav class="tabs">
        <button type="button" class={tab() === 'open' ? 'active' : ''} onClick={() => tab('open')}>
          Open
        </button>
        <button
          type="button"
          class={tab() === 'archived' ? 'active' : ''}
          onClick={() => tab('archived')}
        >
          Archived
        </button>
      </nav>

      {composerOpen() ? (
        <form class="composer">
          <label>
            Title
            <input
              onInput={(e) => {
                const target = e.target
                if (target && 'value' in target && typeof target.value === 'string') {
                  draft(target.value)
                }
              }}
            />
          </label>
          <button type="button" onClick={addNote}>
            Save
          </button>
        </form>
      ) : (
        <p class="hint">Select a note to inspect its tags.</p>
      )}

      <section class="note-list">
        {visibleNotes().map((note) => (
          <NoteCard key={note.id} note={note} onArchive={() => archiveNote(note.id)} />
        ))}
      </section>
    </main>,
  )

  function addNote() {
    const title = draft().trim()
    if (title === '') return
    notes([
      ...notes(),
      {
        id: Date.now(),
        title,
        summary: '新しいメモ',
        body: title,
        archived: false,
        tags: ['新規'],
      },
    ])
    draft('')
    composerOpen(false)
  }

  function archiveNote(id) {
    notes(notes().map((note) => (note.id === id ? { ...note, archived: !note.archived } : note)))
  }
}

function NoteCard({ note, onArchive }) {
  const expanded = signal(false)

  render(
    <article key={note.id} class={expanded() ? 'expanded' : ''}>
      <header>
        <h2>{note.title}</h2>
        <button type="button" onClick={() => expanded(!expanded())}>
          {expanded() ? 'Collapse' : 'Expand'}
        </button>
      </header>

      {expanded() ? (
        <section>
          <p>{note.body}</p>
          <ul>
            {note.tags.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        </section>
      ) : (
        <p>{note.summary}</p>
      )}

      <button type="button" onClick={onArchive}>
        {note.archived ? 'Restore' : 'Archive'}
      </button>
    </article>,
  )
}
