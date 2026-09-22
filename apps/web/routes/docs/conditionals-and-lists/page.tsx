// 条件分岐とキー付き一覧の記述規則を説明する。
import { render } from 'irisout'
import { DocsPage } from '../../../src/DocsPage.jsx'

export default function StructureDocs() {
  render(
    <DocsPage
      section="条件分岐と一覧"
      title="条件分岐とキー付き一覧"
      description="三項演算子、論理積、mapとkeyで動的な構造を記述します。"
      previousHref="/docs/events-and-actions"
      previousTitle="イベントとuseアクション"
      nextHref="/docs/components-and-modules"
      nextTitle="部品とファイル分割"
    >
      <h2>条件分岐</h2>
      <p>表示の切り替えはJSX内の三項演算子または論理積で記述します。</p>
      <pre>
        <code>{'{open() ? <p>表示中</p> : <p>非表示</p>}\n{ready() && <Result />}'}</code>
      </pre>
      <h2>一覧</h2>
      <p>一覧は状態を直接mapし、各項目のルートへデータ由来のkeyを指定します。</p>
      <pre>
        <code>
          {'<ul>{tasks().map((task) => (\n  <li key={task.id}>{task.label}</li>\n))}</ul>'}
        </code>
      </pre>
      <p>更新では新しい配列をsignalへ渡します。keyを使ってDOMと局所状態を再利用します。</p>
    </DocsPage>,
  )
}
