// カウンター、100件の絞り込み、サーバーへの登録要求を比較する測定専用画面。
import { derived, render, signal } from 'irisout'
export function Interactive(input) {
  const users = signal(input.users)
  const count = signal(0)
  const query = signal('')
  const pending = signal(false)
  const result = signal('')
  const matches = derived(() =>
    users().filter(
      (user) =>
        user.name.toLowerCase().includes(query().trim().toLowerCase()) ||
        user.email.includes(query().trim().toLowerCase()),
    ),
  )
  render(
    <main>
      <h1>Interactive</h1>
      <p class="subtitle">
        Three client components: local state, a filtered list, a server function.
      </p>
      <section>
        <h2>Counter</h2>
        <div class="row">
          <button onClick={() => count(count() + 1)}>Increment</button>
          <span>
            Clicked {count()} time{count() === 1 ? '' : 's'}
          </span>
        </div>
      </section>
      <section>
        <h2>Filter</h2>
        <div class="row">
          <input
            value={query()}
            onInput={(event) => query(event.currentTarget.value)}
            placeholder="Filter by name or email"
            aria-label="Filter users"
          />
          <span>
            {matches().length} of {users().length}
          </span>
        </div>
        <ul class="matches">
          {matches()
            .slice(0, 25)
            .map((user) => (
              <li key={user.id}>
                {user.name} — {user.email} ({user.role})
              </li>
            ))}
        </ul>
      </section>
      <section>
        <h2>Sign up</h2>
        <form onSubmit={submit}>
          <div class="row">
            <input name="name" placeholder="Name" aria-label="Name" />
            <input name="email" placeholder="Email" aria-label="Email" />
            <button type="submit" disabled={pending()}>
              {pending() ? 'Submitting…' : 'Submit'}
            </button>
          </div>
          {result() ? <p class="summary">{result()}</p> : null}
        </form>
      </section>
      <p class="summary" data-marker="initial">
        Server-rendered shell.
      </p>
    </main>,
  )
  async function submit(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    pending(true)
    const response = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: String(form.get('name') ?? ''),
        email: String(form.get('email') ?? ''),
      }),
    })
    const data = await response.json()
    result(data.ok ? `Created user #${data.id}` : data.error)
    pending(false)
  }
}
