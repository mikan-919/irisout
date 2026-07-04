// マイルストーン 1-5 のコンパイラ:式の依存解析、props 伝播、コンポーネント
// 境界のインライン化、構造更新(条件分岐と keyed リスト)
// (docs/adr/0001-first-milestone.md)。
//
// パイプライン:
//   1. @babel/parser でソースを parse(静的 AST)。
//   2. トップレベルのコンポーネント関数をすべて列挙し、他から JSX タグとして
//      一度も参照されないものをルートとする(スコープ:ルートはちょうど1つ)。
//   3. ルートの render ツリーを深さ優先で辿る(src/compiler/render.js)。
//      `<Child prop={expr} />` の参照は再帰的にコンパイルされ、同じフラットな
//      宣言・マーカーのリストに合流する - これこそがインライン化:codegen が
//      走る時点では元のコンポーネント境界の痕跡はなく、共有スコープが1つ
//      あるだけ。インスタンス化サイトごとに固有の instanceId を振るので、
//      同じコンポーネントを2回使っても(`<Row n={1}/><Row n={2}/>`)、同じ
//      宣言のソース位置で衝突せず、完全に独立した signal が2組できる。
//        - prop の値が追跡済み signal/derived の裸の読み取り(例 `count()`、
//          追加の計算なし)なら、子の `prop('x')` はその同じ declId への
//          エイリアスになる。別のストレージは無いので、どちら側からの
//          書き込みも両側から見える - 「props 伝播」(と write-back)は
//          自動的に成立する。
//        - それ以外(リテラルや計算を含む式)は、子の `prop('x')` を独立した
//          `signal(expr)` に昇格する。
//   4. インスタンスは1つのフラット化された出力スコープを共有するため、
//      識別子が衝突しうる(2つのインスタンスが両方 `n` を宣言するなど)。
//      すべての signal/derived/昇格 prop に hygienic な出力名(`n`、次は
//      `n$1`、…)を割り当て、それを読む式の参照は使用箇所すべてで出力名に
//      書き換える - コンポーネント境界を跨いでも同様。
//   5. フラット化・計装済みスクリプトを Node 上で1回実行し、(a) タグ付けした
//      呼び出しサイトが本当に signal/derived であることを確認し(ADR 決定
//      #3)、(b) 実際の初期 HTML をタダで得る。
//   6. 依存グラフ(marker -> signal、derived 経由・インスタンス跨ぎ、
//      src/compiler/decl-graph.js)を構築し、ルート signal ごとに専用の
//      `update_<name>` 関数を生成する。その関数がその signal に依存する
//      すべてのマーカーを更新する。
//
// 条件レンダリング(`cond && <A/>` や `cond ? <A/> : <B/>`)は別*種*の
// マーカー:「構造」ユニット。ブランチは実マークアップなので textContent の
// 差し替えでは済まず、要素の属性ではなく常に存在するコメントアンカー
// (`<!--m2-->`)を持つ - コメントなら何も描画されていない間も生き残る。
// 何も描画しないブランチ(null/false、または単に非アクティブな側)は空の
// `<!---->` プレースホルダとして焼き込まれるので、アンカーの直後には常に
// ちょうど1つの兄弟ノードがあり、もう一方のブランチをマウントする前に
// それを破棄すればよい。ブランチ自身のリアクティブなマーカー/アンカーは
// コンパイル時に追跡せず、実行時に汎用的に発見する(runtime.js の
// collectReactive/forgetReactive 参照)ので、ブランチ内に任意にネストした
// リアクティブ内容やさらなる条件分岐も自動的に扱える。
//
// keyed リスト(`items().map(item => <li key={item.id}>{item.name}</li>)`)は
// 第3のマーカーで、同じくコメントでアンカーされるが、アイテム数が変わるので
// *範囲*(`<!--m3_start-->`...`<!--m3_end-->`)になる。更新時の
// リコンシリエーションは意図的に素朴:新しい配列を順に辿り、既に要素を持つ
// key はその要素を再利用し(アイテム自身のフィールドは追跡 signal ではない
// ので内容は丸ごと再描画)、新しい key には要素を作成し、すべてを新しい
// 順序で `insertBefore(el, end)` する - 文書内に既に存在するノードの挿入は
// *移動*になるため、insertBefore の繰り返しが並べ替えを兼ねる。これは
// 移動回数最適ではない(LIS ベースの最小移動 diff なし)が、見落としでは
// なく意図的な先送り - docs/adr/0001-first-milestone.md 参照。
//
// スコープ制限(隠さず明記):単一ファイル(コンポーネントのクロスモジュール
// import なし)、非リストの JSX 参照は静的インスタンス1つずつ、リスト
// アイテムのテンプレートはテキスト/式のみ(ネストした要素・条件分岐・
// さらなるリストは不可、アイテム自身のフィールド外の signal へのアクセスも
// 不可)、hygienic リネームは signal/derived/prop 宣言のみ対象 -
// 非リアクティブなローカル(`const step = 2`)はそのまま残り、インスタンス間で
// 衝突しうる。

import { parse } from '@babel/parser';
import traverseImport from '@babel/traverse';
import { signal, derived, registry } from './runtime.js';
import { generateModule } from './codegen.js';
import { createCompilerState } from './compiler/state.js';
import { compileComponent } from './compiler/render.js';
import { resolveToSignals } from './compiler/decl-graph.js';

const traverse = traverseImport.default ?? traverseImport;

export function compile(source) {
  registry.clear();

  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const ctx = createCompilerState(source);

  // --- トップレベルのコンポーネントをすべて列挙し、誰からも参照されない唯一のルートを特定する ---
  const componentsByName = new Map();
  traverse(ast, {
    FunctionDeclaration(path) {
      if (path.parentPath.isProgram() || path.parentPath.isExportNamedDeclaration()) {
        componentsByName.set(path.node.id.name, path);
      }
    },
  });
  if (componentsByName.size === 0) throw new Error('compile: no component function found');

  const referenced = new Set();
  for (const path of componentsByName.values()) {
    path.traverse({
      JSXOpeningElement(jsxPath) {
        const name = jsxPath.node.name.name;
        if (/^[A-Z]/.test(name) && componentsByName.has(name)) referenced.add(name);
      },
    });
  }
  const rootNames = [...componentsByName.keys()].filter((name) => !referenced.has(name));
  if (rootNames.length !== 1) {
    throw new Error(`compile: expected exactly one root component, found [${rootNames.join(', ')}] (scope limit)`);
  }
  const rootPath = componentsByName.get(rootNames[0]);

  const out = { declStatements: [], instrumentedDeclStatements: [] };
  const rootHtmlSource = compileComponent(ctx, rootPath, new Map(), ctx.instanceCounter++, componentsByName, out, false);

  // --- 推移閉包:derived の declId をルート signal まで展開する ---
  const signalToMarkers = new Map(); // declId -> Set<markerId>
  for (const [markerId, deps] of ctx.markerDeps) {
    for (const dep of deps) {
      for (const sig of resolveToSignals(ctx, dep, new Set())) {
        if (!signalToMarkers.has(sig)) signalToMarkers.set(sig, new Set());
        signalToMarkers.get(sig).add(markerId);
      }
    }
  }

  // --- ビルド時実行:discovery の確認 + 実際の初期 HTML の取得 ---
  const instrumentedBody = [...out.instrumentedDeclStatements, `return \`${rootHtmlSource}\`;`].join('\n');
  const runComponent = new Function('signal', 'derived', instrumentedBody);
  const initialHtml = runComponent(signal, derived);

  for (const [declId, kind] of ctx.declKind) {
    const entry = registry.get(declId);
    if (!entry || entry.kind !== kind) {
      throw new Error(`compile: expected "${ctx.declOutputName.get(declId)}" to be a ${kind}() call (ADR-0001 #3 discovery check)`);
    }
  }

  // --- ハンドラの書き込み先 declId を、マーカーを持つルート signal のみに
  //     絞って出力名へ変換する(signalToMarkers はここまでで確定)。
  //     マーカーの無い signal への update_* は codegen で生成されない
  //     ので、そこへの呼び出しは省く。
  for (const h of ctx.handlers) {
    h.updateNames = [...h.writeDeclIds]
      .filter((id) => signalToMarkers.has(id))
      .map((id) => ctx.declOutputName.get(id))
      .sort();
    delete h.writeDeclIds;
  }

  // --- codegen:ルート signal ごとの専用 update_<name>()、コンポーネント/インスタンス境界を跨ぐ ---
  const code = generateModule({
    declStatements: out.declStatements,
    markers: ctx.markers,
    signalToMarkers,
    declOutputName: ctx.declOutputName,
    initialHtml,
    handlers: ctx.handlers,
  });

  return { code, initialHtml, markers: ctx.markers, signalToMarkers, declName: ctx.declOutputName };
}
