// 一覧と詳細で共有する文書部品。ブラウザー入口はHono連携が挿入する。
export function Layout({ title, children }) {
  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
      </head>
      <body>
        <header>
          <a href="/">障害対応ボード</a>
        </header>
        {children}
      </body>
    </html>
  )
}
