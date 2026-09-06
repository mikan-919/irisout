## 設計

### 受理条件

受理する形はリンク後module直下の次の宣言だけとする。

```js
const items = collection([{ id: 1 }], (item) => item.id)
```

key selectorは一引数のconcise arrowとし、`compile(source)`は従来どおりmodule scope stateを
受理しない。collectorは初期配列とkey selectorをbuild-time execution用と生成module用に分けて
保持する。

### 共有accessor

生成moduleでは参照された宣言を次のように一度だけ出力する。

```js
const items = __sharedCollection__([{ id: 1 }], (item) => item.id)
```

`__sharedCollection__`は値、key index、selector、購読集合を持つ。`items(next)`は重複keyを
検証してから全体置換し、`items.update(key, updater)`はkeyを維持する値だけを受理する。
どちらも成功後に現在の購読者へ同期通知する。購読解除はinstanceのunmountで一度だけ行う。

### List接続

`items().map(...)`の直接依存をcollectionとして認識する。通常のcollectionは既存のinstance
専有stateと`updateListItem`経路を使い、shared collectionはaccessorの配列を既存の
`update_<name>()`から再調整する。shared collectionのkey selectorはaccessorの`keyOf`で
Listのitem keyと照合する。これによりmodule scopeへDOM状態を置かず、mountごとのList Mapを
維持できる。

### 受入条件

- 二つのcomponent instanceがmodule collectionを読み、一方の置換とitem更新が両方へ反映される。
- 一方をunmountした後の更新は残ったinstanceだけへ反映される。
- shared collectionのList keyがselectorと異なる場合は既存のidentity errorになる。
- 未使用collectionにはhelper、宣言、購読が生成されない。
- 不正なmodule collection形は原因付き`compile:`エラーになる。
