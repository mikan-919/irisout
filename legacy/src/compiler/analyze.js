// 式の解析:識別子を追跡中の declId に解決し、hygienic な出力名への
// 書き換えソースを組み立てる。ハンドラ式の書き込み検出もここに含む。

import { declKey } from './state.js';
import { resolveToSignals } from './decl-graph.js';

// 式を走査し、参照されている各識別子をレキシカルスコープ経由で追跡中の
// declId(あれば)に解決して、依存の集合と、それらの参照を hygienic な
// 出力名に書き換えたソーステキストの両方を返す(リネーム不要なら実質
// no-op)。
export function analyzeExpr(ctx, path, instanceId) {
  const deps = new Set();
  const edits = [];
  const visit = (idPath) => {
    const binding = idPath.scope.getBinding(idPath.node.name);
    if (!binding || binding.path.node.type !== 'VariableDeclarator') return;
    const declId = ctx.declIdByKey.get(declKey(instanceId, binding.path.node.start));
    if (!declId) return;
    deps.add(declId);
    const outputName = ctx.declOutputName.get(declId);
    if (outputName && outputName !== idPath.node.name) {
      edits.push({ start: idPath.node.start, end: idPath.node.end, text: outputName });
    }
  };
  if (path.isIdentifier()) visit(path);
  path.traverse({
    Identifier(idPath) {
      if (idPath.isReferencedIdentifier()) visit(idPath);
    },
  });
  edits.sort((a, b) => a.start - b.start);
  let rendered = '';
  let cursor = path.node.start;
  for (const edit of edits) {
    rendered += ctx.source.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  rendered += ctx.source.slice(cursor, path.node.end);
  return { deps, rendered };
}

// ハンドラ式(`onClick={...}`)専用の解析:読み取りは analyzeExpr と同じく
// hygienic な出力名にリネームしつつ、式中の「追跡済み signal への引数あり
// 呼び出し」を書き込みとして検出する。`count(count() + 1)` のように同じ
// signal への読み書きが同居しても、外側の呼び出し(引数あり = 書き込み)
// だけを拾うので二重登録にはならない。
export function analyzeHandlerExpr(ctx, exprPath, instanceId) {
  const { rendered } = analyzeExpr(ctx, exprPath, instanceId);
  const writeDeclIds = new Set();
  const visitCall = (callPath) => {
    if (callPath.node.arguments.length < 1) return;
    const callee = callPath.get('callee');
    if (!callee.isIdentifier()) return;
    const binding = callee.scope.getBinding(callee.node.name);
    if (!binding || binding.path.node.type !== 'VariableDeclarator') return;
    const declId = ctx.declIdByKey.get(declKey(instanceId, binding.path.node.start));
    if (!declId) return;
    if (ctx.declKind.get(declId) === 'derived') {
      throw new Error(`compile: cannot write to derived "${callee.node.name}"`);
    }
    for (const sig of resolveToSignals(ctx, declId, new Set())) writeDeclIds.add(sig);
  };
  if (exprPath.isCallExpression()) visitCall(exprPath);
  exprPath.traverse({ CallExpression: visitCall });
  return { rendered, writeDeclIds };
}

// `count()` のような裸の読み取り - 追跡済み signal/derived の引数なし
// 呼び出しで周囲に計算がないもの - は安全にエイリアスできる。それ以外
// (リテラル、`count() + 1` など)は一般に write-back できないので、
// 独立した signal に昇格する。
export function bareTrackedDeclId(ctx, exprPath, instanceId) {
  if (!exprPath.isCallExpression() || exprPath.node.arguments.length !== 0) return null;
  const callee = exprPath.get('callee');
  if (!callee.isIdentifier()) return null;
  const binding = callee.scope.getBinding(callee.node.name);
  if (!binding || binding.path.node.type !== 'VariableDeclarator') return null;
  return ctx.declIdByKey.get(declKey(instanceId, binding.path.node.start)) ?? null;
}
