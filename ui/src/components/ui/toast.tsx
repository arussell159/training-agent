import { Toast as ToastPrimitive } from "@base-ui/react/toast"
import { Check, CircleAlert, LoaderCircle, X } from "lucide-react"
import { createContext, useContext, useMemo, type ReactNode } from "react"
import "./toast.css"

type ToastCommands = Pick<
  ReturnType<typeof ToastPrimitive.useToastManager>,
  "add" | "close" | "update" | "promise"
>
const ToastCommandsContext = createContext<ToastCommands | null>(null)

// The Base UI hook subscribes its caller to every toast update. Keep that
// subscription here, with stable command-only context for pages and workers.
function ToastCommandsProvider({ children }: { children: ReactNode }) {
  const { add, close, update, promise } = ToastPrimitive.useToastManager()
  const commands = useMemo(
    () => ({ add, close, update, promise }),
    [add, close, update, promise]
  )
  return (
    <ToastCommandsContext.Provider value={commands}>
      {children}
    </ToastCommandsContext.Provider>
  )
}

export function AppToastProvider({ children }: { children: ReactNode }) {
  return (
    <ToastPrimitive.Provider timeout={5000} limit={3}>
      <ToastCommandsProvider>{children}</ToastCommandsProvider>
      <ToastPrimitive.Portal>
        <ToastPrimitive.Viewport className="app-toast-viewport pointer-events-none fixed inset-x-0 mx-auto flex w-full max-w-sm flex-col gap-2 px-3 outline-none md:inset-x-auto md:mx-0 md:w-96 md:max-w-[calc(100vw-2rem)] md:px-0">
          <ToastList />
        </ToastPrimitive.Viewport>
      </ToastPrimitive.Portal>
    </ToastPrimitive.Provider>
  )
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager()
  return toasts.map((toast) => (
    <ToastPrimitive.Root
      key={toast.id}
      toast={toast}
      className="app-toast pointer-events-auto relative w-full shrink-0 rounded-2xl border border-border/60 bg-card p-4 text-card-foreground shadow-[0_8px_32px_-8px_rgb(0_0_0/0.22),0_2px_6px_rgb(0_0_0/0.04)] transition-opacity duration-100 outline-none data-ending-style:opacity-0 data-limited:hidden motion-reduce:transition-none"
    >
      <ToastPrimitive.Content className="flex items-start gap-3">
        <div
          className={`flex size-8 shrink-0 items-center justify-center rounded-full ${toast.type === "success" ? "bg-emerald-500/10" : toast.type === "error" ? "bg-destructive/10" : "bg-primary/10"}`}
          aria-hidden="true"
        >
          {toast.type === "loading" ? (
            <LoaderCircle className="size-4 animate-spin text-primary motion-reduce:animate-none" />
          ) : toast.type === "success" ? (
            <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <CircleAlert
              className={`size-4 ${toast.type === "error" ? "text-destructive" : "text-muted-foreground"}`}
            />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <ToastPrimitive.Title className="pr-5 text-base leading-6 font-semibold [overflow-wrap:anywhere]" />
          <ToastPrimitive.Description
            render={<div />}
            className="text-sm leading-5 [overflow-wrap:anywhere] text-muted-foreground"
          />
        </div>
        <ToastPrimitive.Close
          aria-label="Dismiss notification"
          aria-hidden={false}
          className="app-toast-close absolute top-0.5 right-0.5 inline-flex items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <X className="size-4" aria-hidden="true" />
        </ToastPrimitive.Close>
      </ToastPrimitive.Content>
    </ToastPrimitive.Root>
  ))
}

export function useToastManager() {
  const commands = useContext(ToastCommandsContext)
  if (!commands) throw Error("Toast commands require AppToastProvider.")
  return commands
}
