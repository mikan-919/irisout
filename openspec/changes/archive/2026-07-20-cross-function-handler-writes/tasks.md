# Tasks: cross-function-handler-writes

## 1. 状態と検出

- [x] 1.1 `CompilerState` に追跡済み動きゾーン関数の記録
      (名前 → { 書き換え済み本体 finalize、推移的 writeDeclIds、
      in-progress マーカー })を追加する(design D2)
- [x] 1.2 `handlerFns`(render.ts)をハンドラ/action 解析から参照できる
      ようにする(ctx 経由 or 引数渡し。既存の受け渡し形に合わせる)
- [x] 1.3 ハンドラ/action 共有の識別子 visit の手前に CallExpression 分岐を
      追加する: binding 未解決 → 素通し / handlerFns の function 宣言と
      同一ノード → 追跡 / それ以外 → `(scope limit)` で拒否(design D1)

## 2. 呼び出し先の解析と合流

- [x] 2.1 追跡対象の呼び出し先本体を `analyzeActionStatements` 系で解析し、
      関数ごとに1回だけメモ化する(design D2)。循環は in-progress
      マーカーで打ち切り、writeDeclIds は共有 Set へ合流
- [x] 2.2 呼び出し元ハンドラへ callee の推移的 writeDeclIds を合流し、
      `update_*()` 挿入は従来どおり本体末尾のみとする(design D3)
- [x] 2.3 追跡対象呼び出しを ADR-0009 D3 の「追跡書き込み」として数え、
      呼び出しより後ろの `return` を拒否する

## 3. codegen

- [x] 3.1 記録された関数を authored 名のままモジュールスコープへ1回だけ
      emit する(design D4)。本体には `update_*()` を入れない
- [x] 3.2 authored 名が生成側予約名(`update_<signal>` / `__` 接頭辞)と
      衝突する場合は compile error で拒否する

## 4. テスト

- [x] 4.1 発見時の再現形(`onClick={() => toggle(todo.id)}`、リスト
      アイテム内)がコンパイルでき、実 DOM でクリック → 表示更新まで
      動くこと
- [x] 4.2 2階層呼び出し・相互再帰の収束(spec「再帰追跡」の両シナリオ)
- [x] 4.3 emit 単一性(複数ハンドラから同一関数)・未使用関数の非 emit・
      予約名衝突の拒否
- [x] 4.4 線引き: グローバル呼び出し素通し / ローカル束縛呼び出しの拒否 /
      追跡呼び出し後の `return` 拒否
- [x] 4.5 `bun run check-all` が通ること(no-wrapper 面・既存テストの不変
      を含む)

## 5. ドキュメント

- [x] 5.1 ADR-0013 のステータスを「決定済み(change
      `cross-function-handler-writes`)」に更新する
- [x] 5.2 STATUS.md(現在地・既知の制約: 黙って落ちる挙動の解消と新しい
      scope limit)・ROADMAP.md(論点 0 の change 起票済み → 実装済み)を
      更新する
