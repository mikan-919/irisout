// 公開state入口の型だけを宣言する。コンパイラ内部のBabel ASTと解析状態は公開しない。

export type DeclId = string & { readonly __brand: 'DeclId' }
export type MarkerId = string & { readonly __brand: 'MarkerId' }
export type ContextId = string & { readonly __brand: 'ContextId' }

export declare const toDeclId: (value: string) => DeclId
export declare const toMarkerId: (value: string) => MarkerId
export declare const toContextId: (value: string) => ContextId

export type DeclKind = 'signal' | 'derived' | 'collection'

/** 内部解析状態は公開型から隠す。実行時にはstate.jsの既存実装を使う。 */
export type CompilerState = object

export declare function createCompilerState(
  source: string,
  transformedNodes?: Set<unknown>,
  supportNames?: Set<string>,
): CompilerState
export declare const declKey: (instanceId: number, start: number, bindingName: string) => string
export declare function nextMarkerId(ctx: CompilerState): MarkerId
export declare function assignOutputName(
  ctx: CompilerState,
  naturalName: string,
  id: DeclId,
): string
