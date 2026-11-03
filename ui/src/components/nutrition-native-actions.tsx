import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { titleCase, type FoodEntry, type Meal } from "@/lib/nutrition"
import { deviceCacheScope } from "@/lib/device-cache"
import { randomId } from "@/lib/random-id"
import {
  copyNutritionFoods,
  readNutritionClipboard,
  clearNutritionClipboard,
  pastedNutritionFoods,
  type NutritionClipboard,
} from "@/lib/nutrition-planner"
import {
  beginFoodGesture,
  moveFoodGesture,
  finishFoodGesture,
  type FoodGesture,
} from "@/lib/native-food-gesture"
import "./nutrition-native-actions.css"

type Actions = {
  copied: boolean
  busy: boolean
  copy: (entry: FoodEntry) => void
  paste: (meal: Meal) => void
  remove: (entry: FoodEntry) => void
}
const Context = createContext<Actions | null>(null)
export function NutritionFoodClipboard({
  date,
  busy,
  onPaste,
  onDelete,
  onError,
  children,
}: {
  date: string
  busy: boolean
  onPaste: (entries: FoodEntry[]) => Promise<void>
  onDelete: (entry: FoodEntry) => Promise<void>
  onError: (message: string) => void
  children: ReactNode
}) {
  const scope = deviceCacheScope(),
    [clipboard, setClipboard] = useState<NutritionClipboard | null>(() => {
      try {
        return readNutritionClipboard(deviceCacheScope())
      } catch {
        return null
      }
    })
  useEffect(() => {
    // Remove copies retained by the previous release; new copies never use storage.
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i)
        if (key?.startsWith("nutrition-clipboard-v1:"))
          localStorage.removeItem(key)
      }
    } catch {
      /* Session copying works without storage. */
    }
    const clear = () => {
      clearNutritionClipboard()
      setClipboard(null)
    }
    const hidden = () => {
      if (document.visibilityState === "hidden") clear()
    }
    window.addEventListener("pagehide", clear)
    document.addEventListener("visibilitychange", hidden)
    for (const event of ["training-cache-reset", "app-auth-required"])
      window.addEventListener(event, clear)
    return () => {
      window.removeEventListener("pagehide", clear)
      document.removeEventListener("visibilitychange", hidden)
      for (const event of ["training-cache-reset", "app-auth-required"])
        window.removeEventListener(event, clear)
    }
  }, [scope])
  const current = clipboard?.scope === scope ? clipboard : null
  const copy = (entry: FoodEntry) => {
    if (busy) return
    try {
      setClipboard(copyNutritionFoods(scope, date, [entry], entry.name))
    } catch (error) {
      onError((error as Error).message)
    }
  }
  const paste = (meal: Meal) => {
    if (busy) return
    void (async () => {
      try {
        const saved = readNutritionClipboard(scope)
        if (!saved) {
          setClipboard(null)
          throw Error("Copy the food again before pasting.")
        }
        await onPaste(pastedNutritionFoods(saved, scope, meal, randomId))
      } catch (error) {
        onError((error as Error).message)
      }
    })()
  }
  const remove = (entry: FoodEntry) => {
    if (!busy) void onDelete(entry).catch((error) => onError(error.message))
  }
  return (
    <Context.Provider
      value={{ copied: Boolean(current), busy, copy, paste, remove }}
    >
      {children}
    </Context.Provider>
  )
}

export function MealPasteSelect({ meal }: { meal: Meal }) {
  const actions = useContext(Context)
  if (!actions?.copied) return null
  return (
    <select
      className="nutrition-native-meal-select"
      aria-label={`Paste into ${meal}`}
      defaultValue=""
      disabled={actions.busy}
      onChange={(event) => {
        const value = event.currentTarget.value
        event.currentTarget.value = ""
        if (value === "paste") actions.paste(meal)
      }}
    >
      <option value="">{titleCase(meal)} actions</option>
      <option value="paste">Paste copied food into {titleCase(meal)}</option>
    </select>
  )
}

export function DiaryFoodActions({
  entry,
  disabled,
  onOpen,
  children,
}: {
  entry: FoodEntry
  disabled: boolean
  onOpen: () => void
  children: ReactNode
}) {
  const actions = useContext(Context),
    select = useRef<HTMLSelectElement>(null),
    gesture = useRef<FoodGesture | null>(null),
    touchHeld = useRef(false),
    lastTouch = useRef(0),
    handledUntil = useRef(0)
  useEffect(() => {
    const cancel = () => {
      if (gesture.current) gesture.current.cancelled = true
    }
    window.addEventListener("scroll", cancel, true)
    window.addEventListener("blur", cancel)
    return () => {
      window.removeEventListener("scroll", cancel, true)
      window.removeEventListener("blur", cancel)
    }
  }, [])
  const picker = () => {
    const element = select.current
    if (!element || disabled) return
    element.focus({ preventScroll: true })
    if (typeof element.showPicker === "function")
      try {
        element.showPicker()
      } catch {
        /* On iPhone, the real select receives the trusted touch and opens natively. */
      }
  }
  const busy = disabled || Boolean(actions?.busy)
  return (
    <span className="nutrition-native-food-action">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        disabled={busy}
        aria-label={`Edit ${titleCase(entry.name)}`}
        onClick={onOpen}
      >
        {children}
      </button>
      <select
        ref={select}
        className="nutrition-native-food-select"
        aria-label={`Actions for ${titleCase(entry.name)}`}
        defaultValue=""
        disabled={busy}
        onPointerDown={(event) => {
          if (event.pointerType === "touch" || event.button !== 0) return
          event.preventDefault()
          touchHeld.current = false
          gesture.current = beginFoodGesture(
            event.clientX,
            event.clientY,
            Date.now()
          )
        }}
        onPointerMove={(event) => {
          if (event.pointerType !== "touch" && gesture.current)
            moveFoodGesture(gesture.current, event.clientX, event.clientY)
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "touch" && gesture.current)
            gesture.current.cancelled = true
        }}
        onPointerCancel={() => {
          if (gesture.current) gesture.current.cancelled = true
        }}
        onPointerUp={(event) => {
          if (event.pointerType === "touch" || event.button !== 0) return
          const result = finishFoodGesture(gesture.current, Date.now())
          gesture.current = null
          handledUntil.current = Date.now() + 1000
          if (result === "hold") picker()
          else if (result === "tap") onOpen()
        }}
        onTouchStart={(event) => {
          lastTouch.current = Date.now()
          touchHeld.current = false
          const touch = event.touches[0]
          gesture.current =
            event.touches.length === 1
              ? beginFoodGesture(touch.clientX, touch.clientY, Date.now())
              : null
        }}
        onTouchMove={(event) => {
          const touch = event.touches[0]
          if (gesture.current && touch)
            moveFoodGesture(gesture.current, touch.clientX, touch.clientY)
        }}
        onTouchCancel={() => {
          if (gesture.current) gesture.current.cancelled = true
          touchHeld.current = false
        }}
        onTouchEnd={(event) => {
          const result = finishFoodGesture(gesture.current, Date.now())
          gesture.current = null
          lastTouch.current = Date.now()
          touchHeld.current = result === "hold"
          handledUntil.current = Date.now() + 1000
          if (result !== "hold") {
            event.preventDefault()
            if (result === "tap") onOpen()
          } /* A held touch keeps the select's browser default action. No synthetic click or timer opens the iPhone picker. */
        }}
        onClick={(event) => {
          if (touchHeld.current) return
          if (Date.now() < handledUntil.current) event.preventDefault()
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          if (Date.now() - lastTouch.current > 1000) picker()
        }}
        onKeyDown={(event) => {
          if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            event.preventDefault()
            picker()
          }
        }}
        onChange={(event) => {
          const value = event.currentTarget.value
          event.currentTarget.value = ""
          touchHeld.current = false
          if (value === "edit") onOpen()
          else if (value === "copy") actions?.copy(entry)
          else if (value === "delete") actions?.remove(entry)
        }}
      >
        <option value="">Food actions — {titleCase(entry.name)}</option>
        <option value="edit">Edit food</option>
        <option value="copy">Copy food</option>
        <option value="delete">Delete food</option>
      </select>
    </span>
  )
}
