// 記述APIとコンパイラ入口の一覧。
import { render } from 'irisout'
import { DocsPage } from '../../../src/DocsPage.jsx'

export default function ApiDocs() {
  render(
    <DocsPage
      section="API"
      title="記述API一覧"
      description="irisoutから取り込む記述用APIとコンパイラ入口です。"
      previousHref="/docs/lifecycle-and-context"
      previousTitle="ライフサイクルとコンテキスト"
      nextHref="/docs/hono-routing"
      nextTitle="Honoとpage.tsxのファイル経路"
    >
      <h2>状態と描画</h2>
      <ul>
        <li>signal — 読み書きできる状態</li>
        <li>derived — 状態から計算する値</li>
        <li>render — 部品が所有するJSX</li>
      </ul>
      <h2>ライフサイクル</h2>
      <ul>
        <li>onMount — DOM接続後の処理</li>
        <li>effect — 状態変更後の処理</li>
        <li>use — 実DOMへの処理接続</li>
      </ul>
      <h2>コンテキスト</h2>
      <ul>
        <li>createContext</li>
        <li>createAsyncContext</li>
        <li>provideContext</li>
        <li>useContext</li>
      </ul>
      <h2>コンパイラ入口</h2>
      <ul>
        <li>compile</li>
        <li>compileProject</li>
        <li>compileSSR</li>
        <li>irisout/browser</li>
      </ul>
    </DocsPage>,
  )
}
