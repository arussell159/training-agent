import { Component, type ReactNode } from "react"

export class PageErrorBoundary extends Component<
  { children: ReactNode; resetKey: string; onClose?: () => void },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidUpdate(
    previous: Readonly<{ children: ReactNode; resetKey: string }>
  ) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey)
      this.setState({ failed: false })
  }
  render() {
    return this.state.failed ? (
      <section role="alert" className="m-auto max-w-sm p-6 text-center">
        <h2 className="text-lg font-semibold">This view couldn’t load</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You can open another page, or reload to get the latest version.
        </p>
        <button
          type="button"
          className="mt-4 rounded-full border px-4 py-2 text-sm"
          onClick={() => window.location.reload()}
        >
          Reload app
        </button>
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
