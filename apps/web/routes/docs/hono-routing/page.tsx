// irisout/honoのファイル経路を説明する。
import { render } from 'irisout'
import { DocsPage } from '../../../src/DocsPage.jsx'

export default function HonoDocs() {
  render(
    <DocsPage
      section="API"
      title="Honoとpage.tsxのファイル経路"
      description="page.tsxのディレクトリ構造をHonoの要求単位SSRへ接続します。"
      previousHref="/docs/api"
      previousTitle="記述API一覧"
      nextHref="/docs/diagnostics"
      nextTitle="診断と対応範囲"
    >
      <h2>経路を作る</h2>
      <pre>
        <code>{'routes/\n├── page.tsx\n├── about/page.tsx\n└── users/[id]/page.tsx'}</code>
      </pre>
      <p>この構成はルート、about、users/:idの経路になります。</p>
      <h2>Honoへ接続する</h2>
      <pre>
        <code>
          {
            'import { createFileRouter } from \'irisout/hono\'\n\napp.route(\'/\', createFileRouter(\'./routes\', {\n  document: ({ html, stateScript }) =>\n    `<!doctype html><html><body><div id="app">${html}</div>${stateScript}<script type="module" src="/irisout-client.js"></script></body></html>`,\n}))'
          }
        </code>
      </pre>
      <h2>loader</h2>
      <p>loaderはJSONで表せる入力をpageへ渡します。notFoundとredirectも返せます。</p>
    </DocsPage>,
  )
}
