// 公式ホームページの構造と、検索パレット・コピー操作の状態を宣言する。
// 記述の実行はirisoutが生成した初期HTMLと直接DOM更新の範囲に限る。
import { derived, effect, onMount, render, signal } from 'irisout'

export function App() {
  const menuOpen = signal(false)
  const copyState = signal('ready')
  const paletteOpen = signal(false)
  const paletteIndex = signal(0)
  const paletteQuery = signal('')
  const showHow = derived(
    () =>
      !paletteQuery().trim() ||
      paletteQuery().trim().toLowerCase().includes('仕組み') ||
      paletteQuery().trim().toLowerCase().includes('how') ||
      paletteQuery().trim().toLowerCase().includes('compile'),
  )
  const showPlayground = derived(
    () =>
      !paletteQuery().trim() ||
      paletteQuery().trim().toLowerCase().includes('試す') ||
      paletteQuery().trim().toLowerCase().includes('playground') ||
      paletteQuery().trim().toLowerCase().includes('demo'),
  )
  const showPrinciples = derived(
    () =>
      !paletteQuery().trim() ||
      paletteQuery().trim().toLowerCase().includes('設計') ||
      paletteQuery().trim().toLowerCase().includes('principle') ||
      paletteQuery().trim().toLowerCase().includes('architecture'),
  )
  const showGithub = derived(
    () =>
      !paletteQuery().trim() ||
      paletteQuery().trim().toLowerCase().includes('github') ||
      paletteQuery().trim().toLowerCase().includes('source') ||
      paletteQuery().trim().toLowerCase().includes('code'),
  )
  const paletteHasMatch = derived(
    () => showHow() || showPlayground() || showPrinciples() || showGithub(),
  )

  render(
    <div class="site-shell">
      <header class="site-header" id="top">
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
          <a class="nav-link" href="#how">
            仕組み
          </a>
          <a class="nav-link" href="/examples">
            実例
          </a>
          <a class="nav-link" href="#principles">
            設計
          </a>
          <a class="nav-link" href="https://github.com/mikan-919/irisout">
            GitHub ↗
          </a>
        </nav>

        <div class="header-actions">
          <button
            class="command-trigger"
            type="button"
            aria-label="検索と移動を開く"
            aria-controls="command-palette"
            aria-expanded={paletteOpen()}
            onClick={openPalette}
          >
            <span class="search-glyph" aria-hidden="true">
              ⌕
            </span>
            <span class="command-placeholder">検索</span>
            <kbd>⌘ K</kbd>
          </button>
          <a class="header-cta" href="/playground">
            試す <span>↗</span>
          </a>
        </div>
        <button
          class="menu-toggle"
          type="button"
          aria-label={menuOpen() ? 'メニューを閉じる' : 'メニューを開く'}
          aria-expanded={menuOpen()}
          onClick={() => menuOpen(!menuOpen())}
        >
          <span class="menu-icon" aria-hidden="true">
            {menuOpen() ? '×' : '☰'}
          </span>
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
          <a href="/examples" onClick={() => menuOpen(false)}>
            実例
          </a>
          <a href="#principles" onClick={() => menuOpen(false)}>
            設計
          </a>
          <a href="https://github.com/mikan-919/irisout" onClick={() => menuOpen(false)}>
            GitHub ↗
          </a>
        </nav>
      )}

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
                <a class="button button-primary" href="/playground">
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
                <span>入力 / src/App.jsx</span>
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
                <button
                  type="button"
                  class="copy-button"
                  data-state={copyState()}
                  disabled={copyState() === 'loading'}
                  aria-label="導入コマンドをコピー"
                  onClick={copyInstall}
                >
                  {copyState() === 'loading'
                    ? 'コピー中'
                    : copyState() === 'success'
                      ? 'コピー済み'
                      : copyState() === 'error'
                        ? '再試行'
                        : 'コピー'}
                </button>
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

      <dialog
        id="command-palette"
        class="command-palette"
        aria-labelledby="palette-title"
        onClose={closePalette}
        onCancel={closePalette}
      >
        <form method="dialog" class="palette-backdrop">
          <button type="submit" aria-label="検索パレットを閉じる" />
        </form>
        <div class="palette-panel" onClick={stopPaletteClick}>
          <div class="palette-head">
            <label id="palette-title" for="palette-input">
              移動先を検索
            </label>
            <kbd>esc</kbd>
          </div>
          <input
            id="palette-input"
            class="palette-input"
            type="search"
            value={paletteQuery()}
            placeholder="仕組み、試す、設計…"
            autocomplete="off"
            onInput={handlePaletteInput}
          />
          <div class="palette-results" role="listbox" aria-label="移動先">
            <p class="palette-group">ページ</p>
            {showHow() && (
              <a
                class="palette-item"
                role="option"
                aria-selected={paletteIndex() === 0}
                data-palette-index="0"
                href="#how"
                onClick={closePalette}
              >
                <span>仕組み</span>
                <small>#how</small>
              </a>
            )}
            {showPlayground() && (
              <a
                class="palette-item"
                role="option"
                aria-selected={paletteIndex() === 1}
                data-palette-index="1"
                href="/playground"
                onClick={closePalette}
              >
                <span>試す</span>
                <small>/playground</small>
              </a>
            )}
            {showPrinciples() && (
              <a
                class="palette-item"
                role="option"
                aria-selected={paletteIndex() === 2}
                data-palette-index="2"
                href="#principles"
                onClick={closePalette}
              >
                <span>設計</span>
                <small>#principles</small>
              </a>
            )}
            {showGithub() && (
              <a
                class="palette-item"
                role="option"
                aria-selected={paletteIndex() === 3}
                data-palette-index="3"
                href="https://github.com/mikan-919/irisout"
                onClick={closePalette}
              >
                <span>GitHub</span>
                <small>source ↗</small>
              </a>
            )}
            {!paletteHasMatch() && <p class="palette-empty">一致する移動先がありません。</p>}
          </div>
          <div class="palette-foot">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> 移動
            </span>
            <span>
              <kbd>↵</kbd> 開く
            </span>
            <span>
              <kbd>esc</kbd> 閉じる
            </span>
          </div>
        </div>
      </dialog>

      <footer class="site-footer">
        <div class="content-shell footer-inner">
          <p class="footer-statement">画面に必要な仕事だけを、届ける。</p>
          <div class="footer-meta">
            <a class="footer-brand" href="#top">
              <span class="brand-name">irisout</span>
            </a>
            <div class="footer-links">
              <a href="#how">仕組み</a>
              <a href="/playground">試す</a>
              <a href="/examples">実例</a>
              <a href="https://github.com/mikan-919/irisout">GitHub ↗</a>
            </div>
            <span class="footer-copy">Apache License 2.0 · 2026</span>
          </div>
        </div>
      </footer>
    </div>,
  )

  function copyInstall() {
    const commands =
      'bun add irisout@0.2.2 vite-plus@0.3.0\nbun add --dev typescript@5.9\nbun run dev'
    if (navigator.clipboard) {
      copyState('loading')
      void navigator.clipboard.writeText(commands).then(
        () => copyState('success'),
        () => copyState('error'),
      )
    } else {
      copyState('error')
    }
  }

  function openPalette() {
    paletteQuery('')
    paletteIndex(0)
    paletteOpen(true)
  }

  function closePalette() {
    paletteOpen(false)
  }

  function handlePaletteInput(event) {
    const value = event.currentTarget.value
    const query = value.trim().toLowerCase()
    paletteQuery(value)
    if (!query || query.includes('仕組み') || query.includes('how') || query.includes('compile')) {
      paletteIndex(0)
    } else if (query.includes('試す') || query.includes('playground') || query.includes('demo')) {
      paletteIndex(1)
    } else if (
      query.includes('設計') ||
      query.includes('principle') ||
      query.includes('architecture')
    ) {
      paletteIndex(2)
    } else if (query.includes('github') || query.includes('source') || query.includes('code')) {
      paletteIndex(3)
    } else {
      paletteIndex(0)
    }
  }

  function stopPaletteClick(event) {
    event.stopPropagation()
  }

  effect(() => {
    const dialog = /** @type {HTMLDialogElement | null} */ (
      document.getElementById('command-palette')
    )
    if (!dialog) return
    if (paletteOpen()) {
      if (!dialog.open) dialog.showModal()
      const input = /** @type {HTMLInputElement | null} */ (dialog.querySelector('input'))
      if (input) input.focus()
    } else if (dialog.open) {
      dialog.close()
    }
  })

  onMount(() => {
    const handleGlobalKeydown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (paletteOpen()) {
          paletteOpen(false)
        } else {
          paletteQuery('')
          paletteIndex(0)
          paletteOpen(true)
        }
      } else if (paletteOpen()) {
        if (event.key === 'Escape') {
          paletteOpen(false)
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const items = Array.from(document.querySelectorAll('.palette-item'))
          if (items.length > 0) {
            const current = items.findIndex(
              (item) => item.getAttribute('data-palette-index') === String(paletteIndex()),
            )
            const offset = event.key === 'ArrowDown' ? 1 : -1
            const next = items[(current + offset + items.length) % items.length]
            if (next) paletteIndex(Number(next.getAttribute('data-palette-index')))
          }
        } else if (event.key === 'Enter') {
          event.preventDefault()
          const item = document.querySelector('[data-palette-index="' + paletteIndex() + '"]')
          if (item) item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        }
      }
    }

    document.addEventListener('keydown', handleGlobalKeydown)
    return () => document.removeEventListener('keydown', handleGlobalKeydown)
  })
}
