export function randomId() {
  if (typeof globalThis.crypto?.randomUUID === "function")
    return globalThis.crypto.randomUUID()

  // LAN test pages use plain HTTP, where some mobile browsers hide randomUUID.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16)
    return (character === "x" ? random : (random & 0x3) | 0x8).toString(16)
  })
}
