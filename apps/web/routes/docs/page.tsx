// ドキュメントの分類とページ一覧をHonoのファイル経路からSSRする。
import { render } from 'irisout'
import { DocsSidebar } from '../../src/DocsSidebar.jsx'
import { SiteHeader } from '../../src/SiteHeader.jsx'

export default function DocsIndex() {
  render(
    <div id="top">
      <SiteHeader current="docs" search={false} onSearch={null} />
      <main class="docs-page docs-shell">
        <DocsSidebar />
        <section class="docs-index">
          <div class="docs-heading">
            <p class="eyebrow">DOCUMENTATION</p>
            <h1>ドキュメント</h1>
            <p>irisoutの導入、状態更新、部品、ライフサイクル、対応範囲を説明します。</p>
          </div>
          <div class="docs-index-grid">
            <div>
              <section class="doc-group">
                <h2>導入</h2>
                <ul>
                  <li>
                    <a href="/docs/getting-started">npm公開版から始める</a>
                    <p>導入から最初の本番ビルドまで</p>
                  </li>
                </ul>
              </section>
              <section class="doc-group">
                <h2>状態と更新</h2>
                <ul>
                  <li>
                    <a href="/docs/state">状態と派生値</a>
                    <p>signalとderivedによるDOM更新</p>
                  </li>
                </ul>
              </section>
              <section class="doc-group">
                <h2>イベント</h2>
                <ul>
                  <li>
                    <a href="/docs/events-and-actions">イベントとuseアクション</a>
                    <p>DOMイベントと外部処理の接続</p>
                  </li>
                </ul>
              </section>
              <section class="doc-group">
                <h2>条件分岐と一覧</h2>
                <ul>
                  <li>
                    <a href="/docs/conditionals-and-lists">条件分岐とキー付き一覧</a>
                    <p>動的な構造とDOMの再利用</p>
                  </li>
                </ul>
              </section>
              <section class="doc-group">
                <h2>部品とファイル分割</h2>
                <ul>
                  <li>
                    <a href="/docs/components-and-modules">部品とファイル分割</a>
                    <p>props、children、相対import</p>
                  </li>
                </ul>
              </section>
              <section class="doc-group">
                <h2>ライフサイクル</h2>
                <ul>
                  <li>
                    <a href="/docs/lifecycle-and-context">ライフサイクルとコンテキスト</a>
                    <p>初期化、後始末、値の受け渡し</p>
                  </li>
                </ul>
              </section>
              <section class="doc-group">
                <h2>API</h2>
                <ul>
                  <li>
                    <a href="/docs/api">記述API一覧</a>
                    <p>公開APIの役割と呼び出し形式</p>
                  </li>
                  <li>
                    <a href="/docs/hono-routing">Honoとpage.tsxのファイル経路</a>
                    <p>要求単位SSRとファイル経路</p>
                  </li>
                </ul>
              </section>
              <section class="doc-group">
                <h2>診断と対応範囲</h2>
                <ul>
                  <li>
                    <a href="/docs/diagnostics">診断と対応範囲</a>
                    <p>scope limitと現在の境界</p>
                  </li>
                </ul>
              </section>
            </div>
            <aside class="docs-examples">
              <h2>公式例</h2>
              <ul>
                <li>
                  <a href="/playground?example=counter">
                    <strong>Counter</strong>
                    <span>状態更新</span>
                  </a>
                </li>
                <li>
                  <a href="/playground?example=list">
                    <strong>List</strong>
                    <span>キー付き一覧</span>
                  </a>
                </li>
                <li>
                  <a href="/playground?example=svg">
                    <strong>SVG</strong>
                    <span>SVG要素と属性</span>
                  </a>
                </li>
              </ul>
            </aside>
          </div>
        </section>
      </main>
      <footer class="site-footer">
        <a href="/">irisout</a>
        <span>irisout@0.2.2</span>
      </footer>
    </div>,
  )
}
