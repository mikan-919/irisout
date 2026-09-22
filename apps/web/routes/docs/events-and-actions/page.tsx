// DOMイベントとuseアクションを説明する。
import { render } from 'irisout'
import { DocsPage } from '../../../src/DocsPage.jsx'

export default function EventDocs() {
  render(
    <DocsPage
      section="イベント"
      title="イベントとuseアクション"
      description="ブラウザ標準イベントと実DOMが必要な処理を接続します。"
      previousHref="/docs/state"
      previousTitle="状態と派生値"
      nextHref="/docs/conditionals-and-lists"
      nextTitle="条件分岐とキー付き一覧"
    >
      <h2>DOMイベント</h2>
      <p>onClickやonInputへ関数を渡します。currentTargetは属性を指定した要素です。</p>
      <pre>
        <code>{'function updateName(event) {\n  name(event.currentTarget.value)\n}'}</code>
      </pre>
      <h2>useアクション</h2>
      <p>useは要素の接続後に実DOMを受け取り、更新処理と破棄処理を返せます。</p>
      <pre>
        <code>
          {
            'function observe(element) {\n  const observer = new ResizeObserver(read)\n  observer.observe(element)\n  return { destroy() { observer.disconnect() } }\n}'
          }
        </code>
      </pre>
    </DocsPage>,
  )
}
