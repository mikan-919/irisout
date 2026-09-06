# ADR-0027: instance単位context

## ステータス

**決定済み・実装済み**(2026-09-06)。compile-time inlineされるcomponent treeで、context値を
rootまたはstructural unitの所有変数へ接続する。実行時のcomponent objectや汎用context
registryは追加しない。

## コンテキスト

propsは明示的な値の受け渡しには十分だが、深いtreeで同じ依存を繰り返し渡す。既存の
componentはcompile-timeでinlineされ、runtime child instanceを持たないため、provider/consumer
をMapへ登録する方式は所有者を曖昧にし、未使用時の固定費を増やす。inline後の字句範囲に
provider値式を直接置換すれば、root signalとitem local signalの既存依存解析を再利用できる。

## 決定

### authored API

module先頭でcontext keyを1回宣言する。

```jsx
const Theme = createContext('light')

function Card() {
  render(<p>{useContext(Theme)}</p>)
}
```

componentの変数ゾーンでproviderを宣言する。

```jsx
provideContext(Theme, theme())
render(<Card />)
```

- `createContext(defaultValue)`はトップレベル`const`に限る。key自体はcompile-timeの識別子
  であり、runtime objectを出力しない。
- `provideContext(key, value)`はproviderのcomponent subtreeへ最も近い値式を登録する。
  providerがない場合はdefaultValueへ解決する。
- `useContext(key)`はconsumer位置でprovider/defaultの出力式へ置換する。provider値式が読む
  root/local signalの依存は、置換後の式として既存のmarker/handler解析へ合流する。

### 所有権と境界

- root scopeへinlineされたprovider/consumerはroot instanceの変数へ解決する。
- list item/conditional branchへinlineされたprovider/consumerは、そのfactoryのlocal stateと
  字句範囲に閉じる。keyed reorderで別itemの値を共有しない。
- provider値が現在unitまたは祖先unitのlocal signalを読むことは許可する。unit外のlocal
  signalを読む場合はscope limitで拒否する。
- context APIを使わないcomponentにはcontext宣言、Map、runtime importを出力しない。
- effect、動的provider tree、async context、module共有mutable stateは対象外とする。

## 検討した代替案

- runtime `Map`/stackへproviderを登録する案: inline componentにruntime child境界がなく、
  list itemごとの所有と破棄を追加管理するため却下した。
- `Context.Provider` JSX wrapper案: children/slot未対応の現行authoring境界を拡張し、
  構造unitの範囲モデルにも変更を要求するため先送りした。
- module mutable store案: root instance間で値が共有され、SSR/複数mountの独立性を壊すため
  却下した。
