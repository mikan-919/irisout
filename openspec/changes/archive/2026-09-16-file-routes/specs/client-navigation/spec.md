## Purpose

生成されたブラウザー用経路表を使い、初回のSSR DOMを再利用しながら同一生成元の画面遷移と履歴操作を文書全体の再読み込みなしで処理する。

## ADDED Requirements

### Requirement: 管理対象リンクと履歴

同一生成元の管理対象経路への通常の左クリックと戻る・進む操作を捕捉し、遷移用応答から対応するHTMLとstateを使って画面を切り替えなければならない(SHALL)。初回hydrateではサーバーが埋め込んだstateを使い、loaderまたは遷移用取得を再実行してはならない(SHALL NOT)。検索引数だけが変わる遷移は新しい取得として扱わなければならない(SHALL)。

#### Scenario: 動的ページへリンク遷移する

- **WHEN** `/users/123`への管理対象リンクを通常クリックする
- **THEN** 文書全体を再読み込みせず、`id=123`のHTMLとstateで画面を置き換える

#### Scenario: 初回hydrateで再取得しない

- **WHEN** 直接アクセスで生成されたHTML、state、対応page moduleをブラウザーへ渡す
- **THEN** loaderを呼ばずに既存DOMへhydrateする

#### Scenario: 検索引数だけを変更する

- **WHEN** 同じ経路で`?tab=a`から`?tab=b`へ遷移する
- **THEN** 新しい遷移要求を送り、`tab=b`を使った結果で画面を更新する

### Requirement: 標準動作の保持

外部リンク、download属性、別tab指定、修飾キー付き操作、管理対象外のURL、同一文書内のfragment移動は捕捉せず、ブラウザーの標準動作へ委ねなければならない(SHALL)。

#### Scenario: 対象外リンクを捕捉しない

- **WHEN** 外部URL、downloadリンク、`target="_blank"`、または`#section`だけのリンクを操作する
- **THEN** 遷移用JSON要求を送らず標準のリンク動作を保つ

### Requirement: 破棄と競合抑止

画面を置き換える際は旧pageのunmount処理を実行し、旧画面のイベント処理と副作用を残してはならない(SHALL NOT)。連続した遷移で応答順が逆転しても、最後に開始した遷移だけがDOMと履歴を更新しなければならない(SHALL)。

#### Scenario: 遅い応答を無視する

- **WHEN** `/slow`の後に`/fast`を開始し、`/fast`より後に`/slow`の応答が到着する
- **THEN** `/slow`は表示を上書きせず、`/fast`の画面が残る

### Requirement: 失敗時の文書遷移

遷移用要求またはpage描画に失敗した場合、対象URLへの通常の文書遷移へ戻さなければならない(SHALL)。未一致、転送、server errorは正常pageとしてhydrateしてはならない(SHALL NOT)。

#### Scenario: 遷移取得失敗から復帰する

- **WHEN** 管理対象URLの遷移用取得または描画が失敗する
- **THEN** 対象URLへの標準文書遷移を開始する
