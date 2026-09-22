// signalとderivedによる状態更新を説明する。
import { render } from 'irisout'
import { DocsPage } from '../../../src/DocsPage.jsx'

export default function StateDocs() {
  render(
    <DocsPage
      section="状態と更新"
      title="状態と派生値"
      description="signalとderivedを使い、必要なDOMだけを更新します。"
      previousHref="/docs/getting-started"
      previousTitle="npm公開版から始める"
      nextHref="/docs/events-and-actions"
      nextTitle="イベントとuseアクション"
    >
      <h2>signal</h2>
      <p>signal(initial)は引数なしで現在値を読み、値または更新関数を渡して書き換えます。</p>
      <pre>
        <code>{'const count = signal(0)\ncount()\ncount((previous) => previous + 1)'}</code>
      </pre>
      <h2>derived</h2>
      <p>derivedは参照した状態から読み取り専用の値を計算します。</p>
      <pre>
        <code>
          {'const doubled = derived(() => count() * 2)\nrender(<output>{doubled()}</output>)'}
        </code>
      </pre>
      <h2>宣言位置</h2>
      <p>状態と派生値はrenderより前、状態を書き換えるイベント関数はrenderより後に置けます。</p>
    </DocsPage>,
  )
}
