// 結果iframeへ渡す生成moduleが使う最小ランタイムの配信入口。
// 生成sourceは実行管理画面の配信元からこのmoduleだけを読む。

export { hydrate, hydrateWithRanges, mount, mountWithRanges } from 'irisout/runtime'

export const runtimeUrl = import.meta.url
