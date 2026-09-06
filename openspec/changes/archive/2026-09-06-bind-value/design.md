# 設計

## 決定

1. 記法はJSX namespaced attributeの`bind:value={name}`とする。値は現在の字句scopeで
   解決できる`signal`の識別子に限定し、`name()`や`object.name`は拒否する。
2. 対象要素は`input`、`textarea`、`select`に限定する。ブラウザの`value` propertyを
   読み書きする要素を明示し、任意要素に未知のpropertyを追加しない。
3. 生成側では既存の動的`value` property結合を再利用し、読み取りはローカルsignalなら
   プレーン変数、module共有signalなら共有accessor呼び出しとして生成する。
4. `input`イベントの直接listenerを生成する。ローカルsignalは代入、module共有signalは
   accessor呼び出しで書き戻し、既存の`update_*()`またはinstance購読へ接続する。
5. `value`または`onInput`との併用は一つの入力に二つの所有経路を作るため拒否する。
   `bind:value`の型定義は文字列signalを要求するが、要素範囲と字句scopeの検査は
   コンパイラが行う。

## 状態の所有

構造unit内の`bind:value`は、そのunitの既存factoryがlistener、値、更新処理を所有する。
リスト項目のローカルsignalは項目ごとに分離され、ルートsignalまたはmodule共有signalを
読む場合は既存の親更新経路を通る。新しい実行時registryやschedulerは追加しない。
