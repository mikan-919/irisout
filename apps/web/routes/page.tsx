import { render, signal } from 'irisout'

export default function Page() {
  const count = signal(0)
  render(
    <div class="reference-site">
      <header id="siteHeader">
        <div class="wrap nav">
          <div class="brand-group"><a class="brand" href="#">irisout</a><span class="version">0.1.1</span></div>
          <nav class="links" aria-label="Main navigation">
            <a href="#how">How it works</a><a href="#runtime">Runtime</a><a href="#limits">Limits</a>
            <a href="https://github.com/mikan-919/irisout" target="_blank" rel="noreferrer">GitHub</a>
          </nav>
        </div>
      </header>
      <main>
        <section class="intro"><div class="wrap">
          <h1 class="reveal">状態更新を、DOM更新コードへコンパイルする。</h1>
          <p class="reveal">irisout は JSX、状態、更新先をビルド時に解析し、初期HTMLとDOM更新コードを生成するUIコンパイラです。</p>
          <div class="install reveal"><code>npm install irisout</code>
            <button id="copy" type="button" aria-label="npm install irisout をコピー">
              <span class="copy-face copy-idle" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="8" y="8" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.7" /><path d="M15 6V5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15H6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg></span>
              <span class="copy-face copy-done" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m6.5 12.5 3.2 3.2 7.8-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>copied</span>
            </button>
          </div>
        </div></section>
        <section class="playground"><div class="pg-wrap">
          <div class="source"><div class="pane-title">counter.jsx</div>
            <pre class="editor"><code>{`let count = 0

export function Counter() {
  return <button
    onClick={() => {
      count = count + 1
    }}
  >
    {count}
  </button>
}`}</code></pre>
          </div>
          <div class="result" id="resultPane"><div class="pane-title">browser</div>
            <div class="demo"><button id="minus" onClick={() => count(count() - 1)}>−</button><div class="demo-value" id="value">{count()}</div><button id="plus" onClick={() => count(count() + 1)}>+</button></div>
            <div class="write">updated: <span id="writeTarget">text.data = {count()}</span></div>
          </div>
        </div></section>
        <section class="explain" id="how"><div class="wrap">
          <h2 class="reveal">状態と更新対象DOMの対応を、ビルド時に特定する。</h2>
          <p class="reveal">静的に確定できる依存関係と更新先をコンパイル時に特定し、それらを直接更新するコードを生成します。</p>
          <div class="code-pair reveal">
            <div class="codebox"><div class="label">generated HTML</div><pre><code>{`<div id="app">\n  <p>\n    count: <span>0</span>\n    doubled: <span>0</span>\n  </p>\n  <button type="button">increment</button>\n</div>`}</code></pre></div>
            <div class="codebox dark"><div class="label">generated update</div><pre><code>{`function updateCount() {\n  countText.data = count\n  doubledText.data = count * 2\n}\n\nbutton.addEventListener("click", increment)`}</code></pre></div>
          </div>
        </div></section>
        <section class="positioning" id="why"><div class="wrap positioning-copy">
          <h2 class="reveal">実行時に決まる構造だけ、実行時に管理する。</h2>
          <p class="reveal">キー付きリストや条件分岐など、実行時に状態が決まる構造には管理処理を残します。静的に確定できる処理まで、汎用ランタイムへ任せることはしません。</p>
          <ul class="plain-list reveal"><li><strong>記述する:</strong> JSX、signal、derived。</li><li><strong>ビルド時に確定する:</strong> 初期HTML、依存関係、更新先。</li><li><strong>実行時に残す:</strong> DOM更新と動的構造の管理処理。</li></ul>
        </div></section>
        <section class="detail" id="authoring"><div class="wrap detail-copy">
          <h2 class="reveal">記述用APIを、そのままブラウザへ送らない。</h2>
          <p class="reveal"><code>signal</code>、<code>derived</code>、<code>render</code> は、コンパイラが状態、派生値、UIの関係を解析するための記述です。静的に確定できる箇所は、対応するDOM更新コードへ変換します。</p>
          <div class="single-code reveal"><div class="label">simple binding after compile</div><pre><code>{`let count = 0\n\nfunction updateCount() {\n  countText.data = count\n  doubledText.data = count * 2\n}`}</code></pre></div>
        </div></section>
        <section class="detail" id="runtime"><div class="wrap detail-copy">
          <h2 class="reveal">動的な構造には、必要な管理処理を残す。</h2>
          <p class="reveal">キー付きリスト、条件分岐、コンポーネントの生存期間は、ビルド時だけでは確定しません。これらを使った場合は、DOMの再利用や挿入・移動・削除を扱う共有処理を生成物へ含めます。</p>
          <div class="runtime-notes reveal"><p>ランタイムを0バイトにすること自体は目的ではありません。</p><p>使用した機能に必要な実行時処理だけを出力します。</p></div>
        </div></section>
        <section class="detail" id="granularity"><div class="wrap detail-copy">
          <h2 class="reveal">直接DOM更新は、DOM APIを逐次呼ぶことと同義ではない。</h2>
          <p class="reveal">同じ状態変更に由来する複数のDOM更新は、一つの更新処理へまとめられます。リストではキーに基づいて既存ノードを再利用し、挿入、移動、削除を一単位として扱います。</p>
          <p class="reveal">専用コードと共有処理のどちらを使うかは、速度、生成コードサイズ、メモリ、実装の単純さを比較して決めます。</p>
        </div></section>
        <section class="detail" id="measure"><div class="wrap detail-copy">
          <h2 class="reveal">性能は、実ブラウザで測る。</h2>
          <p class="reveal">TodoMVCの比較では、転送量、初期化、更新時間、DOM変更数、JavaScriptヒープを同じChromium上で記録しています。現在の計測では、一部の単一項目更新は短い一方、初期化には改善余地があります。</p>
          <div class="measure reveal">計測条件と結果は <code>packages/bench/todomvc-compiler.results.md</code> に記録しています。手書き実装は比較基準として分離しています。</div>
        </div></section>
        <section class="detail" id="limits"><div class="wrap detail-copy">
          <h2 class="reveal">0.1.1は、対応範囲を限定した試用版。</h2>
          <p class="reveal">現行版はclient build用の入口を提供しています。要求ごとのSSR HTML生成は対象外です。未対応の構文は、コンパイル時に理由を示して拒否します。</p>
          <div class="scope reveal"><p>対応: signal / derived、テキスト・属性更新、イベント、キー付きリスト、条件分岐、コンポーネント合成、use=、onMount、effect、context、SVG。</p><p>作者以外による手動試用は未実施です。</p></div>
        </div></section>
        <section class="detail" id="vite"><div class="wrap detail-copy">
          <h2 class="reveal">Viteから、そのまま試せる。</h2>
          <p class="reveal">公開パッケージにはコンパイラとVite連携を含みます。既存のViteアプリでは、入口と接続先を指定して使えます。</p>
          <div class="vite-code reveal"><div class="label">vite.config.ts</div><pre><code>{`import { irisout } from 'irisout/vite'\n\nexport default {\n  plugins: [\n    irisout({\n      entry: 'src/App.jsx',\n      container: '#app',\n    }),\n  ],\n}`}</code></pre></div>
        </div></section>
        <section class="end"><div class="wrap"><p class="endline reveal">ビルド時に解けるものは、ビルド時に解く。</p></div></section>
      </main>
      <footer><div class="wrap footer-grid">
        <div><div class="footer-brand">irisout</div><div class="footer-meta"><span>v0.1.1</span><span>Apache-2.0</span><span>UI compiler for JSX</span></div></div>
        <nav class="footer-links" aria-label="Project links"><a href="https://www.npmjs.com/package/irisout" target="_blank" rel="noreferrer">npm</a><a href="https://github.com/mikan-919/irisout" target="_blank" rel="noreferrer">GitHub</a><a href="https://github.com/mikan-919/irisout/blob/main/README.md" target="_blank" rel="noreferrer">README</a></nav>
      </div></footer>
    </div>,
  )
}
