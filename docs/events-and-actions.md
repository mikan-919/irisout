---
title: イベントとuseアクション
description: DOMイベント、イベントオブジェクト、useアクションの初期化と破棄を扱う
slug: events-and-actions
section: イベント
order: 1
---

# イベントとuseアクション

## DOMイベント

`onClick`や`onInput`には関数を渡す。イベントはブラウザ標準のオブジェクトで、`currentTarget`は属性を指定した要素を指す。

```jsx
import { render, signal } from 'irisout'

export function NameField() {
  const name = signal('')

  render(
    <label>
      名前
      <input value={name()} onInput={updateName} />
      <output>{name()}</output>
    </label>,
  )

  function updateName(event) {
    name(event.currentTarget.value)
  }
}
```

非同期処理もイベント関数に置ける。古い要求の取り消しや競合結果の選択はアプリ側で管理する。

## useアクション

`use={action}`は実DOMが必要な処理を接続する。アクションは要素を受け取り、必要なら`update`と`destroy`を返す。

```jsx
import { render } from 'irisout'

export function FocusedField() {
  render(<input use={focus} />)

  function focus(element) {
    element.focus()
    return {
      destroy() {
        element.blur()
      },
    }
  }
}
```

`destroy`は条件分岐や一覧から要素が外れたとき、または部品が破棄されたときに呼ばれる。外部イベント監視、観測器、タイマーなどの解除に使う。

アクションやイベント処理の内部で監視関数を作る場合は、関数宣言とアロー関数のどちらも使える。関数の登録時には、その内部の書込みを表示へ反映しない。監視が発火して関数が実行を終えるときに反映する。

```jsx
function observe(element) {
  function receive() {
    element.setAttribute('data-received', 'true')
  }
  window.addEventListener('incident-ping', receive)
  return {
    destroy() {
      window.removeEventListener('incident-ping', receive)
    },
  }
}
```

注: 解除には登録時と同じ関数を渡す。アロー関数を登録と解除の箇所で別々に作ると、監視が残る。Honoのページ遷移でも旧ページの破棄時に`destroy`が呼ばれる。

## 関数本体と状態の反映

ハンドラーと内部の関数では、ループ、`switch`、`try`/`catch`/`finally`、`var`、関数とクラスの宣言、値を返す`return`を使える。書込み後に返却したり例外を投げたりしても、実行した書込みを表示へ反映する。書込み前の返却では、書込みを理由とするeffectの再実行を起こさない。式本体のコールバックも返り値を保持する。

同期補助関数の書込みは呼出し側でまとめて反映する。非同期補助関数とPromiseコールバックは、それぞれの実行が終了したときに反映する。非同期の関数を呼び出した側が`await`しなくても、補助関数の完了後に表示を更新する。書込み候補の集合は静的に求めるため、同期補助関数が条件分岐で書込みをしなかった場合にも更新処理を呼ぶことがある。同期補助関数では呼出し式の評価開始時に更新対象とするため、引数評価が例外で終了した場合にも更新処理を呼びうる。

注: ここでいう静的な収集は、関数内の書込み候補をコンパイル時に調べる処理である。実行時のすべての分岐を予測する処理ではない。

アクション、`onMount`、`effect`の初期化本体でも、分岐の中から返却できる。`use`は引数なしの更新関数、または`update`と`destroy`を持つオブジェクトを返す。`onMount`と`effect`は引数なしの後始末関数を返す。返却値は本体と同じ関数内で作られるため、本体の`const`や`let`変数を参照できる。

```jsx
function observe(element) {
  if (element.hasAttribute('data-disabled')) return
  const eventName = 'incident-ping'
  function receive() {
    element.setAttribute('data-received', 'true')
  }
  window.addEventListener(eventName, receive)
  if (element.hasAttribute('data-destroy-only')) {
    return {
      destroy() {
        window.removeEventListener(eventName, receive)
      },
    }
  }
  return {
    update() {
      element.setAttribute('data-ready', 'true')
    },
    destroy() {
      window.removeEventListener(eventName, receive)
    },
  }
}
```

実行した分岐から返った関数だけを登録する。初期化本体が状態を書き換えて返却や例外で終わっても、その終了時に状態を反映する。作者の`finally`があれば、それを実行した後に反映する。後始末は所有者の破棄時に一度だけ実行し、その本体には表示更新を挿入しない。

注: 更新依存は各返却分岐の読み取りの和集合で求めるため、選ばれなかった分岐の依存が変わっても、現在の更新関数を呼ぶことがある。`effect`の依存は初期化本体の読み取りに限り、返した後始末の読み取りは含めない。`effect`からの状態書込みは引き続き禁止する。

初期化や更新関数から直接呼ぶ補助関数の状態読み取りも依存に含める。後始末からの直接呼出しには、表示更新を挿入しない生成物を使う。共有signalのsetter自体が通知する動作は維持する。ここで抑止するのは、コンパイラが後始末へ挿入する専用の表示更新である。

残る制限は次のとおり。

- 初期化は同期処理として記述する。返却式は関数式、または`use`の`update`・`destroy`を持つオブジェクトに限る。返却関数を変数に保存してから返す形などには制限が残る。
- イベントの仮引数は、識別子一つに限る。引数の分割代入と第2引数以降はまだ受理しない。
- 直接宣言した内部関数は呼べるが、引数や別名に保存した関数値の直接呼出しには制限が残る。
- 動きゾーンの補助関数をコールバックとして渡す形式と、後始末から関数値を渡して実行する形式はまだ受理しない。監視解除の`removeEventListener`へ渡す関数は、登録時の参照を保持する。
- 再代入した関数を後始末から呼ぶ形はまだ受理しない。関数の宣言が実行されなかった場合の参照は、元のJavaScriptと同じ例外になる。
- 状態APIの参照は関数本体に置く。既定引数、クラスのフィールド初期値、計算されたメソッド名など、本体の外の実行境界はまだ変換しない。
- ジェネレーターの関数本体はまだ受理しない。

注: この関数本体の拡張はソース版の未公開変更である。npm公開版0.3.7では、文種の制限と内部の関数宣言の拒否が残る。公開版では内部の監視関数に`const`のアロー関数を使う。
