// signal()/derived() はビルド時専用(ADR-0006):コンパイル中に Node 上で
// 実行され、リアクティブ状態の発見に使われるだけ。生成される出力コードは
// プレーン変数を使うので、この2つの関数は生成モジュールから一切 import
// されない。`declId` はビルド時 discovery のためだけにコンパイラが注入する
// もので、コンポーネント作者が使う公開 signal/derived API の一部ではない
// (docs/adr/0006-generated-output-drops-runtime-signal-wrapper.md 参照)。
//
// mount() は逆に生成モジュールから import される、実際にブラウザへ出荷
// される DOM グルー。hydrate() へのマウント/ハイドレーション分割
// (ADR-0003 相当、静的ビルドでの水和)は M3 で追加する。M1 は text マーカー
// しか持たないので、コメントアンカーの発見はまだ不要 - data-iris-id 要素の
// 収集だけで足りる。

import type { DeclId, DeclKind } from './compiler/state.js'

export const registry = new Map<DeclId, { kind: DeclKind }>()

export function signal<T>(
  initial: T,
  declId?: DeclId,
): (...args: [] | [T]) => T {
  let value = initial
  function accessor(...args: [] | [T]): T {
    if (args.length === 0) return value
    value = args[0] as T
    return value
  }
  if (declId) registry.set(declId, { kind: 'signal' })
  return accessor
}

export function derived<T>(compute: () => T, declId?: DeclId): () => T {
  if (declId) registry.set(declId, { kind: 'derived' })
  return compute
}

// すでに DOM 上に存在する(静的ビルドで焼き込み済みの)HTML から
// `data-iris-id` を持つ要素をすべて収集する。innerHTML の書き換えは
// 一切行わない - dist/index.html のように初期 HTML がすでにブラウザへ
// 届いているケース(ADR-0003 相当)向け。
//
// expectedIds(生成コードがコンパイル時に確定したマーカー ID 集合)が
// 渡された場合、収集結果に無い ID があれば即 throw する。不一致は続行しても
// 正しく動かない(更新が届かない DOM を放置する)ので、黙って no-op に
// させない。省略時は検証スキップ(後方互換)。
export function hydrate(
  container: Element,
  expectedIds?: readonly string[],
): { markers: Map<string, Element> } {
  const markers = new Map<string, Element>()
  collectMarkers(container, markers)
  if (expectedIds) {
    const missing = expectedIds.filter((id) => !markers.has(id))
    if (missing.length > 0) {
      throw new Error(
        `hydrate: missing marker(s): ${missing.join(', ')} — initial HTML does not match compiled output`,
      )
    }
  }
  return { markers }
}

// 焼き込み済みの初期 HTML を1回描画し、`data-iris-id` を持つ要素をすべて
// キャッシュして、生成された update_* 関数が二度と DOM を探索しなくて
// 済むようにする。expectedIds の検証は hydrate() に委譲する。
export function mount(
  container: Element,
  html: string,
  expectedIds?: readonly string[],
): { markers: Map<string, Element> } {
  container.innerHTML = html
  return hydrate(container, expectedIds)
}

function collectMarkers(root: Element, markers: Map<string, Element>): void {
  const id = root.getAttribute('data-iris-id')
  if (id) markers.set(id, root)
  for (const child of root.children) collectMarkers(child, markers)
}
