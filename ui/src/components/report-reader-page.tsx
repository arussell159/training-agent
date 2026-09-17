import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MobileHeaderMenu } from "@/components/ui/mobile-header-menu"
import {
  Section11Report,
  type ReportTarget,
} from "@/components/section11-report"
import { closeReportReader } from "@/lib/report-navigation"

export function ReportReaderPage({ target }: { target: ReportTarget }) {
  return (
    <div className="min-h-svh w-full min-w-0 bg-background">
      <header className="mobile-site-header sticky top-0 z-40 flex h-14 items-center gap-3 px-4">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Back"
          onClick={closeReportReader}
        >
          <ArrowLeft className="size-[18px]" />
        </Button>
        <h1 className="mobile-header-title min-w-0 flex-1 truncate text-sm font-semibold">
          {target.kind === "block" ? "Block report" : "Weekly report"}
        </h1>
        <MobileHeaderMenu />
      </header>
      <div className="mx-auto max-w-3xl px-4 py-5">
        <Section11Report target={target} reader />
      </div>
    </div>
  )
}
