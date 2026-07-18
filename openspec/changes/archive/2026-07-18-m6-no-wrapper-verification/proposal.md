# m6-no-wrapper-verification

## Why

ADR-0006 は「生成コードに signal()/derived() ランタイムラッパーを残さない」
と決定したが、その検証は M1 の counter フィクスチャ単体
(`test/counter.test.ts`)にしかない。M2〜M5.5+`use=` で codegen の生成面が
大きく増えた(ハンドラ・factory・ネストしたユニット・action クロージャ)のに、
no-wrapper 保証を全機能横断で確認するテストが無い。STATUS.md の M6
(「全マイルストーン横断の no-wrapper 検証」、M4・M5 完了後の TODO)を
実施する。

## What Changes

- 全マイルストーンの機能(signal / derived / テキストマーカー / 静的属性 /
  inline・識別子参照ハンドラ / イベント引数 / リスト+ネスト条件分岐 /
  条件分岐+ネストリスト / `use=` アクション+返り値クロージャ)を1つに
  収めた「全部載せ」フィクスチャを追加する。
- そのフィクスチャの生成コードに対して (a) `signal(`/`derived(` 呼び出しが
  一切現れない、(b) runtime からの import が `mount`/`hydrate` のみ、を
  検証するテストを追加する。
- 文字列検証だけでなく、実 DOM(jsdom)で mount してイベント駆動の更新が
  全機能で正しく動くことも検証する(規約: 文字列マッチだけで済ませない)。
- テストのみの change — `src/**` は変更しない。
- 完了時に STATUS.md の M6 を DONE にする。

## Capabilities

### New Capabilities

- `no-wrapper-cross-verification`: 全マイルストーン機能を横断する生成出力の
  no-wrapper 検証(ADR-0006 の保証をリグレッションテストとして固定)。

### Modified Capabilities

(なし — 既存 spec の要件は変わらない)

## Impact

- `test/no-wrapper.test.ts`(新規)。
- `STATUS.md`: M6 を DONE に更新。
- `src/**` は不変。既存スナップショット・サイズ予算にも影響しない。
