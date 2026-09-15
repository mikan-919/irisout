declare module '*?url' {
  const src: string
  export default src
}

declare module '*?worker' {
  const workerConstructor: {
    new (options?: { name?: string }): Worker
  }
  export default workerConstructor
}

declare module '*.css' {}

declare module '@libraz/suzume/wasm?url' {
  const src: string
  export default src
}
