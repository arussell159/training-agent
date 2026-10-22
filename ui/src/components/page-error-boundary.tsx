import { Component, type ReactNode } from "react"
import { requestAppShellRecovery } from "@/lib/app-shell-recovery"

export type PageRecovery = {
  retry: () => void
  retrying: boolean
  retryAvailable: boolean
  reload: () => void
  reloadBlocked: boolean
}

export class PageErrorBoundary extends Component<
  {
    children: ReactNode
    resetKey: string
    onClose?: () => void
    onRetry?: () => void | Promise<void>
    fallback?: (recovery: PageRecovery) => ReactNode
  },
  {
    failed: boolean
    retrying: boolean
    attempts: number
    reloadBlocked: boolean
  }
> {
  state = { failed: false, retrying: false, attempts: 0, reloadBlocked: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidUpdate(
    previous: Readonly<{ children: ReactNode; resetKey: string }>
  ) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey)
      this.setState({
        failed: false,
        retrying: false,
        attempts: 0,
        reloadBlocked: false,
      })
  }
  retry = () => {
    if (!this.props.onRetry || this.state.retrying || this.state.attempts > 0)
      return
    this.setState({ retrying: true, attempts: 1 })
    void Promise.resolve()
      .then(() => this.props.onRetry?.())
      .then(
        () => this.setState({ failed: false, retrying: false }),
        () => this.setState({ retrying: false })
      )
  }
  reload = () => {
    if (!requestAppShellRecovery()) this.setState({ reloadBlocked: true })
  }
  render() {
    if (this.state.failed && this.props.fallback)
      return this.props.fallback({
        retry: this.retry,
        retrying: this.state.retrying,
        retryAvailable:
          Boolean(this.props.onRetry) && this.state.attempts === 0,
        reload: this.reload,
        reloadBlocked: this.state.reloadBlocked,
      })
    return this.state.failed ? (
      <section role="alert" className="m-auto max-w-sm p-6 text-center">
        <h2 className="text-lg font-semibold">This view couldn’t load</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You can open another page, or reload to get the latest version.
        </p>
        <button
          type="button"
          className="mt-4 rounded-full border px-4 py-2 text-sm"
          onClick={this.reload}
        >
          Reload app
        </button>
        {this.state.reloadBlocked && (
          <p role="status" className="mt-2 text-sm">
            Keep this view open. Your draft could not be retained safely for a
            reload.
          </p>
        )}
        {this.props.onClose && (
          <button
            type="button"
            className="mt-4 ml-2 rounded-full border px-4 py-2 text-sm"
            onClick={this.props.onClose}
          >
            Close replay
          </button>
        )}
      </section>
    ) : (
      this.props.children
    )
  }
}
