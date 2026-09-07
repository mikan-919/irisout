# ADR-0044: List初期化の費用削減とイベント意味論

## ステータス

**決定済み・実装済み、効果の最終判定は保留**(2026-09-07)

## 背景

TodoMVCの1万件では、生成版の初期List生成にitemごとのcallback割当、DOM挿入、既存itemの
削除確認が含まれる。イベントを親要素へ委譲するとlistener数を減らせるが、`currentTarget`、
イベント段階、`blur`、event objectの同一性を変えるため、既存の直接配線契約と一致しない。

## 決定

- 初回Listが空の場合は、生成した要素を`DocumentFragment`（DOMへ一括挿入する一時ノード）へ
  集めてから親へ挿入する。更新時のkey照合、削除、並べ替えは従来の経路を使う。
- 初回Listが空の場合は、重複keyの確認に全体`Set`を作らず、runtimeのMapへの存在確認を使う。
  既存itemがある更新では、従来どおり`Set`で削除対象を確認する。
- itemのlistenerは要素へ直接登録する。handler callbackだけをfactory単位で共有し、
  `WeakMap`（要素をkeyにしてitem handleを保持するMap）から`event.currentTarget`のhandleを
  引く。これにより、要素ごとのcallback割当を減らしながら、イベントの対象、段階、同一性を
  変更しない。
- 親要素へのイベント委譲、capture listener、イベントを別の引数へ変換するadapterは採用しない。
  比較測定で有利でも、productionのイベント契約を変えるためである。

## 結果

初回Listの一括挿入とcallback共有を、keyed reuse、List item状態、action破棄、native eventの
意味を維持したまま適用できる。Listと無関係な`focus()` actionを計測から除き、Chromium
152.0.7977.82、予熱3回後15回、N=10,000で同一生成物の基準を取り直した。最適化前82.7msに
対して現行77.8msで、短縮率は5.9%である。20%短縮の条件は未達成であり、追加改善または
目標改訂を決めるまでR3の完了判定を保留する。従来のfocusを含む326.6msとの差は入力区間が
異なるため、効果の根拠に使わない。

注: `currentTarget`はlistenerを登録した要素、`target`は実際に発生源となった子要素を指す。
この違いを保つため、callback共有とイベント委譲を別の変更として扱う。
