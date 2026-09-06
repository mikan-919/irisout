## 問題

ロードマップの代表アプリは全体地図をHTML要素で構成していた。図形を直接記述する
SVG要素と、SVGで使う`xlink:href`などの名前空間属性は既存のhost属性境界で拒否される。

## 変更

- `svg`以下の要素を既存の初期HTMLとhydrate・mountへ渡す。
- SVG要素の通常の動的属性を既存の`setAttribute`更新へ接続する。
- SVG上の`xlink:*`、`xml:*`、`xmlns:*`の静的文字列属性を受理する。
- `foreignObject`の子をHTML namespaceへ戻す。
- SVG intrinsic JSX型を追加する。

## 非目標

- SVG専用runtime、property変換表、属性名の自動変換。
- 動的な名前空間属性とSVG animation。
- PDF抽出、画像生成、描画範囲の仮想化。
