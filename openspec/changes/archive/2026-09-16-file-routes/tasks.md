## 1. 経路定義

- [x] 1.1 `page.jsx`の走査、静的優先、動的衝突、URL正規化を実装し、ファイル経路の単体試験を通す
- [x] 1.2 サーバー専用情報を除いた`irisout/routes`の公開入口を追加し、client表の依存検査を通す

## 2. HonoとSSR

- [x] 2.1 `irisout/hono`の公開型、prefix、loader、notFound、redirect契約を実装し、公開宣言を生成する
- [x] 2.2 各pageをSSR targetへコンパイルし、要求ごとのloader入力と`render(input)`からHTML・stateを返す
- [x] 2.3 直接HTML、遷移JSON、404、redirect、500をHonoサブルーターで処理し、同時要求の分離を試験する

## 3. クライアント遷移

- [x] 3.1 Vite pluginからclient route table、page module、初回stateのhydrate入口を生成する
- [x] 3.2 管理対象リンク、履歴、検索引数変更、旧画面破棄、競合抑止、失敗時fallbackを実装する
- [x] 3.3 直接アクセス、hydrate、遷移、標準リンク動作、404、redirect、error、ファイル変更を統合試験する

## 4. 配布と互換性

- [x] 4.1 `irisout`のexports、Hono peer依存、package bundle・宣言・tarball検査を更新する
- [x] 4.2 既存SSR、Vite、型検査とOpenSpec検証を実行し、完了した仕様変更を記録する
