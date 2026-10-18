# 公開版の試行B 記録

入力: brief.mdとpublic-docs-v2のみ。npm irisout@0.3.7を使用。前の試行、実装ソース、解答例を参照していない。検査上限5回。作業先はpublished-app-b。

## 読んだ文書と判断

- getting-started.md: 「公開版0.3.7では、`render()`より前に`const requests = { active: true }`のような通常の変数宣言は置けない。」要求番号と生存状態をsignalで宣言。
- authoring-state.md: 「部品が生きている間に保持する要求番号や生存状態は、表示に直接使わない値も`signal`で宣言する。」一覧にrequestIdとactiveを保持。
- events-and-actions.md: 「非同期処理もイベント関数に置ける。古い要求の取り消しや競合結果の選択はアプリ側で管理する。」入力ごとに番号を増やし、現行番号かつ生存中だけ反映。Promiseのthen/catchで処理する点はJavaScriptの知識から判断。
- events-and-actions.md: 「公開版では内部の監視関数に`const`のアロー関数を使う。」監視関数をconstアローにし、同じ関数をremoveEventListenerへ渡す。
- lifecycle-and-context.md: 「`onMount`はDOMの接続後に一度実行される。返した関数は破棄時に一度実行される。」localStorage読出しをonMount内へ配置。
- diagnostics-and-limits.md: 「要求単位SSRではサーバーでイベント、ライフサイクル、`use`を実行しない。」保存処理もイベント内へ配置。
- hono-file-routing.md: 「通常の同一配信元リンクはクライアント遷移の対象になり」ページ間は通常のa要素で接続。
- hono-file-routing.md: 「静的配信を外側のHonoアプリへ先に登録することで、ページルーターの未検出処理に渡る前に生成物を返す。」本番生成物配信節を採用し、PORTを課題指定のDOGFOOD_PORTに変更。
- conditionals-and-lists.md: 「各項目のルートへ安定した`key`を指定する。」項目IDをkeyに使用。

## 初期作成

Bun 1.4.3。依存指定: irisout 0.3.7 / vite-plus 0.3.0 / TypeScript ~5.9.0 / Hono ^4.0.0。型検査範囲はgetting-started.mdの「型検査はirisoutが解析する`.jsx`だけを対象にする。」に従った。HonoのサーバーTSは対象外。
作成: package.json, tsconfig.json, vite.config.ts, Layout.jsx, server/app.ts, server/start.ts, routes/page.jsx, routes/incidents/[id]/page.jsx。
作業ディレクトリ作成前のexecがNo such file or directoryで失敗。ファイル作成前であり検査回数には数えない。

導入コマンド: BUN_INSTALL_CACHE_DIR=/tmp/irisout-published-bun-cache bun install
bun install v1.4.3 (c6da4a4d3)
Resolving dependencies
Resolved, downloaded and extracted [180]
warn: DNSResolveFailed downloading package manifest fsevents

error: DNSResolveFailed downloading package manifest yuku-parser

error: DNSResolveFailed downloading package manifest lightningcss

error: DNSResolveFailed downloading package manifest pngjs

error: DNSResolveFailed downloading package manifest @testing-library/dom

error: DNSResolveFailed downloading package manifest @standard-schema/spec

error: DNSResolveFailed downloading package manifest estree-walker

error: DNSResolveFailed downloading package manifest why-is-node-running

error: DNSResolveFailed downloading package manifest convert-source-map

error: DNSResolveFailed downloading package manifest expect-type

error: DNSResolveFailed downloading package manifest tinyrainbow

error: DNSResolveFailed downloading package manifest yuku-codegen

error: DNSResolveFailed downloading package manifest tinyexec

error: DNSResolveFailed downloading package manifest picomatch

error: DNSResolveFailed downloading package manifest @testing-library/user-event

error: DNSResolveFailed downloading package manifest postcss

error: DNSResolveFailed downloading package manifest obug

error: DNSResolveFailed downloading package manifest vite

error: DNSResolveFailed downloading package manifest ws

error: DNSResolveFailed downloading package manifest sirv

error: DNSResolveFailed downloading package manifest magic-string

error: DNSResolveFailed downloading package manifest es-module-lexer

error: DNSResolveFailed downloading package manifest chai

error: DNSResolveFailed downloading package manifest @types/chai

error: DNSResolveFailed downloading package manifest pathe

error: DNSResolveFailed downloading package manifest std-env

error: DNSResolveFailed downloading package manifest tinybench

error: DNSResolveFailed downloading package manifest tinyglobby

error: DNSResolveFailed downloading package manifest typescript

error: DNSResolveFailed downloading package manifest hono
error: typescript@~5.9.0 failed to resolve
error: hono@^4.0.0 failed to resolve
error: postcss@^8.5.6 failed to resolve
error: yuku-parser@^0.5.44 failed to resolve
error: lightningcss@^1.33.0 failed to resolve
error: yuku-codegen@^0.5.44 failed to resolve
error: @testing-library/dom@^10.4.1 failed to resolve
error: @testing-library/user-event@^14.6.1 failed to resolve
error: obug@^2.1.1 failed to resolve
error: vite@^6.0.0 || ^7.0.0 || ^8.0.0 failed to resolve
error: pathe@^2.0.3 failed to resolve
error: std-env@^4.0.0-rc.1 failed to resolve
error: tinyexec@^1.0.2 failed to resolve
error: picomatch@^4.0.3 failed to resolve
error: tinybench@^2.9.0 failed to resolve
error: tinyglobby@^0.2.15 failed to resolve
error: expect-type@^1.3.0 failed to resolve
error: tinyrainbow@^3.1.0 failed to resolve
error: magic-string@^0.30.21 failed to resolve
error: es-module-lexer@^2.0.0 failed to resolve
error: why-is-node-running@^2.3.0 failed to resolve
error: tinyrainbow@^3.1.0 failed to resolve
error: pathe@^2.0.3 failed to resolve
error: magic-string@^0.30.21 failed to resolve
error: tinyrainbow@^3.1.0 failed to resolve
error: convert-source-map@^2.0.0 failed to resolve
error: pathe@^2.0.3 failed to resolve
error: magic-string@^0.30.21 failed to resolve
error: estree-walker@^3.0.3 failed to resolve
error: chai@^6.2.2 failed to resolve
error: @types/chai@^5.2.2 failed to resolve
error: tinyrainbow@^3.1.0 failed to resolve
error: @standard-schema/spec@^1.1.0 failed to resolve
error: ws@^8.19.0 failed to resolve
error: sirv@^3.0.2 failed to resolve
error: pngjs@^7.0.0 failed to resolve
error: tinyrainbow@^3.1.0 failed to resolve
error: magic-string@^0.30.21 failed to resolve
bun install v1.4.3 (c6da4a4d3)
Resolving dependencies
Resolved, downloaded and extracted [57]
Saved lockfile

- typescript@5.9.3 (v7.0.2 available)
- hono@4.13.13
- irisout@0.3.7
- vite-plus@0.3.0

96 packages installed [371.00ms]

DNSResolveFailedは環境制約として扱い、指定の依存導入だけrequire_escalatedで再実行し成功。導入済みirisout実装JSは開いていない。

## 検査1

コマンド: bun run typecheck、bun run build。型検査成功時のみ構築へ進む。
$ tsc --noEmit
$ vp build
transforming...
✓ 7 modules transformed.
rendering chunks...
computing gzip size...
dist/assets/.irisout-virtual_3Airisout-routes_3Apage_3A_252Fincidents_252F_253Aid-pESkA_dS.js 3.35 kB │ gzip: 1.27 kB
dist/assets/.irisout-virtual_3Airisout-routes_3Apage_3A_252F-Cayc4eVM.js 3.87 kB │ gzip: 1.67 kB
dist/irisout-client.js 11.39 kB │ gzip: 4.26 kB

✓ built in 62ms

本番起動: DOGFOOD_PORT=4317 bun run serve。
通常sandboxで EPERM: operation not permitted, listen / syscall: listen / errno: -1 / code: EPERM。アプリ不具合ではなく環境制約。require_escalatedで同コマンドを実行し http://127.0.0.1:4317 の起動成功。
$ bun selfcheck.mjs
TypeError: EPERM: Was there a typo in the url or port?
path: "http://127.0.0.1:4317/",
errno: 0,
code: "EPERM"

Bun v1.4.3 (Linux x64)
error: script "selfcheck" exited with code 1
$ bun selfcheck.mjs
PASS SSR一覧が3件の件名を含む
1 | import { chromium } from '/home/nixos/ghq/github.com/mikan-919/irisout/packages/bench/node_modules/playwright/index.mjs'
2 | const url = 'http://127.0.0.1:' + (process.env.DOGFOOD_PORT ?? '4317')
3 | const assert = (condition, message) => { if (!condition) throw new Error(message); console.log('PASS ' + message) }
^
error: SSR詳細が件名を含む
at assert (/tmp/irisout-improvement-2026-10-18/published-app-b/selfcheck.mjs:3:68)
at /tmp/irisout-improvement-2026-10-18/published-app-b/selfcheck.mjs:8:1

Bun v1.4.3 (Linux x64)
error: script "selfcheck" exited with code 1

検査1結果: 型検査と構築成功。通常sandboxで自己検査HTTPがEPERMとなり、require_escalatedで再実行。SSR一覧の3件件名は成功、詳細SSRで失敗し自己検査停止。原文: `error: SSR詳細が件名を含む`。curl -i http://127.0.0.1:4317/incidents/i1 は `HTTP/1.1 500 Internal Server Error` / `Internal Server Error`。この時点で成功を主張しない。

原因調査: Honoのapp.onErrorでconsole.errorを追加してサーバー側の例外を記録する。この診断処理は通常のHono APIの知識から判断。
HTTP/1.1 500 Internal Server Error
Content-Type: text/plain; charset=UTF-8
Date: Sun, 18 Oct 2026 15:15:48 GMT
Content-Length: 21

Internal Server ErrorHTTP/1.1 500 Internal Server Error
Content-Type: text/plain; charset=UTF-8
Date: Sun, 18 Oct 2026 15:16:04 GMT
Content-Length: 21

Internal Server Error28031 | let r = e.startsWith("compile:") ? e : `compile: ${e}`, i = oY(n ?? e, t);
28032 | super(`${r} [${i.filePath}:${i.line}:${i.column}]`, { cause: n }), this.name = "CompileDiagnostic", this.filePath = i.filePath, this.line = i.line, this.column = i.column;
28033 | }
28034 | };
28035 | function cY(e, t) {
28036 | return e instanceof sY ? e : new sY(e instanceof Error ? e.message : String(e), t, e);
^
CompileDiagnostic: compile: build-time execution failed: incident is not defined [/tmp/irisout-improvement-2026-10-18/published-app-b/Layout.jsx:1:1]
filePath: "/tmp/irisout-improvement-2026-10-18/published-app-b/Layout.jsx",
line: 1,
column: 1,

      at cY (/tmp/irisout-improvement-2026-10-18/published-app-b/node_modules/irisout/dist/index.js:28036:35)
      at uX (/tmp/irisout-improvement-2026-10-18/published-app-b/node_modules/irisout/dist/index.js:29061:9)

28466 | `return \`${u}\`;`
28467 | 		].join("\n"), n = Function("signal", "derived", "__esc__", "__escAttr__", "__input__", e), r = (e) => String(e).replace(/&/g, "&amp;").replace(/</g, "&lt;"), a = (e) => String(e).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
28468 | 		try {
28469 | 			me = n(uY, dY, r, a, {});
28470 | 		} catch (e) {
28471 | 			throw Error(`compile: build-time execution failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
^
error: compile: build-time execution failed: incident is not defined
at kY (/tmp/irisout-improvement-2026-10-18/published-app-b/node_modules/irisout/dist/index.js:28471:10)
at uX (/tmp/irisout-improvement-2026-10-18/published-app-b/node_modules/irisout/dist/index.js:29059:10)
at /tmp/irisout-improvement-2026-10-18/published-app-b/[eval]:1:51

ReferenceError: incident is not defined
at anonymous (file:///tmp/irisout-improvement-2026-10-18/published-app-b/node_modules/irisout/dist/index.js:4:27)
at kY (/tmp/irisout-improvement-2026-10-18/published-app-b/node_modules/irisout/dist/index.js:28469:9)
at uX (/tmp/irisout-improvement-2026-10-18/published-app-b/node_modules/irisout/dist/index.js:29059:10)
at /tmp/irisout-improvement-2026-10-18/published-app-b/[eval]:1:51

Bun v1.4.3 (Linux x64)
[ "code", "map", "initialHtml", "ssrCode", "isDocument", "markers", "signalToMarkers", "declName",
"dependencies"
]
import { signal, derived } from 'irisout/runtime';

function **irisout_clone_json**(value) {
const seen = new Set();
const fail = (message) => { throw new TypeError(message); };
const visitObject = (current) => {
const prototype = Object.getPrototypeOf(current);
if (prototype !== Object.prototype && prototype !== null) fail('SSR input must contain plain JSON objects');
for (const key of Reflect.ownKeys(current)) {
if (typeof key !== 'string') fail('SSR input must not contain symbol properties');
if (key === 'toJSON') fail('SSR input must not contain toJSON properties');
const descriptor = Object.getOwnPropertyDescriptor(current, key);
if (!descriptor || !descriptor.enumerable || descriptor.get || descriptor.set) fail('SSR input must contain data properties only');
visit(current[key]);
}
};
const visitArray = (current) => {
if (Object.getPrototypeOf(current) !== Array.prototype) fail('SSR input must contain ordinary arrays');
for (const key of Reflect.ownKeys(current)) {
if (key === 'length') continue;
if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= current.length) fail('SSR input arrays must contain indexed values only');
const descriptor = Object.getOwnPropertyDescriptor(current, key);
if (!descriptor || !descriptor.enumerable || descriptor.get || descriptor.set) fail('SSR input must contain data properties only');
visit(current[Number(key)]);
}
};
const visit = (current) => {
if (current === null || typeof current === 'string' || typeof current === 'boolean') return;
if (typeof current === 'number') {
if (!Number.isFinite(current)) fail('SSR input must contain finite JSON numbers');
return;
}
if (typeof current !== 'object') fail('SSR input must contain JSON-serializable values');
if (seen.has(current)) fail('SSR input must not contain cycles');
seen.add(current);
if (Array.isArray(current)) visitArray(current);
else visitObject(current);
seen.delete(current);
};
visit(value);
const encoded = JSON.stringify(value);
if (encoded === undefined) fail('SSR input must be JSON-serializable');
return JSON.parse(encoded);
}

export function render(**rawInput**) {
const **input** = **irisout_clone_json**(arguments.length === 0 ? {} : **rawInput**);
const { incident } = **input**;
const **signal_state** = Object.create(null);
const **irisout_signal** = (initial, id) => { const accessor = signal(initial, id); **signal_state**[id] = accessor(); return accessor; };
const id = **irisout_signal**(incident.id, "decl_0_331_id");
const title = **irisout_signal**(incident.title, "decl_0_365_title");
const resolved = **irisout_signal**(incident.resolved, "decl_0_405_resolved");
const memo = **irisout_signal**('', "decl_0_451_memo");
const received = **irisout_signal**(0, "decl_0_478_received");
const error = **irisout_signal**('', "decl_0_508_error");
const active = **irisout_signal**(true, "decl_0_536_active");
const **esc** = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const **escAttr** = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const html = `<html lang="ja"><head><meta charset="utf-8"></meta><meta name="viewport" content="width=device-width, initial-scale=1"></meta><title data-iris-id="m0">${__esc__(title())}</title></head><body><header><a href="/">障害対応ボード</a></header><main><h1 data-iris-id="m1">${__esc__(title()())}</h1><p role="status" data-iris-id="m2">${__esc__(resolved() ? '解決済み' : '対応中')}</p><button type="button" data-iris-id="m3">解決する</button><p role="alert" data-iris-id="m4">${__esc__(error())}</p><label>作業メモ<input value="${__escAttr__(memo())}" data-iris-id="m5"></input></label><p data-iris-id="m7">監視中 <output aria-label="受信数" data-iris-id="m6">${__esc__(received())}</output></p><a href="/">一覧へ戻る</a></main></body></html>`;
return { html, state: { **irisout_state**: true, input: **input**, signals: **irisout_clone_json**(**signal_state**) } };
}

55 | const received = **irisout_signal**(0, "decl_0_478_received");
56 | const error = **irisout_signal**('', "decl_0_508_error");
57 | const active = **irisout_signal**(true, "decl_0_536_active");
58 | const **esc** = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');
59 | const **escAttr** = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
60 | const html = `<html lang="ja"><head><meta charset="utf-8"></meta><meta name="viewport" content="width=device-width, initial-scale=1"></meta><title data-iris-id="m0">${__esc__(title())}</title></head><body><header><a href="/">障害対応ボード</a></header><main><h1 data-iris-id="m1">${__esc__(title()())}</h1><p role="status" data-iris-id="m2">${__esc__(resolved() ? '解決済み' : '対応中')}</p><button type="button" data-iris-id="m3">解決する</button><p role="alert" data-iris-id="m4">${__esc__(error())}</p><label>作業メモ<input value="${__escAttr__(memo())}" data-iris-id="m5"></input></label><p data-iris-id="m7">監視中 <output aria-label="受信数" data-iris-id="m6">${__esc__(received())}</output></p><a href="/">一覧へ戻る</a></main></body></html>`;

TypeError: title() is not a function. (In 'title()()', 'title()' is "決済API停止")
at render (/tmp/irisout-improvement-2026-10-18/published-app-b/detail-generated-ssr.mjs:60:292)
at /tmp/irisout-improvement-2026-10-18/published-app-b/[eval]:1:68

詳細SSRの調査コマンド:

- 公開API型: cat node_modules/irisout/dist/index.d.ts / dist/hono.d.ts。実装JSは開いていない。
- bun -e で公開compileProject("routes/incidents/[id]/page.jsx", {target:"ssr"})を実行し、自分のJSXからのSSR生成物をdetail-generated-ssr.mjsへ保存。
- target省略では`compile: build-time execution failed: incident is not defined`。型宣言の `target?: 'client' | 'ssr'` を根拠にssrを指定。
- SSR生成物のh1は `${__esc__(title()())}` となっていた。Layoutのprops名titleと、詳細のsignal名titleが一致している。本文ではtitle()を一度だけ呼んでいる。
- 生成物renderを同じ入力で実行してTypeErrorを再現。repro-detail-before.jsxへ当時の記述を保存。

暫定分類: 本体不具合。部品のprops置換が同名signalの呼び出しへ及んだと推測。公開文書に同名回避条件はない。回避策として詳細signalをsubjectへ変更。これは文書による指示ではなく生成物からの推測。初回SSR失敗を検査1の失敗として数える。

## 検査2

コマンド: bun run typecheck、bun run build、bun run selfcheck。
$ tsc --noEmit
$ vp build
failed to load config from /tmp/irisout-improvement-2026-10-18/published-app-b/vite.config.ts
error during build:
Error: compile: irisoutHono found no createFileRouter routes (scope limit)
at M (file:///tmp/irisout-improvement-2026-10-18/published-app-b/node_modules/irisout/dist/hono-vite.js:393:28)
at file:///tmp/irisout-improvement-2026-10-18/published-app-b/node_modules/.vite-temp/vite.config.ts.timestamp-1792336597786-2d4adf4b29821.mjs:54:12
at ModuleJob.run (node:internal/modules/esm/module_job:561:25)
at async node:internal/modules/esm/loader:647:26
at async loadConfigFromBundledFile (file:///tmp/irisout-improvement-2026-10-18/published-app-b/node_modules/@voidzero-dev/vite-plus-core/dist/vite/node/chunks/node.js:42370:12)
at async bundleAndLoadConfigFile (file:///tmp/irisout-improvement-2026-10-18/published-app-b/node_modules/@voidzero-dev/vite-plus-core/dist/vite/node/chunks/node.js:42220:21)
at async loadConfigFromFile (file:///tmp/irisout-improvement-2026-10-18/published-app-b/node_modules/@voidzero-dev/vite-plus-core/dist/vite/node/chunks/node.js:42180:42)
at async resolveConfig (file:///tmp/irisout-improvement-2026-10-18/published-app-b/node_modules/@voidzero-dev/vite-plus-core/dist/vite/node/chunks/node.js:41786:22)
at async createBuilder (file:///tmp/irisout-improvement-2026-10-18/published-app-b/node_modules/@voidzero-dev/vite-plus-core/dist/vite/node/chunks/node.js:39568:17)
at async CAC.<anonymous> (file:///tmp/irisout-improvement-2026-10-18/published-app-b/node_modules/@voidzero-dev/vite-plus-core/dist/vite/node/cli.js:765:19)
error: script "build" exited with code 1

検査2結果: 型検査成功、構築失敗。原文: `Error: compile: irisoutHono found no createFileRouter routes (scope limit)`。原因調査用に追加したpages.onErrorがルートの認識に影響したと推測。Hono標準APIでの診断追加がirisoutのメタ情報と両立する条件は公開文書にない。診断処理を取り除き、文書の経路接続へ戻す。暫定分類: アプリ変更による失敗、および文書不足。

## 検査3

コマンド: bun run typecheck、bun run build、bun run selfcheck。
$ tsc --noEmit
$ vp build
transforming...
✓ 7 modules transformed.
rendering chunks...
computing gzip size...
dist/assets/.irisout-virtual_3Airisout-routes_3Apage_3A_252Fincidents_252F_253Aid-Dd-q5CVa.js 3.35 kB │ gzip: 1.27 kB
dist/assets/.irisout-virtual_3Airisout-routes_3Apage_3A_252F-Cayc4eVM.js 3.87 kB │ gzip: 1.67 kB
dist/irisout-client.js 11.39 kB │ gzip: 4.26 kB

✓ built in 61ms
$ bun selfcheck.mjs
PASS SSR一覧が3件の件名を含む
PASS SSR詳細が件名を含む
PASS 存在しない詳細は404
PASS API失敗は503
PASS API遅延 決済: 605ms
PASS API遅延 通知: 31ms
PASS 600ms対30msの競合で通知だけ残る
PASS 503を表示し次の検索で回復
PASS ブラウザー遷移は文書再読み込みなし
PASS 監視登録時の受信数0
PASS 詳細の監視登録は1
PASS 監視イベント受信で表示更新
PASS 詳細から一覧への遷移で監視解除
PASS 一覧が更新を反映
PASS 再読み込みでも更新を反映
PASS i2のメモはi1と分離
PASS i1のメモを遷移後に復元
PASS メモを再読み込み後に復元
PASS 反復詳細の監視登録1 回0
PASS 反復詳細のイベント1 回0
PASS 反復一覧の監視登録0 回0
PASS 反復詳細の監視登録1 回1
PASS 反復詳細のイベント1 回1
PASS 反復一覧の監視登録0 回1
PASS 反復詳細の監視登録1 回2
PASS 反復詳細のイベント1 回2
PASS 反復一覧の監視登録0 回2
PASS 離れた一覧の応答が詳細を書き換えない
PASS ブラウザー例外なし:
ALL 8 REQUIREMENTS SELF-CHECKED

検査3結果: 型検査、本番構築、自己検査の8項目が成功。ブラウザー例外なし。自己検査には登録関数をSetで追跡する事前スクリプトを使い、詳細で1、一覧で0、再入場後に1イベントあたり1更新を3周確認した。初期化の時点では受信数0だった。

診断用最小再現: bun repro/check.mjs。これはアプリの変更・再検査ではなく、検査1の原因を親が再確認できるよう独立した2つのJSXへ縮めたもの。自分の生成物だけを読み書きする。
49 | const **signal_state** = Object.create(null);
50 | const **irisout_signal** = (initial, id) => { const accessor = signal(initial, id); **signal_state**[id] = accessor(); return accessor; };
51 | const title = **irisout_signal**(incident.title, "decl_0_177_title");
52 | const **esc** = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');
53 | const **escAttr** = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
54 | const html = `<html><head><title data-iris-id="m0">${__esc__(title())}</title></head><body><h1 data-iris-id="m1">${__esc__(title()())}</h1></body></html>`;
^
TypeError: title() is not a function. (In 'title()()', 'title()' is "決済API停止")
at render (/tmp/irisout-improvement-2026-10-18/published-app-b/repro/generated.mjs:54:132)
at /tmp/irisout-improvement-2026-10-18/published-app-b/repro/check.mjs:6:15

最小再現結果: `TypeError: title() is not a function. (In 'title()()', 'title()' is "決済API停止")`。repro/generated.mjsのh1も二重呼び出しを含む。最小再現は不具合の証拠として意図的に終了コード1となる。

report.mdを作成。3回目成功後のアプリ変更なし。本番サーバーを停止し、同じDOGFOOD_PORTで初期状態へ再起動して独立操作役へ渡す。
[{"id":"i1","title":"決済API停止","resolved":false},{"id":"i2","title":"通知遅延","resolved":false},{"id":"i3","title":"検索障害","resolved":false}]
最終サーバー: http://127.0.0.1:4317 / 起動セッション93634 / DOGFOOD_PORT=4317 bun run serve。再起動後GET /api/incidentsで3件ともresolved:falseを確認。リポジトリには変更を加えていない。親の作業状態があるためGitコミットは行わない。終了前git status --short --branchを実行した。
