// 比較対象と上流コミットを固定し、準備と実行で同じ条件を共有する。
import path from 'node:path'
export const root = import.meta.dirname
export const workspace = path.resolve(root, '../../..')
export const checkout = process.env.JSFB_CHECKOUT ?? '/tmp/irisout-js-framework-benchmark'
export const upstreamCommit = 'bf894b681fb56433ccb6efb4a3c93e35eda2b20d'
const availableFrameworks = ['irisout', 'react-hooks', 'vue', 'solid', 'vanillajs']
export const frameworks = process.env.JSFB_FRAMEWORKS?.split(',') ?? availableFrameworks
if (
  frameworks.length === 0 ||
  new Set(frameworks).size !== frameworks.length ||
  frameworks.some((name) => !availableFrameworks.includes(name))
)
  throw new Error('Invalid JSFB_FRAMEWORKS')
export const benchmarks = [
  '01_',
  '02_',
  '03_',
  '04_',
  '05_',
  '06_',
  '07_',
  '08_',
  '09_',
  '21_',
  '22_',
  '25_',
  '40_',
]
