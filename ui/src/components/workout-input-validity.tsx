import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"

type ReportValidity = (id: string, invalid: boolean) => void

export const WorkoutInputValidityContext = createContext<ReportValidity>(
  () => {}
)

// Keep a synchronous registry as well as rendered state: keyboard Save must
// observe the same invalid draft as the buttons, before any provider write.
export function useWorkoutInputValidity() {
  const invalid = useRef(new Set<string>())
  const [hasInvalid, setHasInvalid] = useState(false)
  const report = useCallback<ReportValidity>((id, value) => {
    if (value) invalid.current.add(id)
    else invalid.current.delete(id)
    setHasInvalid(invalid.current.size > 0)
  }, [])
  return { report, hasInvalid, isValid: () => invalid.current.size === 0 }
}

export function useWorkoutFieldValidity() {
  const report = useContext(WorkoutInputValidityContext)
  const id = useId()
  const [invalid, setInvalid] = useState(false)
  const markInvalid = useCallback(
    (value: boolean) => {
      report(id, value)
      setInvalid(value)
    },
    [id, report]
  )
  useEffect(() => () => report(id, false), [id, report])
  return { invalid, markInvalid }
}
