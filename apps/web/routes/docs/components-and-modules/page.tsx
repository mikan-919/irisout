// 部品合成と相対module分割を説明する。
import { render } from 'irisout'
import { DocsPage } from '../../../src/DocsPage.jsx'

export default function ComponentDocs() {
  render(
    <DocsPage
      section="部品とファイル分割"
      title="部品とファイル分割"
      description="props、children、相対importでJSXを分割します。"
      previousHref="/docs/conditionals-and-lists"
      previousTitle="条件分岐とキー付き一覧"
      nextHref="/docs/lifecycle-and-context"
      nextTitle="ライフサイクルとコンテキスト"
    >
      <h2>部品</h2>
      <p>
        部品はpropsを分割代入で受け取り、内部でrenderを呼びます。境界はコンパイル時に展開されます。
      </p>
      <pre>
        <code>
          {
            'function Badge({ label }) {\n  render(<span>{label}</span>)\n}\n\nexport function App() {\n  render(<Badge label="安定版" />)\n}'
          }
        </code>
      </pre>
      <h2>children</h2>
      <p>childrenは部品の直接の子位置で使えます。</p>
      <h2>ファイル分割</h2>
      <p>compileProjectとVite連携は相対importをたどります。循環importは拒否されます。</p>
    </DocsPage>,
  )
}
