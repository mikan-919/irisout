# Cloudflare D1のバックアップと復旧

対象は公式サイトの`irisout-playground`データベースである。D1は共有Playgroundの投稿と削除状態を保存する。削除済み行は本文を消して行自体を残すため、SQL書き出しには削除記録も含まれる。

## 定期バックアップ

バックアップSQLには利用者の投稿本文が含まれる。アクセス制限と暗号化のある保管先を使い、Git、公開ストレージ、作業ログへ置かない。最低限、月1回と本番DBの変更前に取得し、保管先の世代管理と保持期限も確認する。

リポジトリのルートで実行する。`CLOUDFLARE_BACKUP_DIR`は暗号化済みの保管領域を指すように設定する。

```bash
umask 077
export CLOUDFLARE_BACKUP_DIR=/secure/backups/irisout
mkdir -p "$CLOUDFLARE_BACKUP_DIR"
BACKUP_FILE="$CLOUDFLARE_BACKUP_DIR/irisout-playground-$(date -u +%Y%m%dT%H%M%SZ).sql"
bunx wrangler d1 export irisout-playground --remote \
  --output "$BACKUP_FILE" \
  --config apps/web/cloudflare/wrangler.site.jsonc
```

コマンド成功後にファイルサイズとSQL先頭のschema定義を確認する。空ファイルや`CREATE TABLE playgrounds`を含まないファイルは退避物として採用しない。投稿本文を端末へ表示せず、アクセス制御された別保管先へ複製する。最後に書き出し時刻、対象DB、ファイルのSHA-256を運用記録へ残す。

退避時の行数と削除済み行数も記録する。

```bash
bunx wrangler d1 execute irisout-playground --remote \
  --command 'SELECT COUNT(*) AS total, SUM(deleted_at IS NOT NULL) AS deleted FROM playgrounds' \
  --config apps/web/cloudflare/wrangler.site.jsonc
```

Cloudflare D1はTime Travelも提供する。利用可能な期間は契約プランで異なるため、月次退避の代わりにはしない。直近の誤操作からの復旧ではTime Travelを優先できる。

## 別データベースへの復元と切替

本番DBを残したまま新しいD1へ復元し、内容を確認してからWorkerの接続先を切り替える。復元前に対象SQLのSHA-256と取得記録を照合する。

1. Cloudflareアカウントで認証し、バックアップから復元先データベースを作る。

   ```bash
   bunx wrangler d1 create irisout-playground-restore
   ```

2. 出力された`database_id`を使い、`apps/web/cloudflare/wrangler.site.jsonc`を複製して一時設定を作る。複製側の`database_name`を`irisout-playground-restore`、`database_id`を新しいIDへ変更し、`migrations_dir`は既存の値のままにする。一時設定は復元コマンドにだけ使い、Gitへ追加しない。

3. 新しいDBへSQL全体を取り込む。先にmigrationを適用すると、既存テーブルと衝突するため行わない。

   ```bash
   bunx wrangler d1 execute irisout-playground-restore --remote \
     --file "$BACKUP_FILE" \
     --config apps/web/cloudflare/wrangler.restore.jsonc
   ```

4. 元DBと復元先の両方で、行数と削除済み行数を照合する。SQL内容は表示しない。

   ```bash
   bunx wrangler d1 execute irisout-playground --remote \
     --command 'SELECT COUNT(*) AS total, SUM(deleted_at IS NOT NULL) AS deleted FROM playgrounds' \
     --config apps/web/cloudflare/wrangler.site.jsonc
   bunx wrangler d1 execute irisout-playground-restore --remote \
     --command 'SELECT COUNT(*) AS total, SUM(deleted_at IS NOT NULL) AS deleted FROM playgrounds' \
     --config apps/web/cloudflare/wrangler.restore.jsonc
   ```

   併せて、バックアップ取得時に運用記録へ保存した件数と比較する。Cloudflare D1の取込み上限により一括実行できない場合は、Cloudflareの案内に従ってSQLを分割し、同じ照合を行う。

5. Workerを復元先DBへ向ける。`wrangler.site.jsonc`の`database_name`と`database_id`を新DBに変更し、Git差分を確認してからサイトWorkerをdeployする。

   ```bash
   bun run --cwd apps/web deploy:cloudflare:site
   ```

6. 公開サイトの既知の共有ページを開き、本文が表示されることと削除済み共有ページが404になることを確認する。API経由の新規保存と削除も確認し、復元先へ書き込まれたことをD1件数で確かめる。

7. 切替前のDBは削除せず、切替の確認期間中は保全する。問題があれば設定の`database_id`を元へ戻して再deployする。復元用の一時設定ファイルとSQLは、運用記録を残して保管期限後に安全に削除する。

## 直近の誤操作を戻す

Time Travelは指定時点の状態で同じDBを置き換える。現在データも復旧用SQLへ先に退避し、戻したい時刻のbookmarkと現在のbookmarkを照合する。

```bash
bunx wrangler d1 time-travel info irisout-playground \
  --config apps/web/cloudflare/wrangler.site.jsonc
```

運用記録とbookmarkが一致し、影響範囲を確認した後にだけ復元する。

```bash
bunx wrangler d1 time-travel restore irisout-playground \
  --bookmark BOOKMARK \
  --config apps/web/cloudflare/wrangler.site.jsonc
```

復元後は上記の公開ページ、削除済みページ、保存APIを確認する。Time Travelは指定時点より後の変更を失わせるため、その変更を保持する必要がある場合は別DBへのSQL復元を使う。

## 復旧確認の記録

少なくとも半年に1回、隔離したD1へSQLを復元し、行数、削除状態、共有ページ表示、削除後の404を確認する。日付、Wranglerの版、バックアップのハッシュ、確認結果、所要時間を残す。復元を実施できなかった場合は原因と再試行日を記録する。
