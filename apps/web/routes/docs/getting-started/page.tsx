// npm公開版を導入して最初の画面を構築する手順。
import { render } from 'irisout'
import { DocsPage } from '../../../src/DocsPage.jsx'

export default function GettingStarted() {
  render(
    <DocsPage
      section="導入"
      title="npm公開版から始める"
      description="irisout 0.3.3を導入し、型検査と本番ビルドまで確認します。"
      previousHref={null}
      previousTitle=""
      nextHref="/docs/state"
      nextTitle="状態と派生値"
    >
      <h2>1. パッケージを導入する</h2>
      <pre>
        <code>{'bun add irisout@0.3.3 vite-plus@0.3.0\nbun add --dev typescript@5.9'}</code>
      </pre>
      <p>package.jsonへdev、build、typecheckの実行コマンドを追加します。</p>
      <pre>
        <code>{'"dev": "vp dev"\n"build": "vp build"\n"typecheck": "tsc --noEmit"'}</code>
      </pre>
      <h2>2. Vite+を設定する</h2>
      <pre>
        <code>
          {
            "import { defineConfig } from 'vite-plus'\nimport { irisout } from 'irisout/vite'\n\nexport default defineConfig({\n  plugins: [irisout({ entry: 'src/App.jsx', container: '#app' })],\n})"
          }
        </code>
      </pre>
      <p>
        index.htmlの対象要素へirisout-htmlコメントを置き、main.jsからvirtual:irisout-entryを取り込みます。
      </p>
      <h2>3. JSXを書く</h2>
      <pre>
        <code>
          {
            "import { render, signal } from 'irisout'\n\nexport function App() {\n  const count = signal(0)\n  render(<button onClick={() => count(count() + 1)}>{count()}</button>)\n}"
          }
        </code>
      </pre>
      <h2>4. 確認する</h2>
      <pre>
        <code>{'bun run typecheck\nbun run build\nbun run dev'}</code>
      </pre>
      <p>ボタンを押して値が変われば、状態からDOMへの更新が接続されています。</p>
    </DocsPage>,
  )
}
