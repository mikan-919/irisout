// コンパイル診断と対応範囲を説明する。
import { render } from 'irisout'
import { DocsPage } from '../../../src/DocsPage.jsx'

export default function DiagnosticDocs() {
  render(
    <DocsPage
      section="診断と対応範囲"
      title="診断と対応範囲"
      description="scope limitの読み方と現在の主な境界です。"
      previousHref="/docs/hono-routing"
      previousTitle="Honoとpage.tsxのファイル経路"
      nextHref={null}
      nextTitle=""
    >
      <h2>scope limit</h2>
      <p>安全な更新経路を静的に作れない構文は、推測せずcompile診断として拒否します。</p>
      <h2>主な境界</h2>
      <ul>
        <li>ルート部品は一つ</li>
        <li>状態はrenderより前に宣言</li>
        <li>一覧は直接のmapと安定したkeyを使用</li>
        <li>部品の再帰と循環moduleは未対応</li>
        <li>ブラウザ内コンパイラは単一ソースだけを処理</li>
      </ul>
      <h2>不具合報告</h2>
      <p>最小化したJSX、診断全文、irisoutとブラウザの版、再現手順を残してください。</p>
    </DocsPage>,
  )
}
