// 公開パッケージの型定義と一致するAPIリファレンス。
import { render } from 'irisout'
import { DocsPage } from '../../../src/DocsPage.jsx'

export default function ApiDocs() {
  render(
    <DocsPage
      section="API"
      title="APIリファレンス"
      description="記述用API、JSX属性、コンパイラ、Vite連携、SSR、ファイル経路の公開入口を説明します。"
      previousHref="/docs/lifecycle-and-context"
      previousTitle="ライフサイクルとコンテキスト"
      nextHref="/docs/hono-routing"
      nextTitle="Honoとpage.tsxのファイル経路"
    >
      <h2>取り込み元</h2>
      <p>
        画面の記述には<code>irisout</code>
        を使います。これらの関数はコンパイラが解析し、ブラウザー用の直接DOM操作へ変換します。未変換のまま実行する関数ではありません。
      </p>
      <pre>
        <code>{`import {
  signal,
  derived,
  render,
  onMount,
  effect,
  createContext,
  createAsyncContext,
  provideContext,
  useContext,
} from 'irisout'`}</code>
      </pre>

      <h2>signal</h2>
      <pre>
        <code>{`function signal<T>(initial: T): IrisSignal<T>

interface IrisSignal<T> {
  (): T
  (next: T | ((previous: T) => T)): T
}`}</code>
      </pre>
      <p>
        読み出しと更新を一つの関数で行う状態です。更新値には値そのものか、直前の値を受け取る更新関数を渡します。
      </p>
      <pre>
        <code>{`const count = signal(0)

count()
count(3)
count((previous) => previous + 1)`}</code>
      </pre>
      <p>
        JSX内で読み出した状態だけが、そのDOM更新に接続されます。状態関数を別名へ入れ直すなど、静的解析から追跡できない書き方は診断対象です。
      </p>

      <h2>derived</h2>
      <pre>
        <code>{`function derived<T>(compute: () => T): () => T`}</code>
      </pre>
      <p>ほかの状態から計算する読み取り専用値です。書き込み口はありません。</p>
      <pre>
        <code>{`const price = signal(1200)
const quantity = signal(2)
const total = derived(() => price() * quantity())

render(<output>{total()}</output>)`}</code>
      </pre>

      <h2>render</h2>
      <pre>
        <code>{`function render(element: void | object): void`}</code>
      </pre>
      <p>
        部品が所有するJSXのルートを宣言します。部品はJSXを返さず、内部で<code>render()</code>
        を呼びます。
      </p>
      <pre>
        <code>{`function Greeting({ name, children }) {
  render(<section><h2>Hello {name}</h2>{children}</section>)
}`}</code>
      </pre>

      <h2>onMount</h2>
      <pre>
        <code>{`function onMount(callback: () => void | (() => void)): void`}</code>
      </pre>
      <p>部品のDOM接続後に一度実行します。返した関数は部品の破棄時に実行されます。</p>
      <pre>
        <code>{`onMount(() => {
  const controller = new AbortController()
  window.addEventListener('resize', measure, { signal: controller.signal })
  return () => controller.abort()
})`}</code>
      </pre>

      <h2>effect</h2>
      <pre>
        <code>{`function effect(callback: () => void | (() => void)): void`}</code>
      </pre>
      <p>
        コールバック内で参照した状態に反応します。後始末関数は次回実行前と部品の破棄時に呼ばれます。
      </p>
      <pre>
        <code>{`effect(() => {
  const id = setInterval(() => console.log(count()), 1000)
  return () => clearInterval(id)
})`}</code>
      </pre>

      <h2>use属性</h2>
      <pre>
        <code>{`type IrisUseAction<El extends Element> =
  (element: El) => void | (() => void) | {
    update?: () => void
    destroy?: () => void
  }`}</code>
      </pre>
      <p>
        <code>use</code>
        は取り込む関数ではなくJSX属性です。要素の接続時に実DOMを受け取り、更新処理と破棄処理を返せます。
      </p>
      <pre>
        <code>{`function autofocus(element) {
  element.focus()
  return { destroy() { element.blur() } }
}

render(<input use={autofocus} />)`}</code>
      </pre>

      <h2>コンテキスト</h2>
      <pre>
        <code>{`function createContext<T>(defaultValue: T): IrisContext<T>
function createAsyncContext<T>(defaultValue: PromiseLike<T>): IrisAsyncContext<T>
function provideContext<T>(context: IrisContext<T>, value: T): void
function useContext<T>(context: IrisContext<T>): T`}</code>
      </pre>
      <p>
        値を引数で中継せず子孫へ渡します。最も近い<code>provideContext()</code>
        が使われ、提供値がなければ作成時の既定値を返します。
      </p>
      <pre>
        <code>{`const Locale = createContext('ja')

function App() {
  provideContext(Locale, 'en')
  render(<Toolbar />)
}

function Toolbar() {
  const locale = useContext(Locale)
  render(<p>{locale}</p>)
}`}</code>
      </pre>

      <h2>JSXの共通属性</h2>
      <ul>
        <li>
          <code>onClick</code>などの<code>onXxx</code> — 対応するDOMイベントを接続します。
        </li>
        <li>
          <code>key</code> — 一覧内の要素または部品を識別し、DOMを再利用します。
        </li>
        <li>
          <code>use</code> — 実DOMへアクションを接続します。
        </li>
        <li>
          <code>children</code> — 部品へ子要素を渡します。
        </li>
        <li>
          <code>class</code>、<code>data-*</code>、<code>aria-*</code>など —
          静的値と対応範囲内の動的値をDOM属性へ反映します。
        </li>
      </ul>
      <p>
        イベントの<code>currentTarget</code>は属性を書いた要素型です。<code>target</code>
        は子要素の場合があるため<code>EventTarget | null</code>のままです。
      </p>

      <h2>単一ソースのコンパイル</h2>
      <pre>
        <code>{`import { compile, compileSSR } from 'irisout'

compile(source: string): CompileResult
compileSSR(source: string): CompileResult`}</code>
      </pre>
      <p>
        <code>compile()</code>はブラウザー用コードと初期HTMLを生成します。<code>compileSSR()</code>
        は要求単位SSR用コードも生成します。
      </p>

      <h2>プロジェクトのコンパイル</h2>
      <pre>
        <code>{`import { compileProject } from 'irisout'

compileProject(entryPath, {
  target?: 'client' | 'ssr',
  transformSource?: (source, filePath) => string,
}): CompileResult`}</code>
      </pre>
      <p>
        入口から相対importをたどって一つの生成物にします。<code>dependencies</code>
        には読み込んだ絶対ファイルパスが入ります。
      </p>

      <h2>CompileResult</h2>
      <pre>
        <code>{`interface CompileResult {
  code: string
  map: IrisoutSourceMap
  initialHtml: string
  ssrCode?: string
  dependencies: readonly string[]
}`}</code>
      </pre>
      <p>
        <code>code</code>はブラウザー用JavaScript、<code>initialHtml</code>は初期描画、
        <code>ssrCode</code>
        はSSR対象でのみ生成されます。ほかに解析情報も含まれますが、通常の組み込みでは上記の項目を使います。
      </p>

      <h2>ブラウザー内コンパイル</h2>
      <pre>
        <code>{`import { compile } from 'irisout/browser'

compile(source: string): CompileResult`}</code>
      </pre>
      <p>
        Node.jsのファイル機能を使わず、単一ソースをWorkerなどで変換します。利用者が入力したコードはサーバーで直接実行せず、Workerと
        <code>sandbox</code>付き<code>iframe</code>へ隔離してください。
      </p>

      <h2>Vite連携</h2>
      <pre>
        <code>{`import { irisout } from 'irisout/vite'

irisout({
  entry: 'src/main.jsx',
  container: '#app',
  htmlMarker: '<!--irisout-html-->',
  virtualModuleId: 'virtual:irisout-entry',
  transformSource,
})`}</code>
      </pre>
      <p>
        <code>entry</code>
        は必須です。残りは初期HTMLの差し込み位置、クライアント入口、前処理を指定します。
      </p>

      <h2>SSR連携</h2>
      <pre>
        <code>{`import { irisoutSsr, serializeSsrState } from 'irisout/ssr'

irisoutSsr({ entry, virtualModuleId })
serializeSsrState(value)`}</code>
      </pre>
      <p>
        <code>irisoutSsr()</code>は要求単位の描画モジュールをViteへ接続します。
        <code>serializeSsrState()</code>は状態を<code>script</code>要素へ埋め込める形に変換します。
      </p>

      <h2>Honoファイル経路</h2>
      <pre>
        <code>{`import {
  createFileRouter,
  notFound,
  redirect,
  createRouteStateScript,
} from 'irisout/hono'`}</code>
      </pre>
      <p>
        <code>createFileRouter(directory, options)</code>は<code>page.tsx</code>と
        <code>page.jsx</code>をHonoサブルーターへ接続します。<code>options</code>
        では接頭辞、loader、HTML文書関数、ソース前処理を指定できます。
      </p>
      <ul>
        <li>
          <code>notFound()</code> — loaderから404を返します。
        </li>
        <li>
          <code>redirect(location, status?)</code> —
          loaderから301、302、303、307、308の転送を返します。
        </li>
        <li>
          <code>createRouteStateScript(routeId, state)</code> — 初期状態を安全な<code>script</code>
          要素へ変換します。
        </li>
      </ul>

      <h2>診断</h2>
      <pre>
        <code>{`import { CompileDiagnostic } from 'irisout/diagnostics'

error.filePath
error.line
error.column
error.message`}</code>
      </pre>
      <p>
        対応範囲外の記述や構文エラーは位置情報付きの<code>CompileDiagnostic</code>
        になります。診断文にはファイル、行、列と理由が含まれます。
      </p>
    </DocsPage>,
  )
}
