# ADR-0038: client buildとSSRの境界

- **状態**: 決定済み
- **日付**: 2026-09-06

## コンテキスト

`compileProject()`はコンポーネントをビルド時に一度実行し、`initialHtml`とブラウザ用の
hydrate処理を生成する。現行の公開入口は`@irisout/vite-plugin`であり、index.htmlへ静的な
初期HTMLを埋め込んでブラウザで引き継ぐ。要求ごとに入力や状態を分けてHTMLを生成する
サーバー用入口はない。

module共有signal/derivedは生成moduleのmodule scopeに置かれる。サーバーで同じ生成moduleを
要求間に再利用すると、ある要求の値が別の要求から読めるため、ブラウザの複数mount向けの
共有単位をそのまま要求単位へ拡張できない。

## 決定

- 現行版の公開契約はclient buildに限定する。`initialHtml`はビルド時の値から一度生成する
  静的HTMLであり、request SSRの結果とは呼ばない。
- `compileProject()`とVite連携には`renderToString`、サーバーtarget、要求ごとのstate factoryを
  暗黙に追加しない。現在の生成物はブラウザでmountまたはhydrateする。
- request SSR、要求ごとの入力、要求間で共有しないmodule stateが必要になった場合は、
  サーバー用入口、要求ごとのstate所有者、HTML後のhydrate引き継ぎを別のADRとOpenSpecで
  定義してから実装する。
- module共有collectionと永続化はこの判断に含めない。これらは所有者と破棄規則が別である
  ため、別契約として扱う。

## 検討した代替案

- **生成済みmoduleをサーバーでもそのまま使う**: 要求間でmodule scopeの共有stateが残り、
  request isolationを保証できないため却下した。
- **`initialHtml`をrequest SSRとみなす**: 入力を要求ごとに受ける入口とstate factoryがなく、
  静的なビルド時実行と要求ごとの生成を同じ契約にできないため却下した。
- **今すぐサーバーtargetを追加する**: client buildの実装単位を越え、stateの所有とhydrateの
  境界を先に定義しないまま実装することになるため採用しない。

## 結果

静的HTMLを配信してブラウザでhydrateする現行モデルの境界が確定する。request SSRを必要とする
利用例が出たときは、共有stateの再利用を避けるstate factoryとサーバー専用生成経路を受入条件へ
含めて判断できる。現行版は要求ごとのHTML生成を対応範囲に含めない。
