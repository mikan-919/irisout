# ADR-0020: 同期スコープ内の共有marker更新をbatchする

## ステータス

**決定済み・実装済み**(2026-09-04)。

## コンテキスト

現行のcodegenは、ハンドラ・action・追跡された動きゾーン関数の書き込み先を
root signalの集合へ解決した後、`update_<name>()`をソース上の1スコープ末尾で
順番に呼び出していた。1つのスコープが2つのroot signalを書き、同じtext/属性/
List/conditional markerが両方に依存すると、そのmarkerの式評価とDOM反映が
中間状態を含めて2回実行される。

## 決定

### 1. write setと静的marker集合の交差だけでbatchを作る

コンパイル時に既知のwrite setと`signalToMarkers`の交差を調べ、次の両方を満たす
スコープにだけ専用の内部関数(`__update_batch_N__`)を生成する。

- 2つ以上のroot signalを書き込む。
- root signalのmarker集合に重複がある。

交差しない複数markerは既存の`update_<name>()`を順番に呼ぶ。root signalが1つ
だけの場合もbatchを生成しない。同じroot signalへの複数回の書き込みは既存の
Setによる重複排除に任せる。

### 2. batchの実行順序

batchは、スコープ内の全書き込みが終わった後に次の順で処理する。

1. 書き込まれたroot signalに直接依存するderivedを一度ずつ再計算する。
2. root signalのmarker集合の和集合を、重複なしで一度ずつ更新する。

derivedは現行どおりderived-of-derivedを受理しない。従って一般的なランタイム
トポロジーソートや依存購読機構は導入しない。batch関数はinstance内に閉じ、
`update_<name>()`は既存のinstance APIとして残す。

### 3. collection.update()との境界

`collection.update()`は既存のkeyed direct経路を維持する。単独、または共有markerを
持たない別rootとの組み合わせでは、従来どおり更新itemへ直接通知する。

別rootと同じmarkerを更新するbatchに入る場合だけ、生成されたinstance専有の深さ
カウンタでdirect通知をスコープ末尾まで抑止し、batchが最終値を一度だけ反映する。
通常の`collection(next)` setterはこの抑止対象ではなく、batchから通常のmarker更新
を行う。

### 4. 構造ユニット・action・追跡関数

ハンドラのinline arrow/識別子参照、構造ユニット内のハンドラ、action本体と返り値
クロージャ、追跡された動きゾーン関数は、同じ静的resolverを使う。ローカルsignal
のfactory `update()`は従来どおり別経路で呼び、root signalだけがbatchへ入る。

## 対象外

- 公開batch API、microtask scheduler、汎用subscription/runtime graph
- derived-of-derivedのトポロジーソート
- 複数の独立イベントや別スコープにまたがる書き込みの合流
- `collection.update()`を複数回行う単独スコープのdirect通知の追加抑制

## 結果

- 共有markerは同期スコープの最終状態を一度だけ反映し、中間DOM状態を公開しない。
- 依存markerが異なる既存ケースと、単一rootの生成物には新しいbatch関数を出力しない。
- DOM setter計数を含むjsdomの実DOMテストで、通常signal、derived、属性、追跡関数、
  action、collection.update()の共有marker経路を検証する。
