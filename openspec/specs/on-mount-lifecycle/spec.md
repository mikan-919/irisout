## Purpose

ルートcomponentや構造unitに要素へ紐付かない初期化処理を`onMount`で記述し、rootまたは
unit instanceのunmountへcleanupを接続する。`effect`とcontextは対象外とする。

## Requirements

### Requirement: root component onMount callback

ルートcomponentの動きゾーンにある`onMount`は、0引数arrow callbackを受理しなければ
ならない(SHALL)。callbackはcomponent instanceのmountまたはhydrate完了後に一度だけ
実行されなければならない(SHALL)。
callbackは同期関数に限る。非同期callbackは位置付きのscope limit診断で拒否し、
`async`を落としたコードを生成してはならない(SHALL NOT)。

#### Scenario: mount後にcallbackを実行する

- **WHEN** root componentが`onMount(() => { ... })`を含みmountされる
- **THEN** DOM・handler・構造unit・actionの初期化後にcallbackが一度実行される

#### Scenario: hydrate後にcallbackを実行する

- **WHEN** root componentが`onMount(() => { ... })`を含み既存HTMLへhydrateされる
- **THEN** hydrate完了後にcallbackが一度実行される

### Requirement: callbackの制御フローと返却

コンパイラはcallbackの分岐や例外処理内の返却を受理し、本体と返却を同じ関数内に
保持しなければならない(SHALL)。各返却は値なし、void、または引数なしの後始末関数に限る。
条件式の各枝も同じ返却形を満たさなければならない(SHALL)。
書込み後の返却と例外でも終了時に状態を反映し、作者の`finally`を先に実行する。
後始末関数の作成だけではその内部の書込みを反映せず、後始末にはDOM更新を挿入しない。
式本体の`onMount(() => setup())`は従来どおり返り値を破棄する。

#### Scenario: 分岐内で書込みと後始末を返す

- **WHEN** callbackが分岐内でsignalを書き換え、局所変数を参照する後始末関数を返す
- **THEN** 終了時に状態を反映し、返った後始末だけを保持する
- **AND** 後始末は本体の局所変数を参照できる

#### Scenario: 書込み前の返却

- **WHEN** callbackが書込みも追跡補助関数呼出しも行わずに値なしで返す
- **THEN** そのcallbackの書込みを理由とするDOM更新やeffect再実行を行わない

#### Scenario: 途中返却の形を検証する

- **WHEN** callbackが分岐内からobjectまたは引数付き関数を返す
- **THEN** scope limit診断で拒否する

### Requirement: cleanup ownership

callbackが0引数関数を返す場合、compilerはそれをinstanceが所有するcleanupとして
unmount時に一度だけ実行しなければならない(SHALL)。複数callbackのcleanupは登録順の
逆順で実行しなければならない(SHALL)。

#### Scenario: cleanupを逆順で実行する

- **WHEN** 2個以上の`onMount` callbackがcleanupを返し、instanceをunmountする
- **THEN** cleanupは登録順の逆順で一度ずつ実行される

#### Scenario: 二重unmountでcleanupを重ねて実行しない

- **WHEN** 同じinstanceへ`unmount()`を2回呼ぶ
- **THEN** 各cleanupは最初のunmountで一度だけ実行され、2回目は副作用を起こさない

### Requirement: initialization failure cleanup

onMount callbackまたはそれ以前の初期化が失敗した場合、既にcleanupを返したcallbackの
cleanupを実行しなければならない(SHALL)。残りのcleanupとinstance解放を続け、初期化の
最初の例外を呼び出し元へ再送出しなければならない(SHALL)。

#### Scenario: 後続callbackの失敗後に登録済みcleanupを実行する

- **WHEN** 先行callbackがcleanupを返し、後続callbackが例外を投げる
- **THEN** 先行cleanupを実行してDOMを解放し、後続callbackの例外を再送出する

### Requirement: output boundary

onMountを使わないcomponentの生成物に、onMount専用のcleanup変数・配線・runtime importを
出力してはならない(SHALL)。構造unit内のonMountはunit factoryが所有し、root scopeの
inline childはroot instanceへ、list/conditional scopeのinline childは現在のunit factoryへ
静的に収集しなければならない(SHALL)。

#### Scenario: 未使用生成物に専用コードを出力しない

- **WHEN** componentと構造unitが`onMount`を含まない
- **THEN** 生成codeにonMount専用の識別子・配線が含まれない

### Requirement: 保存した後始末関数の返却

再代入しない局所関数またはそのconst別名を後始末として返す形を受理しなければならない(SHALL)。返却位置、宣言前参照、閉包、finallyを保持し、通常実行用の本体を後始末用へ上書きしてはならない(SHALL NOT)。

#### Scenario: 保存した後始末と通常実行の共用
- **WHEN** 初期化が局所関数を呼んだ後、その関数のconst別名を後始末として返す
- **THEN** 初期化中の書込みは反映し、後始末へ挿入する専用の表示更新は抑止する
