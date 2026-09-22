// ライフサイクルとコンテキストを説明する。
import { render } from 'irisout'
import { DocsPage } from '../../../src/DocsPage.jsx'

export default function LifecycleDocs() {
  render(
    <DocsPage
      section="ライフサイクル"
      title="ライフサイクルとコンテキスト"
      description="初期化、更新後処理、後始末、子孫への値の受け渡しを扱います。"
      previousHref="/docs/components-and-modules"
      previousTitle="部品とファイル分割"
      nextHref="/docs/api"
      nextTitle="記述API一覧"
    >
      <h2>onMount</h2>
      <p>DOM接続後に一度実行され、返した関数は破棄時に実行されます。</p>
      <pre>
        <code>
          {
            'onMount(() => {\n  const timer = setInterval(tick, 1000)\n  return () => clearInterval(timer)\n})'
          }
        </code>
      </pre>
      <h2>effect</h2>
      <p>参照した状態の変更後に実行されます。返した関数は再実行前と破棄時の後始末です。</p>
      <h2>コンテキスト</h2>
      <p>
        createContext、provideContext、useContextで子孫へ値を渡します。接続はコンパイル時に確定します。
      </p>
    </DocsPage>,
  )
}
