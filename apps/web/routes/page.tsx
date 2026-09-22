// 公式ホームページをファイル経路の要求単位SSRと静的生成の両方へ渡す。
import { render } from 'irisout'
import { SiteHeader } from '../src/SiteHeader.jsx'

export default function Page() {
  render(
    <div class="site-shell" id="top">
      <SiteHeader current="home" search={false} onSearch={null} />
      <main>
        <section class="hero" aria-labelledby="hero-title">
          <div class="content-shell hero-grid">
            <div class="hero-copy" data-reveal>
              <p class="eyebrow">
                <span class="eyebrow-mark" /> UI COMPILER / REAL DOM
              </p>
              <h1 id="hero-title">
                必要な更新だけ、<span class="accent-text">ブラウザへ。</span>
              </h1>
              <p class="hero-lede">
                irisoutは、JSXから静的HTMLと状態ごとのDOM更新コードを生成するUIコンパイラです。仮想DOMを経由せず、画面に必要な仕事だけを残します。
              </p>
              <div class="hero-actions">
                <a class="button button-primary" href="/playground" data-irisout-document>
                  動きを試す <span>↗</span>
                </a>
                <a class="button button-quiet" href="#how">
                  仕組みを見る <span>↓</span>
                </a>
              </div>
              <ul class="hero-meta" aria-label="irisoutの特徴">
                <li>静的HTML</li>
                <li>直接DOM更新</li>
                <li>仮想DOMなし</li>
              </ul>
            </div>

            <figure class="code-proof" data-reveal>
              <figcaption class="code-proof-caption">
                <span>入力 / routes/page.tsx</span>
                <span class="code-status">BUILD READY</span>
              </figcaption>
              <pre>
                <code>
                  {
                    "import { render, signal } from 'irisout'\n\nexport function Counter() {\n  const count = signal(0)\n\n  function increment() {\n    count(count() + 1)\n  }\n\n  render(<button onClick={increment}>{count()}</button>)\n}"
                  }
                </code>
              </pre>
              <div class="code-result">
                <span class="code-result-label">出力</span>
                <strong>静的HTML</strong>
                <span class="result-arrow">→</span>
                <strong>updateCount()</strong>
              </div>
            </figure>
          </div>
        </section>

        <section class="signal-rail" aria-label="irisoutの特徴">
          <div class="content-shell signal-grid">
            <div>
              <span>01</span>
              <strong>初期HTML</strong>
              <small>ビルド時に生成</small>
            </div>
            <div>
              <span>02</span>
              <strong>依存先だけ</strong>
              <small>状態からDOMへ接続</small>
            </div>
            <div>
              <span>03</span>
              <strong>実DOM</strong>
              <small>変化した場所を更新</small>
            </div>
          </div>
        </section>

        <section class="section workflow-section" id="how" aria-labelledby="workflow-title">
          <div class="content-shell">
            <div class="section-heading" data-reveal>
              <h2 id="workflow-title">コンパイルを、流れとして見る。</h2>
              <p>
                コンポーネント、状態、依存関係をビルド時に解析し、ブラウザへ渡す仕事を順番に絞ります。
              </p>
            </div>

            <ol class="workflow-list">
              <li class="workflow-step" data-reveal>
                <span class="step-number">1.0</span>
                <div class="step-copy">
                  <h3>
                    書く <span>AUTHOR</span>
                  </h3>
                  <p>慣れたJSXで、状態と画面をひとつの流れとして記述します。</p>
                </div>
                <code>signal → render</code>
              </li>
              <li class="workflow-step" data-reveal>
                <span class="step-number">2.0</span>
                <div class="step-copy">
                  <h3>
                    決める <span>COMPILE</span>
                  </h3>
                  <p>依存関係と更新先を静的に確定し、初期HTMLと更新関数へ変換します。</p>
                </div>
                <code>analyze → generate</code>
              </li>
              <li class="workflow-step" data-reveal>
                <span class="step-number">3.0</span>
                <div class="step-copy">
                  <h3>
                    届ける <span>SHIP</span>
                  </h3>
                  <p>ブラウザでは初期HTMLを引き継ぎ、変化したDOMだけを書き換えます。</p>
                </div>
                <code>HTML + DOM update</code>
              </li>
            </ol>
          </div>
        </section>

        <section class="principles-band" id="principles" aria-labelledby="principles-title">
          <div class="content-shell">
            <div class="dark-heading" data-reveal>
              <p class="dark-kicker">DESIGN CONSTRAINTS</p>
              <h2 id="principles-title">機能を足す前に、境界を決める。</h2>
            </div>
            <div class="principle-list">
              <article class="principle-row" data-reveal>
                <span>01</span>
                <h3>静的に決める</h3>
                <p>依存関係と更新先をビルド時に決め、実行時の探索を減らします。</p>
              </article>
              <article class="principle-row" data-reveal>
                <span>02</span>
                <h3>意味を保つ</h3>
                <p>
                  イベントのcurrentTarget、key付き再利用、破棄処理をブラウザの動作に合わせます。
                </p>
              </article>
              <article class="principle-row" data-reveal>
                <span>03</span>
                <h3>測って選ぶ</h3>
                <p>生成物のサイズ、初期化、更新、メモリを同じ条件で比較します。</p>
              </article>
            </div>
          </div>
        </section>

        <section class="section install-section" id="install" aria-labelledby="install-title">
          <div class="content-shell install-layout">
            <div class="install-copy" data-reveal>
              <h2 id="install-title">手元のアプリで試す。</h2>
              <p>公開版を導入して、Vite+アプリで動きを確認できます。</p>
              <a class="button button-primary" href="https://github.com/mikan-919/irisout">
                導入手順を見る <span>↗</span>
              </a>
            </div>
            <figure class="install-code" data-reveal>
              <figcaption class="code-proof-caption">
                <span>QUICKSTART / terminal</span>
              </figcaption>
              <pre>
                <code>
                  {
                    '$ bun add irisout@0.2.2 vite-plus@0.3.0\n$ bun add --dev typescript@5.9\n$ bun run dev'
                  }
                </code>
              </pre>
              <div class="install-result">
                <span>✓</span> irisout@0.2.2 ready
              </div>
            </figure>
          </div>
        </section>
      </main>

      <footer class="site-footer">
        <div class="content-shell footer-inner">
          <p class="footer-statement">画面に必要な仕事だけを、届ける。</p>
          <div class="footer-meta">
            <a class="footer-brand" href="#top">
              <span class="brand-name">irisout</span>
            </a>
            <div class="footer-links">
              <a href="#how">仕組み</a>
              <a href="/playground" data-irisout-document>
                試す
              </a>
              <a href="/examples">実例</a>
              <a href="https://github.com/mikan-919/irisout">GitHub ↗</a>
            </div>
            <span class="footer-copy">Apache License 2.0 · 2026</span>
          </div>
        </div>
      </footer>
    </div>,
  )
}
