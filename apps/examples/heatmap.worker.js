self.onmessage = (event) => {
  if (event.data?.type === 'dictionary') {
    self.postMessage({ type: 'dictionary-ready', termCount: event.data.terms?.length ?? 0 })
  }
}
