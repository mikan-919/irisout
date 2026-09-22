// 公式サイトの全Irisout画面で共有するヘッダー。現在地と検索操作だけを受け取る。
import { render } from 'irisout'

const GITHUB_URL = 'https://github.com/mikan-919/irisout'

export function SiteHeader({ current, search, onSearch }) {
  render(
    <header class="site-header">
      <a class="site-brand" href="/" aria-label="irisout ホーム">
        <svg viewBox="0 0 44 44" aria-hidden="true">
          <circle cx="22" cy="22" r="19" />
          <path d="M22 3c6 7 8 13 7 19-1 7-6 13-15 18" />
          <path d="M41 22c-7 6-13 8-19 7-7-1-13-6-18-15" />
          <path d="M22 41c-6-7-8-13-7-19 1-7 6-13 15-18" />
          <path d="M3 22c7-6 13-8 19-7 7 1 13 6 18 15" />
        </svg>
        <span>irisout</span>
      </a>
      <nav aria-label="主な項目">
        <a href="/" aria-current={current === 'home' ? 'page' : null}>
          ホーム
        </a>
        <a href="/docs" aria-current={current === 'docs' ? 'page' : null}>
          文書
        </a>
        <a href="/examples" aria-current={current === 'examples' ? 'page' : null}>
          実例
        </a>
        <a href="/playground" aria-current={current === 'playground' ? 'page' : null}>
          Playground
        </a>
        <a href={GITHUB_URL}>GitHub ↗</a>
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
        <a class="site-cta" href="/playground">
          試す <span aria-hidden="true">↗</span>
        </a>
        <details>
          <summary aria-label="メニューを開く">☰</summary>
          <div class="site-mobile-nav">
            <a href="/" aria-current={current === 'home' ? 'page' : null}>
              ホーム
            </a>
            <a href="/docs" aria-current={current === 'docs' ? 'page' : null}>
              文書
            </a>
            <a href="/examples" aria-current={current === 'examples' ? 'page' : null}>
              実例
            </a>
            <a href="/playground" aria-current={current === 'playground' ? 'page' : null}>
              Playground
            </a>
            <a href={GITHUB_URL}>GitHub ↗</a>
          </div>
        </details>
      </div>
    </header>,
  )
}
