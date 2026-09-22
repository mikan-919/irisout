// 文書の全ページで共有する章一覧。
import { render } from 'irisout'

export function DocsSidebar() {
  render(
    <aside class="docs-sidebar">
      <a class="docs-sidebar-title" href="/docs">
        ドキュメント
      </a>
      <nav aria-label="ドキュメントの項目">
        <a href="/docs/getting-started">導入</a>
        <a href="/docs/state">状態と更新</a>
        <a href="/docs/events-and-actions">イベント</a>
        <a href="/docs/conditionals-and-lists">条件分岐と一覧</a>
        <a href="/docs/components-and-modules">部品とファイル分割</a>
        <a href="/docs/lifecycle-and-context">ライフサイクル</a>
        <a href="/docs/api">APIリファレンス</a>
        <a href="/docs/hono-routing">Honoファイル経路</a>
        <a href="/docs/diagnostics">診断と対応範囲</a>
      </nav>
    </aside>,
  )
}
