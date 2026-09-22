// 参照デザインの余白、線、明暗だけでirisoutの変換過程を見せる。
import { render, signal } from 'irisout'
import { SiteHeader } from '../src/SiteHeader.jsx'

export default function Page() {
  const count = signal(0)

  render(
    <div class="line-site" id="top">
      <SiteHeader current="home" search={false} onSearch={null} />
      <main>
        <section class="line-hero" aria-labelledby="hero-title">
          <h1 id="hero-title">状態更新を、DOM更新コードへコンパイルする。</h1>
        </section>
        <section class="line-demo" aria-label="irisoutのコンパイル例">
          <div class="line-code">
            <p>counter.tsx</p>
            <pre>
              <code>{`const count = signal(0)

export function Counter() {
  render(<button onClick={() => {
    count(count() + 1)
  }}>
    {count()}
  </button>)
}`}</code>
            </pre>
          </div>
          <div class="line-output">
            <p>browser</p>
            <div class="line-counter">
              <button type="button" aria-label="1減らす" onClick={() => count(count() - 1)}>
                −
              </button>
              <strong>{count()}</strong>
              <button type="button" aria-label="1増やす" onClick={() => count(count() + 1)}>
                ＋
              </button>
            </div>
            <small>updated: text.data = {count()}</small>
          </div>
        </section>
        <section class="line-notes" id="how" aria-label="irisoutの設計">
          <p>状態と表示の依存関係を解析し、必要な更新だけを残す。</p>
          <p>初期HTMLはサーバーで生成し、ブラウザーはその続きを担当する。</p>
          <p>仮想DOMを持たず、変化する場所へ直接つなぐ。</p>
          <p>静的に決められない処理は、明示した境界へ逃がす。</p>
          <p>記述はJSXのまま、出力は小さなDOM操作になる。</p>
          <p>仕組み、実行時処理、制約を文書として公開する。</p>
        </section>
      </main>
      <footer class="site-footer line-footer">
        <a href="#top">
          irisout <small>0.2.2</small>
        </a>
        <nav aria-label="フッター">
          <a href="/docs">ドキュメント</a>
          <a href="/examples">実例</a>
          <a href="/playground" data-irisout-document>
            Playground
          </a>
          <a href="https://github.com/mikan-919/irisout">GitHub</a>
        </nav>
        <span>Apache-2.0</span>
      </footer>
    </div>,
  )
}
