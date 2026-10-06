# ADR-0064: MITライセンスへの変更

## ステータス

決定済み — irisoutのライセンスをMITへ変更する。

## コンテキスト

ルートの`LICENSE`、workspaceのpackage metadata、サイトの表示はApache License 2.0を示していた。ライセンスをMITへ変更する指示を受け、リポジトリ内の表記を一致させる必要がある。

## 決定

- irisoutのソースと配布パッケージにMIT Licenseを適用する。
- ルートの`LICENSE`、全workspaceの`package.json`、サイトのライセンス表示をMITへ揃える。
- READMEにMIT Licenseを明記し、利用者がルートのライセンス文面を確認できるようにする。
- ADR-0036は当時の配布判断を記録した履歴として保持する。この決定により、同ADRのApache License 2.0に関する記述は現行方針ではなくなる。

## 結果

ルート、npm配布物のmetadata、workspace内アプリ、サイト表示がMITを示す。第三者の依存物とベンチマーク用外部コードは、それぞれの権利者が示すライセンスに従う。
