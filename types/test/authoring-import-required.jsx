// 記述APIは大域関数ではなく、`irisout`から明示的にimportする。
import { render as importedRender } from 'irisout'

// @ts-expect-error importなしのsignalは型検査で拒否する。
signal(0)

// @ts-expect-error importなしのrenderは型検査で拒否する。
render(<div />)

// @ts-expect-error renderはJSX.Element以外を受け取らない。
importedRender(1)
