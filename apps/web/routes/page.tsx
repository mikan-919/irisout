// 参照HTMLの構造をirisout JSXで再現し、現在の公開版とSSR対応だけを現状へ合わせる。
import { render, signal } from 'irisout'

export default function Page() {
  const count = signal(0)
  render(
    <div class="reference-site">
      <header class="reference-header" id="siteHeader">
        <div class="wrap nav">
          <div class="brand-group">
            <a class="brand" href="/">
              irisout
            </a>
            <span class="version">0.2.2</span>
          </div>
          <nav class="links" aria-label="主な項目">
            <a href="#how">How it works</a>
            <a href="#runtime">Runtime</a>
            <a href="#limits">Limits</a>
            <a href="https://github.com/mikan-919/irisout">GitHub</a>
          </nav>
        </div>
      </header>
      <main>
        <section class="intro">
          <div class="wrap">
            <h1 class="reveal">状態更新を、DOM更新コードへコンパイルする。</h1>
            <p class="reveal">
              irisout は
              JSX、状態、更新先をビルド時に解析し、初期HTMLとDOM更新コードを生成するUIコンパイラです。
            </p>
            <div class="install reveal">
              <code>npm install irisout</code>
              <button class="install-copy" type="button" aria-label="npm install irisout をコピー">
                <span class="copy-idle">□</span>
                <span class="copy-done">✓ copied</span>
              </button>
            </div>
          </div>
        </section>
        <section class="playground">
          <div class="pg-wrap">
            <div class="source">
              <div class="pane-title">counter.jsx</div>
              <pre class="editor">
                <code>{`let count = 0

export function Counter() {
  return <button
    onClick={() => {
      count = count + 1
    }}
  >
    {count}
  </button>
}`}</code>
              </pre>
            </div>
            <div class="result">
              <div class="pane-title">browser</div>
              <div class="demo">
                <button aria-label="1減らす" onClick={() => count(count() - 1)}>
                  −
                </button>
                <div class="demo-value">{count()}</div>
                <button aria-label="1増やす" onClick={() => count(count() + 1)}>
                  +
                </button>
              </div>
              <div class="write">
                updated: <span>text.data = {count()}</span>
              </div>
            </div>
          </div>
        </section>
        <section class="explain" id="how">
          <div class="wrap">
            <h2 class="reveal">状態と更新対象DOMの対応を、ビルド時に特定する。</h2>
            <p class="reveal">
              静的に確定できる依存関係と更新先をコンパイル時に特定し、それらを直接更新するコードを生成します。
            </p>
            <div class="code-pair reveal">
              <CodeBox
                dark={false}
                label="generated HTML"
                code={`<div id="app">
  <p>count: <span>0</span></p>
  <button type="button">increment</button>
</div>`}
              />
              <CodeBox
                dark
                label="generated update"
                code={`function updateCount() {
  countText.data = count
  doubledText.data = count * 2
}`}
              />
            </div>
          </div>
        </section>
        <TextSection className="positioning" title="実行時に決まる構造だけ、実行時に管理する。">
          キー付きリストや条件分岐など、実行時に状態が決まる構造には管理処理を残します。静的に確定できる処理まで、汎用ランタイムへ任せることはしません。
        </TextSection>
        <Detail id="authoring" title="記述用APIを、そのままブラウザへ送らない。">
          signal、derived、render は、コンパイラが状態、派生値、UIの関係を解析するための記述です。
        </Detail>
        <Detail id="runtime" title="動的な構造には、必要な管理処理を残す。">
          キー付きリスト、条件分岐、コンポーネントの生存期間には、使用した機能に必要な実行時処理だけを含めます。
        </Detail>
        <Detail id="granularity" title="直接DOM更新は、DOM APIを逐次呼ぶことと同義ではない。">
          同じ状態変更に由来する複数のDOM更新は一つの更新処理へまとめ、リストではキーに基づいて既存ノードを再利用します。
        </Detail>
        <Detail id="measure" title="性能は、実ブラウザで測る。">
          転送量、初期化、更新時間、DOM変更数、JavaScriptヒープを同じChromium上で記録しています。
        </Detail>
        <Detail id="limits" title="0.2.2は、対応範囲を明示する。">
          要求単位SSRとclient
          build用の入口を提供し、未対応の構文はコンパイル時に理由を示して拒否します。
        </Detail>
        <section class="detail" id="vite">
          <div class="wrap detail-copy">
            <h2 class="reveal">Viteから、そのまま試せる。</h2>
            <p class="reveal">公開パッケージにはコンパイラとVite連携を含みます。</p>
            <div class="vite-code reveal">
              <div class="label">vite.config.ts</div>
              <pre>
                <code>{`import { irisoutHono } from 'irisout/hono/vite'

export default {
  plugins: [irisoutHono(app)],
}`}</code>
              </pre>
            </div>
          </div>
        </section>
        <section class="end">
          <div class="wrap">
            <p class="endline reveal">ビルド時に解けるものは、ビルド時に解く。</p>
          </div>
        </section>
      </main>
      <footer class="reference-footer">
        <div class="wrap footer-grid">
          <div>
            <div class="footer-brand">irisout</div>
            <div class="footer-meta">
              <span>v0.2.2</span>
              <span>Apache-2.0</span>
              <span>UI compiler for JSX</span>
            </div>
          </div>
          <nav class="footer-links">
            <a href="https://www.npmjs.com/package/irisout">npm</a>
            <a href="https://github.com/mikan-919/irisout">GitHub</a>
            <a href="/docs">Docs</a>
          </nav>
        </div>
      </footer>
    </div>,
  )
}

function CodeBox({ label, code, dark }) {
  render(
    <div class={dark ? 'codebox dark' : 'codebox'}>
      <div class="label">{label}</div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>,
  )
}
function TextSection({ className, title, children }) {
  render(
    <section class={className}>
      <div class="wrap positioning-copy">
        <h2 class="reveal">{title}</h2>
        <p class="reveal">{children}</p>
      </div>
    </section>,
  )
}
function Detail({ id, title, children }) {
  render(
    <section class="detail" id={id}>
      <div class="wrap detail-copy">
        <h2 class="reveal">{title}</h2>
        <p class="reveal">{children}</p>
      </div>
    </section>,
  )
}
