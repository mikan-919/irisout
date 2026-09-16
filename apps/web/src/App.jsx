import { render, signal } from 'irisout'

export function App() {
  const menuOpen = signal(false)
  const copied = signal(false)

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
          <a href="/playground">試す</a>
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
          <a href="/playground" onClick={() => menuOpen(false)}>
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
              <a class="button button-primary" href="/playground">
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
                    "01  import { signal, derived, render } from 'irisout'\n02  const count = signal(0)\n03  const doubled = derived(() => count() * 2)\n04\n05  render(\n06    button onClick={increment}\n07      count()\n08    /button\n09  )"
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
              <span class="eyebrow-dot" /> Start from npm
            </p>
            <h2>まずは、手元のアプリへ。</h2>
            <p>npm公開版を導入して、Vite+アプリで試せます。</p>
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
                  <span class="code-prompt">$</span> bun add irisout@0.2.2 vite-plus@0.3.0
                </span>
                <span>
                  <span class="code-prompt">$</span> bun add --dev typescript@5.9
                </span>
                <span>
                  <span class="code-prompt">$</span> bun run dev
                </span>
              </code>
            </pre>
            <div class="install-result">
              <span>✓</span> irisout@0.2.2 ready
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
          <a href="/playground">試す</a>
          <a href="https://github.com/mikan-919/irisout">GitHub ↗</a>
        </div>
        <span class="footer-copy">Apache License 2.0 · 2026</span>
      </footer>
    </div>,
  )

  function copyInstall() {
    const commands =
      'bun add irisout@0.2.2 vite-plus@0.3.0\nbun add --dev typescript@5.9\nbun run dev'
    if (navigator.clipboard) void navigator.clipboard.writeText(commands)
    copied(true)
  }
}
