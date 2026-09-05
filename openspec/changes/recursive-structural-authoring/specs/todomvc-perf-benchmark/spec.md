## MODIFIED Requirements

### Requirement: 生成物のmarker lookupとlistener計数
compiler生成版について、生成コード内のfactory marker検索数とlistener登録数、
mount中の実`querySelector`・listener操作数を記録しなければならない(SHALL)。
同じmarkerをbinding解決とイベント配線で再検索していないことを、コード計数または
生成コードの検査で確認できなければならない。

#### Scenario: item marker参照の再利用
- **WHEN** List item factoryがmarkerを解決してイベントリスナーを登録する
- **THEN** factoryは各markerを一度だけ解決し、イベント登録は保存済み参照を使い、
  レポートへmarker検索数、listener登録数、実検索数を記録する
