## ADDED Requirements

### Requirement: 退場アニメーション

利用者は`AnimatePresence`内のmotion要素に`exit`を指定し、条件分岐またはkey付き一覧から
削除された要素をアニメーション完了まで保持できなければならない(SHALL)。

#### Scenario: 条件分岐から削除する

- **WHEN** `AnimatePresence`内の条件分岐から`exit`付きmotion要素が外れる
- **THEN** 要素は`exit`の目標値へ移り、完了後にDOMから除去される
- **AND** `AnimatePresence`は余分なDOM要素を作らない

#### Scenario: key付き一覧を更新する

- **WHEN** key付き一覧から`exit`付きmotion要素を削除し、同じ更新で別の要素を追加する
- **THEN** 旧要素の退場と新要素の追加を同時に開始する
- **AND** 既存keyの並べ替えでは`exit`を開始しない

#### Scenario: 所有する部品を破棄する

- **WHEN** 条件分岐や一覧の更新ではなく、部品全体を破棄する
- **THEN** `exit`を開始せず、所有要素を除去する

#### Scenario: 対応外の退場設定を使う

- **WHEN** `AnimatePresence`の外で`exit`を指定するか、`mode="wait"`または`mode="popLayout"`を指定する
- **THEN** 変換器は対応外として拒否する
