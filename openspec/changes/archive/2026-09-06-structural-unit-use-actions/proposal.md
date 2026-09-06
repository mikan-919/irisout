## Why

`use=`はこれまでtop-level要素だけを対象とし、`.map()` itemや条件分岐
branch内の動的要素はscope limitだった。実用画面では、itemごとの入力・描画器・
外部listenerを要素の生成と同じ単位で管理する必要がある。既存の再帰的構造unitと
factory handleを使えば、汎用effectや仮想DOMを追加せずにこの差分を実装できる。

## What Changes

- `.map()` item、条件分岐branch、および任意の深さでネストした構造unitの要素に
  `use=`を接続する。
- actionの初期化・update・destroyをfactory instanceの所有物として扱う。
  keyed itemの再利用では初期化と破棄を繰り返さず、key脱落、branch切替、祖先unitの
  破棄、root `unmount()`で各actionを一度だけ破棄する。
- 既存の`void`、関数返り値(update)、`{ update?, destroy? }`形式を維持する。
  関数返り値を破棄処理へ変換しない。action resultの依存は該当するunitの更新へ
  接続する。
- item値、unit自身・祖先のlocal signal、root signalの依存境界を明示し、追跡済み
  action writeの更新方針を維持する。
- 破棄例外と初期化途中の失敗で、残りの資源解放を続けて最初の例外を再送出する。
  破棄済みunitの更新・再生成はno-opにする。
- notes fixture、compiler/runtime回帰試験、README・STATUS・ROADMAP・CONCEPT・
  ADR・canonical specを更新し、examplesを実ブラウザでbuild・操作確認する。

## Non-Goals

- 汎用effect、`onMount`、`onDestroy`、context、event delegation、仮想DOM、
  複数ファイルcomponent importは追加しない。
- 既存の再帰的構造unit、root unmount、top-level action destroyの設計を作り直さない。

## Impact

- `packages/compiler/src/compiler/{state,analyze,render,inline-components}.ts`と
  `packages/compiler/src/codegen.ts`がunit actionの収集・依存・factory lifecycleを扱う。
- `packages/runtime/src/index.ts`にactionを持つList itemのmount/reconcile/destroy経路を
 追加する。actionを使わないListは従来経路を使う。
- `packages/compiler/test/use-action.test.ts`などに、生成・更新・再利用・破棄・例外の
  実DOM試験を追加する。
