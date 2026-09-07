export function App() {
  const count = signal(0)
  const selectedExample = signal('counter')
  const menuOpen = signal(false)
  const copied = signal(false)
  const countLabel = derived(() => `${count()} clicks`)

  render(
    <div class="site-shell">
      <header class="site-header">
        <a class="brand" href="#top" aria-label="irisout ホーム">
          <svg class="brand-mark" viewBox="0 0 44 44" aria-hidden="true">
            <circle cx="22" cy="22" r="19" fill="none" />
            <path d="M22 3c6 7 8 13 7 19-1 7-6 13-15 18" />
            <path d="M41 22c-7 6-13 8-19 7-7-1-13-6-18-15" />
            <path d="M22 41c-6-7-8-13-7-19 1-7 6-13 15-18" />
            <path d="M3 22c7-6 13-8 19-7 7 1 13 6 18 15" />
          </svg>
          <span class="brand-name">irisout</span>
        </a>

        <nav class="desktop-nav" aria-label="主な項目">
          <a href="#how">仕組み</a>
          <a href="#playground">試す</a>
          <a href="#principles">設計</a>
          <a href="https://github.com/mikan-919/irisout">GitHub ↗</a>
        </nav>

        <a class="header-cta" href="#install">
          導入する <span>→</span>
        </a>
        <button
          class="menu-toggle"
          type="button"
          aria-label="メニューを開く"
          aria-expanded={menuOpen()}
          onClick={() => menuOpen(!menuOpen())}
        >
          <span />
          <span />
        </button>
      </header>

      {menuOpen() && (
        <nav class="mobile-nav" aria-label="モバイルメニュー">
          <a href="#how" onClick={() => menuOpen(false)}>
            仕組み
          </a>
          <a href="#playground" onClick={() => menuOpen(false)}>
            試す
          </a>
          <a href="#principles" onClick={() => menuOpen(false)}>
            設計
          </a>
          <a href="#install" onClick={() => menuOpen(false)}>
            導入する
          </a>
        </nav>
      )}

      <main>
        <section class="hero" id="top">
          <div class="hero-copy">
            <p class="eyebrow">
              <span class="eyebrow-dot" /> UI compiler for the real DOM
            </p>
            <h1>
              JSXから、<em>必要な更新だけ</em>を生成する。
            </h1>
            <p class="hero-lede">
              irisoutは、JSXの記述を静的HTMLと状態ごとのDOM更新コードへ変換するUIコンパイラです。
              仮想DOMを使わず、ブラウザへ送る処理を画面に必要な範囲へ絞ります。
            </p>
            <div class="hero-actions">
              <a class="button button-primary" href="#playground">
                動きを試す <span>↗</span>
              </a>
              <a class="button button-quiet" href="#how">
                仕組みを見る <span>↓</span>
              </a>
            </div>
            <div class="hero-note">
              <span class="status-pulse" />
              <span>静的HTML + 直接DOM更新</span>
              <span class="note-separator">·</span>
              <span>仮想DOMなし</span>
            </div>
          </div>

          <div class="hero-visual" aria-label="irisoutの生成処理">
            <div class="visual-glow" />
            <div class="code-window hero-code">
              <div class="window-bar">
                <span class="window-dots">
                  <i />
                  <i />
                  <i />
                </span>
                <span class="window-file">src/App.jsx</span>
                <span class="window-chip">build</span>
              </div>
              <pre>
                <code>
                  {
                    '01  const count = signal(0)\n02  const doubled = derived(() => count() * 2)\n03\n04  render(\n05    button onClick={increment}\n06      count()\n07    /button\n08  )'
                  }
                </code>
              </pre>
              <div class="code-output">
                <span class="output-arrow">→</span>
                <span>
                  <strong>初期HTML</strong> + <strong>更新関数</strong>
                </span>
                <span class="output-check">✓</span>
              </div>
            </div>
            <div class="orbit orbit-one" />
            <div class="orbit orbit-two" />
            <span class="visual-label label-top">compile</span>
            <span class="visual-label label-bottom">ship less · do more</span>
          </div>
        </section>

        <section class="signal-strip" aria-label="irisoutの特徴">
          <div>
            <span class="strip-number">01</span>
            <strong>静的な初期表示</strong>
            <small>build時にHTMLを生成</small>
          </div>
          <div>
            <span class="strip-number">02</span>
            <strong>依存先だけを更新</strong>
            <small>状態からDOMまでを接続</small>
          </div>
          <div>
            <span class="strip-number">03</span>
            <strong>実DOMをそのまま操作</strong>
            <small>仮想DOMの差分処理なし</small>
          </div>
        </section>

        <section class="section pipeline-section" id="how">
          <div class="section-heading">
            <p class="eyebrow">
              <span class="eyebrow-dot" /> How it works
            </p>
            <h2>
              書くのはJSX。
              <br />
              <em>届くのは必要なコード。</em>
            </h2>
            <p>
              コンパイラがコンポーネント、状態、依存関係をビルド時に解析します。ブラウザで実行するのは、その画面に必要な処理だけです。
            </p>
          </div>

          <div class="pipeline-grid">
            <article class="pipeline-card">
              <span class="card-index">01</span>
              <div class="card-icon icon-source">JSX</div>
              <h3>Author</h3>
              <p>慣れたJSXで、状態と画面をひとつの流れとして記述します。</p>
              <code>signal → render</code>
            </article>
            <div class="pipeline-link">→</div>
            <article class="pipeline-card card-highlight">
              <span class="card-index">02</span>
              <div class="card-icon icon-compile">✦</div>
              <h3>Compile</h3>
              <p>依存関係と更新先を決め、静的HTMLと更新関数を生成します。</p>
              <code>analyze → generate</code>
            </article>
            <div class="pipeline-link">→</div>
            <article class="pipeline-card">
              <span class="card-index">03</span>
              <div class="card-icon icon-ship">◌</div>
              <h3>Ship</h3>
              <p>ブラウザでは初期HTMLを引き継ぎ、変化したDOMだけを書き換えます。</p>
              <code>HTML + DOM update</code>
            </article>
          </div>
        </section>

        <section class="section playground-section" id="playground">
          <div class="playground-intro">
            <p class="eyebrow">
              <span class="eyebrow-dot" /> Try it live
            </p>
            <h2>
              状態が変わる。
              <br />
              <em>更新先は、変わった場所だけ。</em>
            </h2>
            <p>同じJSXから生成された小さな例を触って、irisoutの更新モデルを確認できます。</p>
            <div class="playground-list">
              <div class="playground-list-item">
                <span>↳</span>
                <span>状態を読む式を解析</span>
              </div>
              <div class="playground-list-item">
                <span>↳</span>
                <span>依存するDOMを特定</span>
              </div>
              <div class="playground-list-item">
                <span>↳</span>
                <span>イベントから直接更新</span>
              </div>
            </div>
          </div>

          <div class="demo-card">
            <div class="demo-topbar">
              <span class="demo-title">
                <span class="demo-live" /> playground
              </span>
              <span class="demo-meta">generated output</span>
            </div>
            <div class="demo-tabs" role="tablist" aria-label="デモの切り替え">
              <button
                type="button"
                class={selectedExample() === 'counter' ? 'demo-tab active' : 'demo-tab'}
                onClick={() => selectedExample('counter')}
              >
                Counter
              </button>
              <button
                type="button"
                class={selectedExample() === 'list' ? 'demo-tab active' : 'demo-tab'}
                onClick={() => selectedExample('list')}
              >
                List
              </button>
              <button
                type="button"
                class={selectedExample() === 'svg' ? 'demo-tab active' : 'demo-tab'}
                onClick={() => selectedExample('svg')}
              >
                SVG
              </button>
            </div>

            {selectedExample() === 'counter' && (
              <div class="demo-content counter-demo">
                <p class="demo-kicker">signal state</p>
                <div class="counter-value">{count()}</div>
                <p class="counter-caption">
                  {countLabel()} · derived value {count() * 2}
                </p>
                <button class="demo-action" type="button" onClick={() => count(count() + 1)}>
                  increment <span>+</span>
                </button>
                <p class="demo-footnote">クリックすると、依存する値だけが更新されます。</p>
              </div>
            )}

            {selectedExample() === 'list' && (
              <div class="demo-content list-demo">
                <p class="demo-kicker">keyed list</p>
                <div class="list-preview">
                  <div>
                    <span class="list-key">01</span>
                    <span>static HTML</span>
                    <span class="list-status">kept</span>
                  </div>
                  <div>
                    <span class="list-key">02</span>
                    <span>keyed reuse</span>
                    <span class="list-status">reused</span>
                  </div>
                  <div>
                    <span class="list-key">03</span>
                    <span>direct update</span>
                    <span class="list-status">ready</span>
                  </div>
                </div>
                <p class="demo-footnote">同じkeyの要素は再利用し、変化したitemだけを更新します。</p>
              </div>
            )}

            {selectedExample() === 'svg' && (
              <div class="demo-content svg-demo">
                <p class="demo-kicker">SVG authoring</p>
                <svg
                  class="demo-spark"
                  viewBox="0 0 260 92"
                  role="img"
                  aria-label="更新される折れ線グラフ"
                >
                  <path d="M4 74C32 66 38 38 65 48s30 28 52 8 31-38 53-26 33 34 82-20" />
                  <circle cx="65" cy="48" r="4" />
                  <circle cx="117" cy="56" r="4" />
                  <circle cx="170" cy="30" r="4" />
                </svg>
                <p class="demo-footnote">SVGも同じ更新モデルで、属性と要素を直接扱えます。</p>
              </div>
            )}
            <div class="demo-status">
              <span>●</span> no virtual DOM involved
            </div>
          </div>
        </section>

        <section class="section principles-section" id="principles">
          <div class="section-heading compact-heading">
            <p class="eyebrow">
              <span class="eyebrow-dot" /> Built on constraints
            </p>
            <h2>
              機能を足す前に、
              <br />
              <em>実行時の境界を決める。</em>
            </h2>
          </div>
          <div class="principles-grid">
            <article class="principle-card">
              <span>01</span>
              <h3>静的に決める</h3>
              <p>依存関係と更新先をビルド時に決め、実行時の探索を減らします。</p>
            </article>
            <article class="principle-card">
              <span>02</span>
              <h3>意味を保つ</h3>
              <p>イベントのcurrentTarget、key付き再利用、破棄処理をブラウザの動作に合わせます。</p>
            </article>
            <article class="principle-card">
              <span>03</span>
              <h3>測って選ぶ</h3>
              <p>生成物のサイズ、初期化、更新、メモリを同じ条件で比較します。</p>
            </article>
          </div>
        </section>

        <section class="install-section" id="install">
          <div class="install-copy">
            <p class="eyebrow">
              <span class="eyebrow-dot" /> Start from a tarball
            </p>
            <h2>まずは、手元のアプリへ。</h2>
            <p>現在はnpmへ登録していません。ビルドしたtarballをVite+アプリへ導入して試せます。</p>
            <a class="button button-light" href="https://github.com/mikan-919/irisout">
              GitHubで導入手順を見る <span>↗</span>
            </a>
          </div>
          <div class="install-code code-window">
            <div class="window-bar">
              <span class="window-dots">
                <i />
                <i />
                <i />
              </span>
              <span class="window-file">terminal</span>
              <button type="button" class="copy-button" onClick={copyInstall}>
                {copied() ? 'copied' : 'copy'}
              </button>
            </div>
            <pre>
              <code class="terminal-lines">
                <span>
                  <span class="code-prompt">$</span> bun run build:packages
                </span>
                <span>
                  <span class="code-prompt">$</span> bun pm pack --cwd packages/runtime
                </span>
                <span>
                  <span class="code-prompt">$</span> bun pm pack --cwd packages/compiler
                </span>
                <span>
                  <span class="code-prompt">$</span> bun pm pack --cwd packages/vite-plugin
                </span>
                <span>
                  <span class="code-prompt">$</span> bun install &amp;&amp; bun run dev
                </span>
              </code>
            </pre>
            <div class="install-result">
              <span>✓</span> package bundles ready
            </div>
          </div>
        </section>
      </main>

      <footer class="site-footer">
        <a class="brand footer-brand" href="#top">
          <span class="brand-name">irisout</span>
          <span class="footer-tagline">compile the interface</span>
        </a>
        <div class="footer-links">
          <a href="#how">仕組み</a>
          <a href="#playground">試す</a>
          <a href="https://github.com/mikan-919/irisout">GitHub ↗</a>
        </div>
        <span class="footer-copy">Apache License 2.0 · 2026</span>
      </footer>
    </div>,
  )

  function copyInstall() {
    const commands =
      'bun run build:packages\nbun pm pack --cwd packages/runtime\nbun pm pack --cwd packages/compiler\nbun pm pack --cwd packages/vite-plugin\nbun install && bun run dev'
    if (navigator.clipboard) void navigator.clipboard.writeText(commands)
    copied(true)
  }
}
