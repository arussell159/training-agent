import { ListSkeleton } from "@/components/loading-layouts"
import { preloadable } from "@/lib/preloadable"
import { reportPeriodLabel } from "../../../app-backend/lib/coach-report-display.mjs"
import type { CatalogReport } from "./catalog-report-body"
export type { Catalog, CatalogReport, Filter } from "./catalog-report-body"

const body = preloadable(() => import("./catalog-report-body").then(module => ({default: module.CatalogReportBody})), () => <ListSkeleton />)
export const CatalogReportBody = body.Component
export const BlockReportBody = body.Component
export const WeeklyReportBody = body.Component
export const prepareReportBody = () => { void body.preload().catch(() => {}) }
export const periodLabel = (report: CatalogReport) => reportPeriodLabel(report)
