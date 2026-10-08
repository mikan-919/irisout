# npmへの公開

版の更新はBun、公開は`.github/workflows/release.yml`で行う。

```bash
bun run release:prepare 0.3.7
```

このコマンドは公開パッケージ、ロックファイル、導入文書、公開版の導入検査の版を更新し、変更履歴へ記入欄を加える。`packages/irisout/CHANGELOG.md`の`TODO`を変更内容へ置き換え、`STATUS.md`に実装範囲を記録する。過去の公開記録と比較測定の版は変えない。

```bash
bun run release:check v0.3.7
git status --short --branch
git add -A
git commit -m "Prepare irisout 0.3.7 release"
git tag v0.3.7 main
git push --atomic origin main refs/tags/v0.3.7
```

タグとパッケージの版、変更履歴、導入検査の版が一致していることを確認する。タグのpush後は、既存のCIを通し、npmへ公開し、公開版の導入検査を行い、変更履歴からGitHubリリースを作る。npm公開版の導入検査は、レジストリへの反映待ちとして最大2分間、10秒ごとに再試行する。CIでは型検査、全試験、デモと公式サイトの構築、ブラウザー試験、梱包物の隔離導入検査を行う。並行する公開は一つずつ処理する。

同じ実行を再試行する場合、公開済みの版は再公開せず、公開版の導入検査とGitHubリリース作成を続ける。GitHubリリースが存在する場合は変更しない。公開版の導入検査で失敗した場合、npm公開は取り消さない。

GitHub ActionsからReleaseを手動実行すると、CIと梱包、公開の予行だけを行う。npm公開とGitHubリリース作成はタグのpushで実行する。

## 初回の公開元登録

npmのirisout設定でGitHub Actionsを「信頼された公開元」として登録する。登録値は次のとおり。

| 項目                 | 値            |
| -------------------- | ------------- |
| 利用者               | `mikan-919`   |
| リポジトリ           | `irisout`     |
| ワークフローファイル | `release.yml` |
| 環境                 | 指定しない    |
| 許可する操作         | `npm publish` |

登録はnpmの設定画面か、次のコマンドで行う。登録時にはnpmの二要素認証を使う。

```bash
bunx npm@11.19.0 trust github irisout --repository mikan-919/irisout --file release.yml --allow-publish --yes
```

公開の認証にはOIDCを使う。これはGitHub Actionsの実行元をnpmが確認し、公開に使う認証情報を発行する仕組みである。保存したnpmトークンや公開時の手動ログインは不要になる。依存導入と梱包はBunを使い、OIDC公開だけはBunからnpm CLIを呼ぶ。[npm公式手順](https://docs.npmjs.com/trusted-publishers/)
