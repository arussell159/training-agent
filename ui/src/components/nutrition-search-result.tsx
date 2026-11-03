import { useEffect, useRef, useState, type ReactNode } from "react"
import { loadFoodProduct } from "@/lib/nutrition-read-cache"
import { preferredFoodServing } from "@/lib/food-serving-choice"
import type { FoodProduct } from "@/lib/nutrition"

let active = 0
const waiting: (() => void)[] = []
async function prepare(id: string, current: () => boolean) {
  if (active >= 3) await new Promise<void>(resolve => waiting.push(resolve))
  else active++
  try { return current() ? await loadFoodProduct(id) : null }
  finally {
    const next = waiting.shift()
    if (next) next()
    else active--
  }
}

export function NutritionSearchResult({ product, children }: {
  product: FoodProduct
  children: (product: FoodProduct, ready: boolean) => ReactNode
}) {
  const host = useRef<HTMLDivElement>(null)
  const [resolved, setResolved] = useState<FoodProduct | null>(null)
  const ready = product.source !== "fatsecret" || Boolean(product.servings?.length)
  useEffect(() => {
    if (ready) return
    let alive = true, started = false
    const load = () => {
      if (started) return
      started = true
      void prepare(product.code, () => alive).then(result => {
        if (alive && result) setResolved(result.product)
      }).catch(() => { /* A tap retries and surfaces any provider error. */ })
    }
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { load(); observer?.disconnect() }
    }, { rootMargin: "120px" })
    if (host.current && observer) observer.observe(host.current)
    else load()
    return () => { alive = false; observer?.disconnect() }
  }, [product.code, ready])
  const current = resolved?.code === product.code ? resolved : product
  return <div ref={host}>{children(preferredFoodServing(current), ready || current !== product)}</div>
}
