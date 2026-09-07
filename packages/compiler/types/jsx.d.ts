// authored .jsx 向けの型検査基盤(ROADMAP.md 次のアクション10)。
//
// このコンパイラは .jsx を @babel/parser で直接解析するだけで、JSX を
// createElement 相当のランタイム呼び出しへ変換しない(docs/architecture.md
// コンパイルパイプライン参照)。したがって JSX.Element は実行時に何かを
// 表す型ではなく、TS の型検査を素通りさせるためのプレースホルダー型
// (TS公式の「カスタムJSX」パターン、React非依存)。
//
// 属性名は意図的に緩くしている: 共通属性(key/use/onXxxハンドラ/children)
// のみ明示的に型付けし、それ以外は string キーの index signature で
// 受ける。コンパイラ自身が host 属性名をホワイトリスト化していない
// (M4静的host属性・ADR-0012動的host属性はchecked/valueの特別扱い以外
// 任意の属性名をsetAttributeへ通す)ため、型を先に厳しくすると
// aria-*/data-* のような正当な属性を誤検出してしまう。
// 詳細は openspec/specs/authored-jsx-type-checking/spec.md 参照。
//
// 重要: 型が通ることと実行時に compile() が受理することは別軸のまま。
// 型はコンパイラの scope limit 判定を代替しない(例: リストアイテム内の
// use= は型上も実行時も要素・リストアイテム・条件分岐ブランチで受理されるが、
// 字句スコープ外のsignal参照など、STATUS.md のscope limitは別に適用される。

// イベントの実体はブラウザ標準のまま維持し、直接addEventListenerされる
// currentTargetだけを属性が書かれた要素へ絞る。targetは子要素になり得るため
// EventTarget | nullから変更しない(ADR-0009 UNRESOLVED(09)の解消)。
type IrisElementEvent<EventType extends Event, El extends Element> = EventType & {
  readonly currentTarget: El
}

type IrisEventHandler<EventType extends Event, El extends Element> = (
  event: IrisElementEvent<EventType, El>,
) => void

// 任意のonXxxを受理する既存契約を維持しつつ、既知属性の関数型が
// テンプレートリテラル型の索引シグネチャにも代入できるようにする。
// 未知のイベント名では個別のイベント型を保証しない。
type IrisAnyEventHandler<El extends Element> =
  | IrisEventHandler<Event, El>
  | IrisEventHandler<FocusEvent, El>
  | IrisEventHandler<InputEvent, El>
  | IrisEventHandler<KeyboardEvent, El>
  | IrisEventHandler<MouseEvent, El>

type IrisKnownEventAttributes<El extends Element> = {
  onBlur?: IrisEventHandler<FocusEvent, El>
  onChange?: IrisEventHandler<Event, El>
  onClick?: IrisEventHandler<MouseEvent, El>
  onDblClick?: IrisEventHandler<MouseEvent, El>
  onInput?: IrisEventHandler<InputEvent, El>
  onKeyDown?: IrisEventHandler<KeyboardEvent, El>
}

// mount 時に1回呼ばれ、関数返り値は従来どおり「更新のたびに呼ばれる
// 再描画クロージャ」として配線される。object 形式は更新クロージャと
// unmount 時だけ呼ぶ destroy を明示できる(ADR-0011/ADR-0022)。
type IrisUseActionResult = (() => void) | { update?: () => void; destroy?: () => void }
// biome-ignore lint/suspicious/noConfusingVoidType: 「返り値なし」を`void`で表す意図的な設計(`undefined`への機械的置換はしない)
type IrisUseAction<El extends Element> = (el: El) => void | IrisUseActionResult

type IrisCommonAttributes<El extends Element> = IrisKnownEventAttributes<El> & {
  use?: IrisUseAction<El>
  children?: unknown
  // onXxx パターンの未知のイベント処理属性も関数に限って受理する。
  [handler: `on${string}`]: IrisAnyEventHandler<El> | undefined
  // それ以外の属性名(aria-*/data-* 含む)は緩く受ける(design.md Decision 3)。
  [attr: string]: unknown
}

type IrisSvgAttributes<El extends SVGElement> = IrisCommonAttributes<El> & {
  // 名前空間属性はSVGの初期HTMLで使う静的な参照に限る。動的な値は
  // compiler側のscope limitで拒否する。
  'xlink:href'?: string
  'xml:space'?: string
  'xmlns:xlink'?: string
}

interface IrisCollection<T, K> {
  (): readonly T[]
  (next: readonly T[]): readonly T[]
  update(key: K, updater: (current: T) => T): T
}

declare function signal<T>(initial: T): (...args: [] | [T]) => T
declare function collection<T, K>(
  initial: readonly T[],
  keyOf: (item: T) => K,
): IrisCollection<T, K>
declare function derived<T>(compute: () => T): () => T
declare function render(element: JSX.Element): void
// componentのmount/hydrate完了後に一度だけ呼ばれ、返り値のcleanupは
// instanceのunmount時に一度だけ呼ばれる。構造unit内ではunit factoryが所有する。
// biome-ignore lint/suspicious/noConfusingVoidType: callbackの「返り値なし」を表す
declare function onMount(callback: () => void | (() => void)): void
// root componentの依存signal/derivedが変わるたびに再実行され、前回の返り値の
// cleanupは再実行前とinstanceのunmount時に呼ばれる。compilerのscope limitに
// よる制約(signal書き込み禁止・root動きゾーン専用)は型宣言の代替ではない。
// biome-ignore lint/suspicious/noConfusingVoidType: callbackの「返り値なし」を表す
declare function effect(callback: () => void | (() => void)): void

interface IrisContext<T> {
  readonly __irisoutContextType?: T
}
interface IrisAsyncContext<T> extends IrisContext<PromiseLike<T>> {}
declare function createContext<T>(defaultValue: T): IrisContext<T>
// 非同期contextはPromiseLike<T>を値として静的置換する。compilerはawait、Suspense、
// schedulerを暗黙に追加せず、解決後の処理はauthorがthen/await可能な動きゾーンで行う。
declare function createAsyncContext<T>(defaultValue: PromiseLike<T>): IrisAsyncContext<T>
declare function provideContext<T>(context: IrisContext<T>, value: T): void
declare function useContext<T>(context: IrisContext<T>): T

declare namespace JSX {
  // 同一ファイル内合成(ADR-0014)のコンポーネントは`render()`を内部で
  // 呼ぶだけで値を返さない(推論される返り値型は`void`)。TSのJSX
  // コンポーネントチェックは「タグの返り値がJSX.Elementに代入可能か」を
  // 見るため、`void`も許容しておかないと同一ファイル内合成コンポーネントの
  // JSXタグ使用が軒並み型エラーになる。`undefined`への置換は不可
  // (「返り値なし関数」の推論型は`void`であって`undefined`ではないため、
  // 置換すると同一ファイル内合成コンポーネントの型エラーが復活する)。
  // biome-ignore lint/suspicious/noConfusingVoidType: 上記の理由で意図的
  type Element = void | object
  interface ElementChildrenAttribute {
    children: unknown
  }
  // `key`はReactと同じくintrinsic要素・コンポーネント両方のJSXタグに
  // 無条件で乗る特別な属性(ADR-0005 factory closureのリストアイテム識別、
  // DOM属性ではない)。コンポーネント側は各自のprops型にkeyを含めなくて
  // 済むよう、ここで一括宣言する(TS公式のIntrinsicAttributesパターン)。
  interface IntrinsicAttributes {
    key?: string | number
  }
  type IntrinsicElements = {
    [K in keyof HTMLElementTagNameMap]: IrisCommonAttributes<HTMLElementTagNameMap[K]>
  } & {
    [K in Exclude<keyof SVGElementTagNameMap, keyof HTMLElementTagNameMap>]: IrisSvgAttributes<
      SVGElementTagNameMap[K]
    >
  }
}
