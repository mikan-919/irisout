// 公式実例の索引をJSXで宣言し、個別のIrisout画面へ案内する。
import { render } from 'irisout'
import { SiteHeader } from '../SiteHeader.jsx'

export function Examples() {
  render(
    <div>
      <SiteHeader current="examples" search={false} onSearch={null} />
      <main>
        <header class="page-heading">
          <p>EXAMPLES</p>
          <h1>小さな実装から、動きを確かめる。</h1>
          <span>各ページはirisoutで構築し、単独のURLで開けます。</span>
        </header>
        <section aria-labelledby="interaction-title">
          <div class="section-heading">
            <span>01</span>
            <h2 id="interaction-title">操作</h2>
          </div>
          <div class="example-grid">
            <a class="example-card" href="/examples/bcf-copy-button">
              <div class="example-preview" aria-hidden="true">
                <span>Copy</span>
              </div>
              <div class="example-copy">
                <p>BCF / WEB ANIMATIONS</p>
                <h3>BCF Copy Button</h3>
                <span>ぼかしを使った交差フェードと速度調整</span>
              </div>
              <strong aria-hidden="true">→</strong>
            </a>
            <a class="example-card" href="/examples/task-board">
              <div class="example-preview task-preview" aria-hidden="true">
                <span>
                  <i />
                  <i />
                  <i />
                </span>
              </div>
              <div class="example-copy">
                <p>SIGNAL / DERIVED / KEYED LIST</p>
                <h3>Task Board</h3>
                <span>追加・絞り込み・更新・削除をまとめた状態管理</span>
              </div>
              <strong aria-hidden="true">→</strong>
            </a>
            <a class="example-card" href="/examples/morph-bcf">
              <div class="example-preview morph-preview" aria-hidden="true">
                <span>Focus Shift</span>
              </div>
              <div class="example-copy">
                <p>MORPH / BCF</p>
                <h3>Morph × BCF</h3>
                <span>共有レイアウトの形状変形と内容の焦点移動</span>
              </div>
              <strong aria-hidden="true">→</strong>
            </a>
          </div>
        </section>
      </main>
      <footer>
        <a href="/">irisout</a>
        <span>Apache License 2.0 · 2026</span>
      </footer>
    </div>,
  )
}
