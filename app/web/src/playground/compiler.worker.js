// 投稿された単一JSXを実行管理画面のWorker内で変換する。
// compile()は初期HTML生成時に入力由来の処理を実行するため、Workerを実行単位として破棄する。

import { compile } from 'irisout/browser'
import {
  byteLength,
  isRunMessage,
  messageByteLength,
  PLAYGROUND_MESSAGE_MAX_BYTES,
  PLAYGROUND_PROTOCOL_VERSION,
  PLAYGROUND_RESULT_MAX_BYTES,
} from './protocol.js'

self.addEventListener('message', (event) => {
  const message = event.data
  if (messageByteLength(message) > PLAYGROUND_MESSAGE_MAX_BYTES || !isRunMessage(message)) {
    self.postMessage(makeCompileError('', '実行要求の形式または大きさが不正です'))
    return
  }

  try {
    const result = compile(message.source)
    const resultBytes = byteLength(result.code) + byteLength(result.initialHtml)
    if (resultBytes > PLAYGROUND_RESULT_MAX_BYTES) {
      self.postMessage(makeCompileError(message.runId, '生成結果が1 MiBを超えています'))
      return
    }
    const response = {
      type: 'irisout-playground/compile-result',
      version: PLAYGROUND_PROTOCOL_VERSION,
      runId: message.runId,
      ok: true,
      code: result.code,
      initialHtml: result.initialHtml,
    }
    if (messageByteLength(response) > PLAYGROUND_MESSAGE_MAX_BYTES + PLAYGROUND_RESULT_MAX_BYTES) {
      self.postMessage(makeCompileError(message.runId, '生成結果の通信サイズが上限を超えています'))
      return
    }
    self.postMessage(response)
  } catch (error) {
    self.postMessage(
      makeCompileError(message.runId, error instanceof Error ? error.message : String(error)),
    )
  }
})

function makeCompileError(runId, message) {
  return {
    type: 'irisout-playground/compile-result',
    version: PLAYGROUND_PROTOCOL_VERSION,
    runId,
    ok: false,
    message: String(message).slice(0, 8_192),
  }
}
