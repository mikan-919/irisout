import { render, signal } from 'irisout'
import { Layout } from './Layout.jsx'
export function Page({ incident }) {
  const title = signal(incident.title)
  render(
    <Layout title={title()}>
      <h1>{title()}</h1>
    </Layout>,
  )
}
