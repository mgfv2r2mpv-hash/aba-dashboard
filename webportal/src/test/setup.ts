/// <reference types="vitest/globals" />
// The portal's suite runs on the app's setup plus one repair: jsdom 24 ships Blob
// and File without arrayBuffer(), which every browser the portal supports has had
// since 2019. Reading a dropped backup is the portal's front door, so the gap is
// the environment's and it gets patched here rather than worked around in the code.
import '../../../src/test/setup'

if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(this)
    })
  }
}
