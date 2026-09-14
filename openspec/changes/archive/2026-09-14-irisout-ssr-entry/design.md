## Context

ADR-0038はclient buildとrequest SSRを分離している。ADR-0052はルート部品、直列化可能な入力・state、クライアント専用処理、初期対応記法を決定した。現在のcompilerはビルド時実行で初期HTMLを作り、module共有stateを生成moduleへ置く。

## Goals / Non-Goals

**Goals:**

- 運営側部品をビルド時に解析し、要求時には入力を渡してHTMLとstateを生成する。
- SSR結果と既存ブラウザ生成物を同じmarker契約でhydrateできるようにする。
- 要求間で可変stateを共有しない。

**Non-Goals:**

- 投稿ソース、外部module、任意依存のサーバー実行。
- ストリーミングSSR、汎用router、module共有stateの要求分離。
- イベント、ライフサイクル、actionのサーバー実行。

## Decisions

- `irisoutSsr({ entry })`は指定されたルート入口をビルド時に処理し、SSR用仮想moduleから`render(input)`を公開する。
- 初期SSRは単一module入口に限る。相対moduleの関数宣言を含むimportもcompile scope limitで拒否する。
- renderは要求開始時に入力を検証し、要求専用の局所stateを作り、`{ html, state }`を返す。関数、DOM、要求オブジェクトはstateへ含めない。ルート部品直下の局所signalの初期値はstateへ保存してhydrateへ渡す。
- 構造unit内の`signal()`/`derived()`は初期SSRでcompile scope limitにする。
- ルート入力bindingが生成moduleの内部名と衝突する場合はcompile scope limitにする。
- `serializeSsrState()`はJSON値のprototype、property、有限性を検査し、`<`等をUnicode escapeした文字列を返す。
- SSR生成物の`hydrateComponent(container, state)`と`mountComponent(container, state)`はrenderが返したstateだけを受け取り、raw inputを受け付けない。
- SSR用codegenではイベント、`onMount`、`effect`、`use=`を生成・実行せず、クライアント用codegenへだけ残す。
- module scopeのsignal/derived/collectionと、相対moduleのimportは初期SSR入口で診断する。一般的な要求分離は別ADRで扱う。
- `state`は安全なscript埋込みまたは別のデータ搬送を経由してhydrateへ渡し、サーバーで再描画して比較しない。

## Risks / Trade-offs

- [SSR HTMLとhydrate markerがずれる] → 固定データA/Bと版不一致、条件分岐を含む回帰試験を追加する。
- [要求stateが残る] → render呼出しごとのfactoryと並行要求試験を使う。
- [未対応記法がサーバーで黙って実行される] → scope limit診断を必須にする。
- [SSR入口の導入で公開tarballが壊れる] → `pack:smoke`へserver entryの型・解決試験を追加する。
- [404・503で正常stateが残る] → 要求処理層のchangeで状態生成前に応答を確定する。

## Migration Plan

新しい副入口とSSR用virtual moduleを追加し、既存`irisout/vite`の入口は変更しない。固定データのSSR・hydrate・並行要求試験を通してから共有ページchangeへ接続する。
