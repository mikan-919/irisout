## Why

M5.5は構造ユニットのネストを1階層に制限し、TodoMVCの自然な
`editing() ? <input /> : <span />`と、内側unitが祖先の局所状態を読む形を
scope limitで残していた。実用画面のauthoringを確認するには、構造unitを
深さで止めず、各item・branchの状態と更新先を所有者へ接続する必要がある。

同時に、List item factoryがmarkerをbinding用とイベント配線用に再検索していた。
この重複を除き、実ブラウザの複数event計測でproduction配線の採否を決める。

## What Changes

- 構造unitのrender、依存解析、factory生成を再帰化する。各factory instanceが
  DOM範囲、局所状態、binding cache、内側Listのkeyed Map、更新処理を所有する。
- ネストunitの条件式・配列式・handlerが現在または祖先unitの局所signalを使う
  場合、所有者factoryの更新へ接続する。root signalの直接テキスト/属性依存、
  字句スコープ外の局所signal、既存のunit内`use=`はscope limitとして残す。
- item factoryはmarker参照を一度だけ解決し、イベント登録で保存済み参照を使う。
- TodoMVCを自然な編集条件へ変更し、フォーム・タブ・複数component・local state・
  入れ子Listを持つ`notes.jsx`をauthoring coverageの独立fixtureとして追加する。
- `click`、`change`、`input`、`keydown`、`dblclick`、`blur`でdirect、delegated、
  capture、adapterを実Chromiumで比較し、native event semanticsを保つdirectを
  production既定として記録する。
- ベンチマーク、ADR、STATUS、ROADMAP、CONCEPT、canonical specsを実装結果へ
  更新する。

## Capabilities

### New Capabilities

- `authoring-coverage`

### Modified Capabilities

- `list-conditional-rendering`
- `same-file-component-composition`
- `todomvc-perf-benchmark`

## Impact

- `packages/compiler/src/compiler/render.ts`、`compiler.ts`、`codegen.ts`が
  構造unitの字句スコープと再帰factoryを扱う。
- `apps/examples/todomvc.jsx`の生成形と、compilerの実DOM回帰試験が変わる。
- listener benchmarkは比較用fixtureだけを変更し、production runtimeのイベント
  配線は変更しない。
- TodoMVCの初期DOM形状が変わるため、性能値はこのchange後の計測値として記録する。
