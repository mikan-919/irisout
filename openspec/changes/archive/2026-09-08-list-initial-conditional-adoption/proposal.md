## Why

リスト項目内のローカルsignalが単純な真偽値で初期化される条件分岐では、項目templateを
cloneした直後に同じ選択枝をbranch factoryがcloneして挿入する。初回だけ既存DOMを
引き取れば、初期生成時のbranch cloneと挿入を省ける。ただし非表示後の再表示で初回と
同じ状態値になる経路、SVG名前空間、lifecycle、入れ子構造を一般経路へ混ぜてはならない。

## What Changes

- リスト項目が直接所有するローカルsignalの初期値が`true`/`false`で、選択枝が静的に
  安全な場合だけ、その枝を項目templateへ埋め込む。
- 初回判定専用のフラグを保持し、条件が非表示状態へ戻った後の再表示では既存DOMを
  引き取らず、通常のclone経路を使う。
- 条件分岐の親templateがSVG名前空間内にある場合、枝自身がSVGでなくても対象外にする。
- 最適化対象外の条件分岐では従来の生成文字列と挿入経路を維持する。
- mount、hydrate、初期真偽値、空枝、keyed追加・並べ替え・削除を実DOM試験へ追加する。

## Non-goals

- 20%短縮の達成宣言、R3完了判定、性能目標の緩和。
- 条件評価の一般化、event delegation、lifecycle/action registry、SVG名前空間処理の変更。
- 既存のkeyed状態保持、イベント意味論、binding cache、破棄順序の変更。

## Impact

- `packages/compiler/src/codegen.ts`の初期template生成とconditional update生成を変更する。
- `packages/compiler/test/same-file-component-composition.test.ts`へDOM回帰試験を追加する。
- canonical OpenSpec、ADR-0045、性能結果、STATUSを更新する。
