// 最小限のビルド時ランタイム:signal()/derived() 呼び出しはコンパイル中に
// Node 上で実行され、リアクティブ状態の発見に使われる
// (docs/adr/0001-first-milestone.md 参照)。`declId` はビルド時 discovery の
// ためだけにコンパイラが注入するもので、コンポーネント作者が使う公開
// signal/derived API の一部ではない。

export const registry = new Map();

export function signal(initial, declId) {
  let value = initial;
  function accessor(...args) {
    if (args.length === 0) return value;
    value = args[0];
    return value;
  }
  if (declId) registry.set(declId, { kind: 'signal' });
  return accessor;
}

export function derived(compute, declId) {
  if (declId) registry.set(declId, { kind: 'derived' });
  return compute;
}

// すべてのコンパイル済みコンポーネントが共有する汎用 DOM グルー:焼き込み
// 済みの初期 HTML を1回描画し、マーカー要素と条件分岐アンカーをすべて
// キャッシュして、生成された update_* 関数が二度と DOM を探索しなくて
// 済むようにする。
export function mount(container, html) {
  container.innerHTML = html;
  const markers = new Map();
  const anchors = new Map();
  collectReactive(container, markers, anchors);
  return { markers, anchors };
}

// 構造(条件分岐)ユニットは常に存在するコメントアンカー(`<!--m2-->`)で
// マークされる:その後ろに実際に表示される要素は現れたり消えたりする。
// 以下の2つのウォークで、マウント/挿入されたばかりのサブツリーのマーカーと
// アンカーを登録・忘却する - 初回の mount() と生成された条件分岐スワップの
// 両方から再利用される。
export function collectReactive(root, markers, anchors) {
  if (root.nodeType === 1 && root.hasAttribute('data-iris-id')) markers.set(root.getAttribute('data-iris-id'), root);
  else if (root.nodeType === 8 && root.data) anchors.set(root.data, root);
  for (const child of root.childNodes ?? []) collectReactive(child, markers, anchors);
}

export function forgetReactive(root, markers, anchors) {
  if (root.nodeType === 1 && root.hasAttribute('data-iris-id')) markers.delete(root.getAttribute('data-iris-id'));
  else if (root.nodeType === 8 && root.data) anchors.delete(root.data);
  for (const child of root.childNodes ?? []) forgetReactive(child, markers, anchors);
}

// コメントノードは insertAdjacentHTML(Element 専用)をサポートしないので、
// contextual fragment + ChildNode#after(Comment も実装している)が
// アンカー直後に HTML を描画する vanilla-JS のやり方。
export function insertAfter(anchor, html) {
  anchor.after(anchor.ownerDocument.createRange().createContextualFragment(html));
}

// 同じ contextual-fragment トリックの detached 版 - その場に挿入する
// のではなく、新しい keyed リストアイテム要素を1つオンデマンドで作るため。
export function htmlToNode(html, ownerDocument) {
  return ownerDocument.createRange().createContextualFragment(html).firstChild;
}
