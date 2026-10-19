# 関数値と生成名の境界

2026-10-18〜19に、公開版の試用Bで見つけた2件を現行ソースで修正し、通常のJavaScriptの拒否を4群で縮めた。npm公開版0.3.7の内容や観測記録は変更していない。ソース版の設計判断は[ADR-0071](../adr/0071-static-function-values.md)、再実行は[検査器](../../fixtures/javascript-boundaries/README.md)を参照する。

## 公開版で見つかった2件

| 問題                                                                 | 現行ソースでの原因と修正                                                                                                                                                      | 検証・確定                                                                                           |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Layoutのprops名`title`と親signal名`title`が重なると`title()()`になる | childrenを挿入後にpropsの束縛を再解析し、親の参照まで子のpropsとして捕捉していた。挿入前に保存した各propsの参照だけを置換する。                                               | 保存した相対モジュールのSSRを実行し、交差するpropsと仮引数順の違いをmount/hydrateで検証。`4d76f9c`。 |
| 子ルーターへ`onError`を設定すると経路を検出できない                  | Honoの`route()`が独自のエラー処理を持つ子の処理関数を包む。導入版の`hono/hono-base`が公開するSymbol、または現行版で確認した文字列キーを辿り、元の処理関数から経路情報を読む。 | 二段の`onError`と接頭辞を持つ経路生成とSSR応答を実行。`06ea699`。                                    |

公開版の保存物と回避は[Layoutの記録](../issues-drafts/published-layout-signal-name-collision.md)、[onErrorの記録](../issues-drafts/published-on-error-route-detection.md)にある。`createFileRouter`はSSR例外を500応答へ変換するため、`onError`を付けてもその例外が届くとは限らない。該当ページの`ssrCode`を同じ入力で実行して例外を調べる手順を利用文書へ追加した。

## 対応した4群

[変更前](./evidence/2026-10-19-javascript-boundaries-before.json)は`06ea699`から取り出したソース、[変更後](./evidence/2026-10-19-javascript-boundaries-after.json)は今回のソースへ同じ最小例を渡した結果である。前は4例とも拒否、後は4例とも生成物を実行して表示`1`と後始末を確認した。

| 群                   | 最小形                                                         | 対応条件と意味の保持                                                                                                                                                                                                                              |
| -------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| const別名            | `function write() { count(1); } const alias = write; alias();` | 再代入しない関数宣言・関数初期値へconst別名を辿る。複数段の別名、局所関数、動きゾーンの関数、相対モジュールの補助関数を扱う。宣言を移動せず、別名の宣言前参照を保持する。                                                                         |
| 引数経由の呼出し     | `function invoke(fn) { return fn(); } invoke(write);`          | 所有関数の参照を直接呼出しとconst別名から列挙し、対応する全実引数が同じ本体へ解決する場合に扱う。引数の転送、読取り依存、書込み候補、非同期補助関数を同じ解決へ接続する。呼出しと実引数の評価は保持する。                                         |
| 保存した後始末の返却 | `const cleanup = () => ...; return cleanup;`                   | `onMount`・`effect`の後始末、`use`の局所更新関数と`{ update, destroy }`を扱う。const別名、閉包、finally、宣言前参照、通常実行との共用を保持する。後始末の関数から親のDOM更新を実行しない。                                                        |
| 生成名との衝突       | `function __container__() { count(1); }`                       | 作者の局所束縛と大域参照を一時名で分離し、生成後に内部束縛だけを移して作者名を戻す。関数の`name`・`length`、オブジェクトとSSR入力の省略形のキー、局所状態、イベント引数を保持する。相対モジュールの補助宣言とコンテキスト既定値も同じ処理へ通す。 |

`function-binding.ts`が束縛から関数本体へ解決する処理を共有し、既存の関数本体変換を使う。後始末用の生成物は元の定義範囲へ置き、const別名を評価してから呼出先を選ぶ。別名の初期値や監視解除へ渡す参照は変えない。コンパイラのための実行時の関数表、購読機構、動的ディスパッチは追加していない。

## 残る制限と根拠

- 再代入される関数は一つの本体へ解決しない。`function one() {}; one = other; const alias = one; alias();`、仮引数への再代入、`let`別名の呼出しを診断する。代入の実行順序を無視して最初の関数へ固定しない。
- 同じ仮引数へ異なる関数を渡す形、動的な条件で選んだ関数値、spread、所有関数を外部へ渡す形は診断する。識別子の仮引数を対象とし、分割代入・既定値・循環する仮引数転送を一般化してはいない。`function invoke(fn) { fn(); } invoke(one); invoke(two);`はその例である。
- 同期の動きゾーン関数を、本体を変換しない相対モジュールの補助関数や不透明な外部関数へ渡す形は診断する。`invoke(write)`をそのまま受理すると、呼出元の書込み候補へ届かず表示が更新されないためである。通常の局所コールバック自身の更新境界は従来どおり使う。
- 後始末へ関数引数を渡す場合、その仮引数の同一性・名前の観測や`removeEventListener`への受渡しは診断する。更新なしの関数を渡すことで、同一性を要求する処理の意味を変えないためである。引数を経由しない通常の監視解除と、後始末中に作ったconst別名での解除は保持する。
- 動的に選んだ後始末関数や、変数に保存した結果オブジェクト全体の返却は対象外。動きゾーンの同期補助関数そのものを`use`の更新関数として返す形も診断する。局所更新関数の本体から呼ぶ場合と反映境界が異なるためである。
- SSR入力名の`signal`・`derived`は、状態宣言APIの文字列による識別と重なるため診断を残す。`__`・`update_`の接頭辞、非公開の`mount`・`unmount`・`hydrateComponentInstance`、SSR内部の`html`は生成名と分離する。
- `irisout`の別名importを正規API名へ戻す際、同名のトップレベル束縛がある形は残る。`import { signal as state } from 'irisout'; function signal() { ... }`の衝突は、生成内部名との衝突とは分けて診断する。
- 既定引数、クラスフィールド初期値、計算メソッド名は本体の外の実行境界として残す。そこから局所関数や別名を呼び、状態へ到達する場合も拒否する。ジェネレーターも拒否を維持する。本体の終了処理をこれらへ流用していない。

以上の受理・拒否と実行結果は`javascript-boundaries.test.ts`、`multi-file-module-composition.test.ts`、既存の関数・初期化・SSR・ソース位置の試験で確認する。同期補助関数の呼出し開始による更新候補の過剰近似と、共有signalの設定関数自身の通知は既存の契約として残る。画像比較・性能比較・npm公開・Git送信は行っていない。

## 検証

生成物を実行する対象9ファイル202試験、`bun run check`、全56ファイル604試験、`bun run build`、`bun run build:packages`、`bun run pack:smoke`を直列実行し、成功した。記録は[対象試験](./evidence/2026-10-19-javascript-boundaries-targeted-tests.log)、[静的検査](./evidence/2026-10-19-javascript-boundaries-check.log)、[全試験](./evidence/2026-10-19-javascript-boundaries-tests.log)、[実例構築](./evidence/2026-10-19-javascript-boundaries-build.log)、[公開物構築](./evidence/2026-10-19-javascript-boundaries-packages.log)、[梱包物導入](./evidence/2026-10-19-javascript-boundaries-pack-smoke.log)にある。

同じ梱包物をHono 4.0.0と4.13.13へ隔離導入し、二段の`onError`経路の検出、HTTP 200、`hono/hono-base`の外部importの残存を確認した。[結果](./evidence/2026-10-19-hono-on-error-compatibility.json)を保存した。最初の`06ea699`で使った`hono/utils/handler`は4.0.0に存在せず、梱包した現行版の関数では古いSymbolへ到達できないため、実測した2形式を読む処理へ`83ddc70`で修正した。公開peerの`hono >=4.0.0`は維持した。梱包物の導入先は`/tmp/irisout-consumer-XYBv5S`、4.0.0の導入先は`/tmp/irisout-hono-v4`である。

[既存ハンドラー8項目](./evidence/2026-10-19-javascript-boundaries-handler-browser.json)、[既存初期化・後始末8項目](./evidence/2026-10-19-javascript-boundaries-lifecycle-browser.json)、[追加のmount/hydrate](./evidence/2026-10-19-javascript-boundaries-browser.json)をブラウザーで操作し、すべて成功した。ページ例外は0件。追加検査は別名・引数経由の同期/非同期更新、effectの依存、保存した更新・後始末、子の破棄後の親DOM更新の抑止、名前と引数数、一度だけの破棄を確認する。

指定されたNixストアのChromium 154は現環境に存在せず、[最初の起動](./evidence/2026-10-19-javascript-boundaries-handler-browser-unavailable.json)はページを開く前に失敗した。共有ライブラリーを設定する`/tmp/irisout-benchmark-chrome`を使い、Chrome for Testing 153.0.8010.12で実行した。追加検査器の[初回](./evidence/2026-10-19-javascript-boundaries-browser-first.json)は、最後の後始末について異なる所有者を跨ぐ総順序を誤って要求して失敗した。各所有者の一度だけの実行を検査する形へ直し、コンパイラは変更せずに再実行した。`bun run site:build`で9文書と3例も検査した。

注: ここでいう束縛は識別子が参照する宣言、宣言前参照はconstの初期化前に読み出す処理を指す。SSRは要求ごとにサーバーでHTMLを作る処理、hydrateは生成済みのDOMへブラウザーの処理を接続する処理である。
