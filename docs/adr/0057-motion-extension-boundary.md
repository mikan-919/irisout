# ADR 0057: Motionをコンパイラ外の任意拡張にする

## 状態

採用

## 背景

Motion固有の要素名と属性名をirisoutコンパイラが解釈すると、任意依存の仕様がコンパイラ本体へ
入り込む。また、未知の属性を通常のDOM属性へ落とすと、未実装のMotion属性が動かないまま残る。

## 決定

作者APIは`irisout/motion`から読み込む`<motion.div>`形式とする。Vite設定は
`irisout/motion/vite`の`irisoutMotion()`を使う。この入口がMotion JSXを標準要素と`use=`へ
変換してから、irisoutコンパイラへ渡す。

コンパイラ本体はファイルごとの汎用ソース変換関数だけを受け取る。Motionの要素名、属性名、
公式Motionへの接続処理は持たない。実行時入口は公式Motionの`animate()`を使う。

未対応のMotion属性は変換器と型定義の両方で拒否する。通常のDOM属性へ読み替えない。

## 結果

Motionを使わない利用者の生成物と実行時依存は変わらない。Motion対応を増やす場合は
`packages/motion`だけを変更できる。独自のソース変換も同じコンパイラ接続点を使える。
