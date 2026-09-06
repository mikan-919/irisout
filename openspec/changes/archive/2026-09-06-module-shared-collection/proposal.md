## 背景

`compileProject`はmodule共有signalとderivedを受理するが、module scopeのcollectionは拒否して
いる。複数のcomponent instanceが同じ配列を読み、key付きListを更新する用途を、手書きの共有
storeへ逃がさず記述できる必要がある。

## 変更

- `compileProject`に限り、直接`const name = collection(initial, (item) => key)`を受理する。
- 参照されたcollectionを生成moduleへ一度だけ出力し、各mounted instanceのupdate経路を購読させる。
- 配列の置換と`collection.update()`は同期通知し、ListのDOM状態はinstanceごとに維持する。
- `compile(source)`、request SSR分離、永続化、汎用storeは変更しない。

## 非目標

- module collectionのrequest単位複製、永続化、非同期scheduler。
- module scopeへのList DOM state配置。
- module collectionのitem更新専用通知形式や新しいDOM registry。
