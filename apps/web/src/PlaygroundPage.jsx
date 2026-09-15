// 保存済み共有ページの運営側SSR部品。投稿JSXはsource文字列として表示する。
import { render } from 'irisout'

export function PlaygroundPage({ record }) {
  render(
    <main class="shared-playground" data-playground-page>
      <p class="eyebrow">Irisout Playground</p>
      <h1 data-playground-title>{record.title}</h1>
      <p data-playground-description>{record.description}</p>
      <dl class="shared-playground-meta">
        <div>
          <dt>コンパイラ版</dt>
          <dd data-playground-version>{record.compilerVersion}</dd>
        </div>
        <div>
          <dt>作成日時</dt>
          <dd data-playground-created-at>{record.createdAt}</dd>
        </div>
        <div>
          <dt>ソース文字数</dt>
          <dd data-playground-source-length>{Array.from(record.source).length}</dd>
        </div>
      </dl>
      <p data-playground-status>未実行</p>
      <pre class="shared-playground-source">
        <code data-playground-source>{record.source}</code>
      </pre>
      <button type="button" data-playground-duplicate>
        複製して実行
      </button>
    </main>,
  )
}
