## Context

既存のコンパイラは`compileProject(entry, { target: 'ssr' })`で要求単位の`render(input)`とブラウザー用`hydrateComponent(container, state)`を生成する。SSRの入力とstateはJSON値に限定され、相対moduleと外部moduleは現在のscope limitで拒否される。Vite連携は`compileProject`の依存一覧を監視して仮想moduleを提供する。

ファイル経路はNode側で走査する必要があるが、ブラウザーの照合表へNodeのfsやHonoを持ち込んではならない。HTMLの外枠は利用側が組み立てるため、経路サブルーターはページのHTMLとstate、および遷移用のJSON応答を返す。

## Goals / Non-Goals

**Goals:**

- `page.jsx`の現在のファイル集合から決定的な経路表を生成する。
- 同じ経路表と照合規則をHono側とブラウザー側で使う。
- 各要求でloaderとSSRを独立して実行し、loaderのJSON結果だけをstateの入力として搬送する。
- 生成されたクライアントmoduleからHono、fs、loader実装を排除する。
- 既存の`irisout/ssr`契約を壊さずに、ファイル経路を追加する。

**Non-Goals:**

- 入れ子layout、先読み、状態保持、APIのファイル自動登録、catch-all経路。
- HTML文書全体の標準構造をサブルーター側で決めること。
- SSRで現在拒否されている記法やmodule境界を解禁すること。

## Decisions

### 経路定義を純粋な表とNode走査へ分ける

`packages/routes/src/index.ts`は、経路定義の正規化、静的優先の並べ替え、衝突検査、URL照合、クライアント遷移を提供する。`node.ts`だけがfsを使い、`page.jsx`の親ディレクトリを`/`、`/users`、`/users/:id`へ変換する。これによりクライアント用bundleは純粋な経路表だけを含む。

代替案としてHonoのroute matcherをブラウザーでも使う案は採用しない。サーバーとブラウザーで正規化や復号の結果がずれるためである。

### Honoはcatch-allのサブルーターとして提供する

`irisout/hono`は指定ディレクトリを生成時に走査し、各pageをSSR targetでコンパイルして、Honoのサブルーターへcatch-all handlerを登録する。`prefix`を経路表のbasePathへ入れ、利用側は`app.route('/', router)`またはHonoのmount pathと対応するprefixを指定する。未一致は別ページへ補正せず404にする。

代替案としてpageごとにHono routeを登録する案は採用しない。Hono内部の優先順位と経路照合を二重に持つため、動的経路の衝突・復号・末尾斜線の契約を共通化できない。

### SSR生成物を要求ごとに評価する

router作成時にコンパイル結果からrender関数を準備するが、renderの入力、loaderの結果、stateはhandlerの呼び出しごとに作る。loader contextには`params`、`search`、`request`を渡し、loaderが返すJSON値だけをrender入力へ渡す。loaderがないpageは空入力でrenderする。

SSR結果は直接要求なら利用側の`document`関数へ渡し、指定がなければpage HTMLを返す。遷移要求は`type: 'page'`、`routeId`、`html`、`state`だけのJSONを返す。not-found、redirect、errorはHTTP状態と限定した応答へ分け、正常pageのstateや内部例外文を返さない。

### loaderの結果は明示的な制御結果と分ける

通常のJSON値はpage入力とし、`notFound()`と`redirect(location, status?)`はloaderの制御結果とする。例外は500へ変換する。制御結果をJSON入力としてpageへ渡さないことで、404・転送を正常ページとして描画しない。

### Viteの仮想moduleがクライアント経路を起動する

`irisoutRoutes({ directory, prefix, container })`を`irisout/vite`へ追加する。pluginはpage集合を走査し、各pageをclient targetでコンパイルした仮想page moduleと、純粋なclient route tableを生成する。仮想入口は初回のstate scriptを読み、対応pageの`hydrateComponent`を一度だけ呼ぶ。遷移時は`createRouteNavigator`へHTML、state、page moduleの対応を渡す。

ファイル追加・削除・名前変更はdirectoryの変更として再走査し、仮想moduleとwatch対象を更新してfull reloadする。削除済みpageは生成moduleと経路表から除く。

### 遷移は標準動作を保つ境界を先に判定する

同一生成元、通常の左クリック、対象経路、同一文書内のfragmentでない操作だけを管理する。外部、download、別tab、修飾キー、対象外経路はブラウザーへ委ねる。取得と描画には開始順序の世代番号を付け、最後に開始した遷移だけが履歴とDOMを更新する。取得または描画の失敗は対象URLへの通常文書遷移へ戻す。

## Risks / Trade-offs

- [Honoのmount prefixとpluginのprefixが不一致になる] → `prefix`をserver/client両方の公開optionにし、既定値を`/`へ固定して利用例と統合試験で対応を確認する。
- [SSR生成moduleの評価失敗が実行時に現れる] → 既存`compileProject(..., { target: 'ssr' })`の診断をrouter作成時に伝播し、handler内の入力・loader失敗は内部情報を隠した500へ変換する。
- [連続遷移で古い描画が残る] → AbortControllerと世代番号に加え、DOM更新を直列化し、古いpage handleを破棄する。
- [初回state scriptのJSONがHTML文脈を壊す] → 既存`serializeSsrState`を使い、`<`、`>`、`&`、Unicode行区切りをescapeする。
- [ファイル走査をbundleへ混ぜる] → Node入口を`routes/node`内部へ限定し、client仮想moduleには定義のJSONだけを埋め込む。

## Migration Plan

既存利用者は変更なしで`irisout/vite`と`irisout/ssr`を使える。新機能利用者は`hono`をpeer依存として導入し、serverで`irisout/hono`、Viteでファイル経路pluginと仮想入口を追加する。問題がある場合は新しいpluginとrouterの登録を外し、既存の単一部品入口へ戻せる。公開bundleと宣言の構築後、既存テストと新しい統合試験を実行する。
