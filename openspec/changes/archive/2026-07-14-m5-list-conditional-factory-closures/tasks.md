## 1. JSX分類の拡張

- [x] 1.1 `src/compiler/render.ts`で、JSX子要素として`{expr.map(item => <li>...)}`
      形式のリストを識別できるようにする(現状は`compile: unsupported JSX
      child (scope limit)`で拒否している)
- [x] 1.2 同様に条件分岐(三項式・`&&`)による単一要素の出し分けを識別できる
      ようにする
- [x] 1.3 リストアイテム内・条件分岐ブランチ内にさらにリスト/条件分岐が
      ネストしている場合を検出し、`compile:`+`(scope limit)`エラーを
      投げる(design.md Decision 1)

## 2. テンプレート・factory関数の生成

- [x] 2.1 `src/template.ts`(または該当箇所)で、リストアイテム/条件分岐
      ブランチの中身から`<template>`要素を1回だけ生成する処理を実装する
- [x] 2.2 `src/codegen.ts`で、factory関数(クローン取得・ローカル変数・
      `update_*`・`addEventListener`登録をまとめた1関数)を生成する
- [x] 2.3 条件分岐の各ブランチについても同様のfactory関数を生成する

## 3. keyed reuseロジック

- [x] 3.1 `update_<list>()`を、既存keyはfactoryハンドル再利用・新規keyは
      factory新規呼び出しに書き換える
- [x] 3.2 元データ配列からのkey削除時のみMapエントリを破棄しDOM要素を
      `remove()`するロジックを実装する(design.md Decision 2)
- [x] 3.3 フィルタ等で可視集合から外れるがデータ配列には残るkeyについて、
      Mapエントリ・ローカル状態を保持する(削除しない)ことをテストで
      確認する

## 4. スコープ制限のテスト

- [x] 4.1 リストアイテム内に条件分岐がネストしたJSXをコンパイルすると
      `compile:`+`(scope limit)`エラーになることを確認するテストを追加する
- [x] 4.2 条件分岐ブランチ内にリストがネストしたJSXをコンパイルすると
      同様にエラーになることを確認するテストを追加する

## 5. 既存フィクスチャ・ドキュメントの整合

- [x] 5.1 `examples/todomvc.jsx`のうち、UNRESOLVED(06)/(07)に該当しない
      部分(トップレベルのリスト描画・フィルタボタンなど)がコンパイル
      できることを確認する
- [x] 5.2 `examples/todomvc.jsx`のUNRESOLVED(06)/(07)注記を、「M5本体では
      対応せず、follow-up changeで扱う」旨に更新する
- [x] 5.3 `STATUS.md`のM5マイルストーンを「1階層の基本実装」の完了として
      更新し、06/07を新しいマイルストーン(M5.5相当)として追記する
- [x] 5.4 `ROADMAP.md`の該当箇所(次のアクション5)を更新し、06/07の
      follow-up changeを新規の次アクションとして追加する

## 6. 回帰テスト

- [x] 6.1 `bun test`で既存のM1〜M4.5・ADR-0009分の生成コード回帰テストが
      通ることを確認する
- [x] 6.2 リスト/条件分岐の新規生成コードに対する回帰テストを
      `generated-output-regression-tests`のパターンに合わせて追加する
