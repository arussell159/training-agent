import { useEffect, useState } from "react"
import { Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  foodFromProduct,
  nutrientKeys,
  titleCase,
  type FoodEntry,
  type FoodProduct,
} from "@/lib/nutrition"
import { portionOptions, scaleFood } from "@/lib/nutrition-math"
import { FoodThumbnail } from "./food-thumbnail"

export function FoodEditor({
  entry,
  onChange,
  onRemove,
  product,
  editable = false,
  disabled = false,
}: {
  entry: FoodEntry
  onChange: (entry: FoodEntry) => void
  onRemove?: () => void
  product?: FoodProduct | null
  editable?: boolean
  disabled?: boolean
}) {
  // Scale from the original values so repeated unit changes never accumulate rounding.
  const fatSecretServings =
    product?.source === "fatsecret" ? (product.servings || []) : []
  const options = fatSecretServings.length
    ? fatSecretServings.map((serving) => ({
        value: serving.id,
        label: serving.label,
        factor: 1,
      }))
    : entry.source === "fatsecret"
      ? [{ value: entry.servingId || "current", label: entry.unit, factor: 1 }]
      : portionOptions(entry, product?.servingQuantity || entry.servingQuantity)
  const [unit, setUnit] = useState(
    entry.servingId && options.some((option) => option.value === entry.servingId)
      ? entry.servingId
      : options[0].value
  )
  const [baseline] = useState(entry)
  useEffect(() => {
    if (!product?.servings?.length) return
    const selected = product.servings.some((serving) => serving.id === entry.servingId)
      ? entry.servingId!
      : product.servingId || product.servings[0].id
    setUnit(selected)
    setAmount(String(entry.quantity))
  }, [product, entry.servingId, entry.quantity])
  const selectedBaseline =
    fatSecretServings.length && product
      ? foodFromProduct({ ...product, servingId: unit }, entry.meal)
      : baseline
  const factor = editable
    ? 1
    : options.find((option) => option.value === unit)?.factor || 1
  const [amount, setAmount] = useState(String(entry.quantity / factor))
  const update = (patch: Partial<FoodEntry>) =>
    onChange({
      ...entry,
      ...patch,
      ...(editable
        ? { source: "manual" as const, foodId: undefined, servingId: undefined }
        : {}),
    })
  const changeAmount = (value: string) => {
    setAmount(value)
    const q = Number(value) * factor
    if (q > 0 && q <= 100000) {
      const scaled = scaleFood(editable ? entry : selectedBaseline, q)
      onChange({ ...entry, ...scaled, id: entry.id, meal: entry.meal })
    }
  }
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-4 border-0 p-0">
      <div className="flex items-start justify-between gap-3 px-1">
        {editable ? (
          <label className="nutrition-field w-full">
            Food name
            <Input
              value={entry.name}
              maxLength={180}
              placeholder="Food name"
              onChange={(e) => update({ name: e.target.value })}
            />
          </label>
        ) : (
          <div className="flex items-center gap-3">
            <FoodThumbnail
              name={entry.name}
              imageUrl={entry.imageUrl || product?.imageUrl}
            />
            <h2 className="text-xl leading-tight font-bold">
              {titleCase(entry.name)}
            </h2>
          </div>
        )}
        {onRemove && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${entry.name || "food"} from draft`}
            onClick={onRemove}
          >
            <Trash2 />
          </Button>
        )}
      </div>
      {editable ? (
        <label className="nutrition-field">
          Serving unit
          <Input
            value={entry.unit}
            maxLength={40}
            onChange={(e) =>
              update({
                unit: e.target.value,
                gramsPerUnit: null,
                servingQuantity: null,
              })
            }
          />
        </label>
      ) : (
        <label className="nutrition-field">
          Serving
          <select
            aria-label="Serving unit"
            value={unit}
            onChange={(e) => {
              const next = options.find(
                (option) => option.value === e.target.value
              )!
              setUnit(next.value)
              const quantity = Number((entry.quantity / next.factor).toFixed(4))
              setAmount(String(quantity))
              if (fatSecretServings.length && product) {
                const nextEntry = foodFromProduct(
                  { ...product, servingId: next.value },
                  entry.meal
                )
                onChange({
                  ...entry,
                  ...scaleFood(nextEntry, entry.quantity),
                  id: entry.id,
                  meal: entry.meal,
                })
              }
            }}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="nutrition-field">
        Amount
        <Input
          aria-label="Portion amount"
          type="number"
          min="0.01"
          max="100000"
          step="any"
          inputMode="decimal"
          value={amount}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(e) => changeAmount(e.target.value)}
          onBlur={() => {
            if (!(Number(amount) > 0 && Number(amount) * factor <= 100000))
              setAmount(String(Number((entry.quantity / factor).toFixed(4))))
          }}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        {nutrientKeys
          .filter((key) => key !== "fiber")
          .map((key) => (
            <label className="nutrition-field" key={key}>
              {titleCase(key)} ({key === "calories" ? "kcal" : "g"})
              <Input
                aria-label={`${titleCase(key)} ${key === "calories" ? "kcal" : "g"}`}
                type="number"
                min="0"
                step="any"
                readOnly={!editable}
                value={
                  entry.missingValues?.includes(key) ? "" : (entry[key] ?? "")
                }
                onChange={(e) =>
                  update({
                    [key]: Number(e.target.value),
                    missingValues:
                      e.target.value === ""
                        ? [...new Set([...(entry.missingValues || []), key])]
                        : (entry.missingValues || []).filter((k) => k !== key),
                  })
                }
              />
            </label>
          ))}
      </div>
      {entry.source === "ai" && entry.notes && (
        <p className="px-1 text-xs leading-relaxed text-muted-foreground">
          Estimate basis: {entry.notes}
        </p>
      )}
    </fieldset>
  )
}
