import { render, signal } from 'irisout'

export function App() {
  const count = signal(0)
  const requests = { active: true }
  render(<p>{count()}</p>)
}
