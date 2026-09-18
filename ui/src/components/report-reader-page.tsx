import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MobileSiteNavbar } from "@/components/ui/mobile-site-navbar"
import {
  Section11Report,
  type ReportTarget,
} from "@/components/section11-report"
import { closeReportReader } from "@/lib/report-navigation"

export function ReportReaderPage({ target }: { target: ReportTarget }) {
  return (
    <div className="min-h-svh w-full min-w-0 bg-background">
      <MobileSiteNavbar
        title={target.kind === "block" ? "Block report" : "Weekly report"}
        onBack={closeReportReader}
      />
      <header className="sticky top-0 z-40 hidden h-14 items-center gap-3 px-4 md:flex">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Back"
          onClick={closeReportReader}
        >
          <ArrowLeft className="size-[18px]" />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {target.kind === "block" ? "Block report" : "Weekly report"}
        </h1>
      </header>
      <div className="mx-auto max-w-3xl px-4 py-5">
        <Section11Report target={target} reader />
      </div>
    </div>
  )
}
