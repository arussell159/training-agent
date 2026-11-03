import test from "node:test"
import assert from "node:assert/strict"
import {
  createNutritionCatalogCache,
  CATALOG_CACHE_TTL,
} from "../src/lib/nutrition-catalog-cache.ts"
function storage() {
  const map = new Map()
  return {
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  }
}
test("catalog reuse is scoped by account/path and reads never extend original retrieval age", () => {
  const device = storage()
  let now = 1000
  const cache = createNutritionCatalogCache(device, () => now)
  cache.set("account-a", "/product?id=12", { product: { code: "12" } })
  assert.equal(cache.get("account-b", "/product?id=12"), null)
  assert.deepEqual(cache.get("account-a", "/product?id=12"), {
    product: { code: "12" },
  })
  now += CATALOG_CACHE_TTL - 1
  assert.ok(cache.get("account-a", "/product?id=12"))
  now++
  assert.equal(cache.get("account-a", "/product?id=12"), null)
  assert.equal(device.length, 0)
})
test("signed receipt expiry shortens content cache and invalidation targets one product", () => {
  const device = storage()
  let now = 1000
  const cache = createNutritionCatalogCache(device, () => now)
  cache.set("a", "/product?id=12", { name: "food" }, 1500)
  cache.set("a", "/search?q=rice", { products: [] })
  now = 1500
  assert.equal(cache.get("a", "/product?id=12"), null)
  assert.ok(cache.get("a", "/search?q=rice"))
  cache.set("a", "/product?id=12", { name: "new food" })
  cache.delete("a", "/product?id=12")
  assert.equal(cache.get("a", "/product?id=12"), null)
  assert.ok(cache.get("a", "/search?q=rice"))
  cache.clear()
  assert.equal(device.length, 0)
})
test("catalog device storage is bounded and unavailable storage never blocks reads", () => {
  const device = storage()
  let now = 1000
  const cache = createNutritionCatalogCache(device, () => now)
  for (let i = 0; i < 90; i++) {
    cache.set("a", `/product?id=${i}`, { i })
    now++
  }
  assert.equal(device.length, 80)
  assert.equal(cache.get("a", "/product?id=0"), null)
  const unavailable = createNutritionCatalogCache({
    get length() {
      throw Error("Storage disabled")
    },
  })
  assert.equal(unavailable.get("a", "/x"), null)
  assert.doesNotThrow(() => unavailable.set("a", "/x", {}))
})

test('hot product reads validate their own expiry without reparsing every other food',()=>{
 const device=storage();let now=1000
 for(let i=0;i<80;i++)createNutritionCatalogCache(device,()=>now).set('a',`/product?id=${i}`,{i})
 let reads=0;const original=device.getItem;device.getItem=key=>{reads++;return original(key)}
 for(let i=0;i<6;i++)assert.deepEqual(createNutritionCatalogCache(device,()=>now).get('a',`/product?id=${i}`),{i})
 assert.equal(reads,6)
 now+=CATALOG_CACHE_TTL
 assert.equal(createNutritionCatalogCache(device,()=>now).get('a','/product?id=0'),null)
 assert.equal(device.length,0)
})
