## 設計

1. `StructuralUnitBody.localEffects`へ解析済みcallbackを保持する。`readDeclIds`は
   現在・祖先のlocal declaration以外を親markerの依存へ合流し、字句範囲外のlocal
   declarationは拒否する。
2. lifecycle factoryはeffect cleanup slotと専用runnerだけを持つ。update時はlocal write、
   item値の変更、effectが読むroot signalの変更に限ってrunnerを呼ぶ。mountでは既存の
   action/onMountの後、destroyでは子unit、action、onMount、effectの順で処理する。
3. root signalの変更は生成済みmarker updateの呼び出し中だけtrigger集合を渡す。runtimeへ
   registryやschedulerを追加せず、既存の`reconcileListWithLifecycle`/conditional handleを
   そのまま利用する。
