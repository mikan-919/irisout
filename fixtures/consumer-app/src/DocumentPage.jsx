// 文書の外枠をJSXで書くソース版の型検査例。ブラウザー入口は経路連携が注入する。
import { signal } from 'irisout'

/** @param {{title: string, children: object | void}} props */
function Layout({ title, children }) {
  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <title>{title}</title>
      </head>
      <body>{children}</body>
    </html>
  )
}

export function DocumentPage() {
  const count = signal(0)
  return (
    <Layout title="Counter">
      <main>
        <button onClick={() => count(count() + 1)}>{count()}</button>
      </main>
    </Layout>
  )
}
