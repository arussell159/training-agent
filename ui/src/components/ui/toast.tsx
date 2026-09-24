import { Toast as ToastPrimitive } from "@base-ui/react/toast"
import { X } from "lucide-react"
import type { ReactNode } from "react"

export function AppToastProvider({ children }: { children: ReactNode }) {
  return (
    <ToastPrimitive.Provider timeout={5000}>
      {children}
      <ToastPrimitive.Portal>
        <ToastPrimitive.Viewport className="fixed inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-[200] w-full px-3 outline-none md:inset-x-auto md:right-4 md:bottom-4 md:w-[calc(100vw-2rem)] md:max-w-sm md:px-0">
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
      className="relative mb-2 w-full rounded-xl border bg-card p-4 text-card-foreground shadow-lg outline-none transition-[transform,opacity] duration-200 data-starting-style:translate-y-2 data-starting-style:opacity-0 data-ending-style:translate-y-2 data-ending-style:opacity-0"
    >
      <ToastPrimitive.Content className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <ToastPrimitive.Title className="text-sm font-semibold" />
          <ToastPrimitive.Description className="text-xs text-muted-foreground" />
        </div>
        <ToastPrimitive.Close
          aria-label="Dismiss notification"
          className="-mr-1 -mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" aria-hidden="true" />
        </ToastPrimitive.Close>
      </ToastPrimitive.Content>
    </ToastPrimitive.Root>
  ))
}

export const useToastManager = ToastPrimitive.useToastManager
