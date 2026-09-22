// 静的な文書本文へ共通ヘッダー、見出し、前後リンクを付ける。
import { render } from 'irisout'
import { DocsSidebar } from './DocsSidebar.jsx'
import { SiteHeader } from './SiteHeader.jsx'

export function DocsPage({
  section,
  title,
  description,
  previousHref,
  previousTitle,
  nextHref,
  nextTitle,
  children,
}) {
  render(
    <div id="top">
      <SiteHeader current="docs" search={false} onSearch={null} />
      <main class="docs-page docs-shell docs-detail">
        <DocsSidebar />
        <article>
          <p class="eyebrow">{section}</p>
          <h1>{title}</h1>
          <p class="doc-description">{description}</p>
          <div class="doc-body">{children}</div>
          <nav class="doc-pager" aria-label="ドキュメント間の移動">
            {previousHref ? (
              <a href={previousHref}>
                <span>前のドキュメント</span>
                <strong>{previousTitle}</strong>
              </a>
            ) : (
              <span />
            )}
            {nextHref ? (
              <a class="doc-pager-next" href={nextHref}>
                <span>次のドキュメント</span>
                <strong>{nextTitle}</strong>
              </a>
            ) : (
              <span />
            )}
          </nav>
        </article>
      </main>
      <footer class="site-footer">
        <a href="/">irisout</a>
        <span>irisout@0.2.2</span>
      </footer>
    </div>,
  )
}
