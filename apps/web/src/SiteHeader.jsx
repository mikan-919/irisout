// 公式サイトの全Irisout画面で共有するヘッダー。現在地と検索操作だけを受け取る。
import { render } from 'irisout'

const GITHUB_URL = 'https://github.com/mikan-919/irisout'

export function SiteHeader({ current, search, onSearch }) {
  render(
    <header class="site-header" id="siteHeader">
      <a class="site-brand" href="/" aria-label="irisout ホーム">
        <span>irisout</span>
        <small>0.3.0</small>
      </a>
      <nav aria-label="主な項目">
        <a href="/" aria-current={current === 'home' ? 'page' : null}>
          ホーム
        </a>
        <a href="/docs" aria-current={current === 'docs' ? 'page' : null}>
          仕組み
        </a>
        <a href="/examples" aria-current={current === 'examples' ? 'page' : null}>
          実例
        </a>
        <a
          href="/playground"
          data-irisout-document
          aria-current={current === 'playground' ? 'page' : null}
        >
          実行
        </a>
        <a href={GITHUB_URL}>GitHub</a>
      </nav>
      <div class="site-actions">
        {search && (
          <button
            class="site-search"
            type="button"
            aria-label="検索と移動を開く"
            aria-haspopup="dialog"
            onClick={() => onSearch()}
          >
            ⌕ <span>検索</span>
            <kbd>⌘ K</kbd>
          </button>
        )}
        <a class="site-cta" href="/docs">
          制約
        </a>
        <details>
          <summary aria-label="メニューを開く">☰</summary>
          <div class="site-mobile-nav">
            <a href="/" aria-current={current === 'home' ? 'page' : null}>
              ホーム
            </a>
            <a href="/docs" aria-current={current === 'docs' ? 'page' : null}>
              ドキュメント
            </a>
            <a href="/examples" aria-current={current === 'examples' ? 'page' : null}>
              実例
            </a>
            <a
              href="/playground"
              data-irisout-document
              aria-current={current === 'playground' ? 'page' : null}
            >
              Playground
            </a>
            <a href={GITHUB_URL}>GitHub ↗</a>
          </div>
        </details>
      </div>
    </header>,
  )
}
