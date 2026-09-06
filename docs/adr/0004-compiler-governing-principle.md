# ADR-0004: コンパイラの統治原則 ― 書かれた以上の実行を生成しない

## ステータス

決定済み

## コンテキスト

Web Components化・hyperscript風authoring API・リストアイテムの状態表現などを個別に検討する中で、判断は都度その場では正しく見えても、何を基準にそれぞれ却下/採用したのかが一貫して見えにくくなっていた(例: 「単一式内でのsignal呼び出し書き換えは許すが、ブロック文全体の代入スキャンは避ける」「Web Componentsは却下するが`<template>`+cloneNodeは採用する」)。これらを貫く一つの原則を明文化する。

## 決定

**コンパイラは、生成するコードがソースの意味的要求を超えて何かを実行しない限り、変換・最適化を自由に行ってよい。**

- 生成コードが実行時に行うことは、常にソースコードが要求する範囲に収まっていなければならない。
- その制約の中でなら、コンパイラは変数の置き場所を変えても(module-flatからfactoryクロージャへ)、呼び出し構文を書き換えても(`signal()`呼び出しを素の変数代入へ)、自由に行ってよい ― これは「最適化」であり許容される。
- 逆に、ソースが要求していない実行時機構(ライフサイクルコールバック、汎用ディスパッチ、明示的に使われていないフック、ブラウザ間で挙動が分岐する隠れた互換性コスト)を追加することは、たとえ将来のために「安全」に見えても避ける。

### この原則がこれまでの判断をどう説明するか

- **Web Components を却下**(ADR-0005参照): `disconnectedCallback`等のライフサイクル機構、カスタム要素のアップグレード処理は、ソースが要求していない実行時の隠れた処理を持ち込む。加えて、autonomous custom element + `display: contents`はDOMツリー構造(`nth-child`/子結合子)を書き換えるという、ソースが要求していない副作用も生む。customized built-in(`is=`)はSafariが実装しておらず、ブラウザ間で挙動が分岐する。
- **hyperscript風API(`render([x, y], tree)`のような明示的依存配列)を却下**: JSXの式コンテナが既に持っている情報の言い換えに過ぎず、新しい実行内容を要求しない上、依存の書き忘れという新しいバグ源(Reactの`useEffect`依存配列問題と同型)を持ち込む。得るものがない。
- **`onMount`/`onLeave`フックを保留**: 何も使っていない機構は、定義上「書かれていないのに存在する」もの。このうちルートcomponentの明示的な`onMount`は、instanceごとのcleanup所有権を定めたADR-0025で一部解消した。signal依存を明示するルート`effect`はADR-0026で専用`update_*()`へ接続した。`onLeave`と汎用hook registry/schedulerは引き続き対象外である。
- **instance contextを静的置換で扱う**(ADR-0027): `createContext`/`provideContext`/`useContext`を
  使ったときだけprovider値と依存を生成コードへ接続し、未使用時のMapやregistryを出力しない。
  構造unitの動的provider treeとPromiseLikeのasync contextは各ADRの静的境界で扱い、runtime
  registryは追加しない。module共有stateもADR-0030/0037/0039の直接signal/derived/collectionに限定し、
  未使用時のhelperを出力しない。
- **明示的なcomponent `unmount()`はこの保留と別物**: 呼び出し側が取得した
  `createComponent()`/`mountComponent()` instanceへ明示的に要求した場合だけ、所有DOMと
  generated listenerを解放する。`use=`が`{ destroy }`を返した場合のdestroyも、actionが
  外部resourceの解除を明示したソース要求に限定され、暗黙のobserverや汎用hookを生成しない
  (ADR-0022)。
- **単一式内でのsignal呼び出し書き換えは許可、ブロック文全体の代入スキャンは将来課題として保留**: 前者はソースが既に完全に表現している情報(閉じた1つの式)を並べ替えるだけで実行内容は変わらない。後者も原理的にはこの原則に反しないが、正しさを保証するための静的解析コスト(複合代入・分割代入・配列変更メソッド等、JS代入文法の全網羅)が今のスコープを大きく超える。

### イベント配線への適用(2026-09-05)

native eventを受け取るハンドラでは、`event.target`、`event.currentTarget`、
イベントのbubbling/capture、event objectのidentityもソースから観測できる意味の
一部である。従って、itemごとの直接listenerを親要素の委譲listenerへ置き換える
最適化は、DOM更新が同じというだけでは意味保存とみなさない。委譲側の
`currentTarget`は親へ変わり、`blur`のようなnon-bubbling eventは通常のbubble委譲
では届かないため、これらを保存する具体設計と代表fixtureの検証が必要になる。

2026-09-05の`packages/bench/listener-strategy.playwright.ts`は、子`span`をtargetに
したbubbling `click`とitem identity帳簿だけを比較し、native `currentTarget`互換を
解決していない。この範囲では委譲を有望な候補と記録できるが、全イベントのproduction
採用を決める根拠にはしない(ADR-0021)。

## 未決定事項(後続で詰める)

- `signal()`/`derived()`をソースの記述からも完全に除去する(Svelte的な、代入箇所の静的検出への移行)方向性は、この原則には反しない。ただし全代入形式を静的に正しく網羅する必要があり、今回のスコープでは着手しない。将来取り組む際は、この原則を判断基準として使うこと。
