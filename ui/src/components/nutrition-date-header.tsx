import "@/lib/framework7-calendar"
import { useEffect, useRef, useState } from "react"
import { f7ready } from "framework7-react"
import type { Calendar } from "framework7/types"
import { ChevronDown, ChevronLeft, ChevronRight, Ellipsis } from "lucide-react"
import { MobileSiteNavbar } from "@/components/ui/mobile-site-navbar"
import { nutritionToday } from "@/lib/nutrition"
import { useIsMobile } from "@/hooks/use-mobile"
import { Calendar as DateCalendar } from "@/components/ui/calendar"

export function NutritionDateHeader({
  date,
  onSelect,
  onTargets,
  disabled,
  onBack,
  returnLabel,
}: {
  date: string
  onSelect: (date: string) => void
  onTargets: () => void
  disabled: boolean
  onBack: () => void
  returnLabel: string
}) {
  const mobile = useIsMobile()
  const [open, setOpen] = useState(false),
    [closing, setClosing] = useState(false)
  const [month, setMonth] = useState(new Date(`${date}T12:00:00`))
  const container = useRef<HTMLDivElement>(null),
    picker = useRef<Calendar.Calendar | null>(null),
    select = useRef(onSelect),
    selectedDate = useRef(date)
  select.current = onSelect
  selectedDate.current = date
  const visible = open || closing
  const mobileHeading =
    date === nutritionToday()
      ? "Today"
      : new Date(date + "T12:00:00").toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })
  const close = () => {
    setOpen(false)
    setClosing(true)
  }
  useEffect(() => {
    if (!closing) return
    const timer = setTimeout(() => setClosing(false), 200)
    return () => clearTimeout(timer)
  }, [closing])
  useEffect(() => {
    if (!open) return
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
        setClosing(true)
      }
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [open])
  useEffect(() => {
    if (!visible || !mobile) return
    let cancelled = false,
      instance: Calendar.Calendar | null = null
    f7ready((app) => {
      if (cancelled || !container.current) return
      const label = (c: Calendar.Calendar) =>
        setMonth(new Date(c.currentYear, c.currentMonth, 1))
      instance = app.calendar.create({
        containerEl: container.current,
        value: [new Date(`${selectedDate.current}T12:00:00`)],
        firstDay: 1,
        locale: "en-US",
        toolbar: false,
        monthSelector: false,
        yearSelector: false,
        touchMove: true,
        cssClass: "calendar-jump-inline",
        on: {
          init: label,
          monthYearChangeStart: label,
          dayClick: (_c, _el, year, m, day) => {
            select.current(
              `${year}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
            )
            setOpen(false)
            setClosing(true)
          },
        },
      })
      picker.current = instance
    })
    return () => {
      cancelled = true
      instance?.destroy()
      picker.current = null
    }
  }, [visible, mobile])
  const shift = (direction: number) => {
    if (mobile) {
      if (direction < 0) picker.current?.prevMonth(200)
      else picker.current?.nextMonth(200)
    } else
      setMonth(
        (value) =>
          new Date(value.getFullYear(), value.getMonth() + direction, 1)
      )
  }
  const title = (
    <button
      className={`calendar-month-title-button nutrition-title-transition ${open ? "is-open" : ""}`}
      aria-label={open ? "Close nutrition calendar" : "Choose nutrition date"}
      aria-expanded={open}
      aria-controls="nutrition-date-picker"
      disabled={disabled}
      onClick={() => {
        if (open) close()
        else {
          setMonth(new Date(`${date}T12:00:00`))
          setClosing(false)
          setOpen(true)
        }
      }}
    >
      <span className="nutrition-title-default" aria-hidden={open}>
        {mobileHeading}
      </span>
      <span className="nutrition-title-month" aria-hidden={!open}>
        {month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
      </span>
      <ChevronDown className="size-4" />
    </button>
  )
  const desktopTitle = (
    <button
      type="button"
      className="calendar-month-title-button justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-muted/70"
      aria-label={open ? "Close nutrition calendar" : "Choose nutrition date"}
      aria-expanded={open}
      aria-controls="nutrition-date-picker"
      disabled={disabled}
      onClick={() => {
        if (open) close()
        else {
          setMonth(new Date(`${date}T12:00:00`))
          setClosing(false)
          setOpen(true)
        }
      }}
    >
      {open
        ? month.toLocaleDateString("en-US", { month: "long", year: "numeric" })
        : new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
      <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
  )
  const left = (
    <button
      aria-label={open ? "Previous month" : `Back to ${returnLabel}`}
      className="mobile-navbar-action liquid-glass-button"
      onClick={() => (open ? shift(-1) : onBack())}
    >
      <ChevronLeft
        key={String(open)}
        className="nutrition-control-fade size-4"
      />
    </button>
  )
  const right = (
    <button
      aria-label={open ? "Next month" : "Edit nutrition targets"}
      className="mobile-navbar-action liquid-glass-button"
      onClick={() => {
        if (open) shift(1)
        else onTargets()
      }}
    >
      {open ? (
        <ChevronRight key="next" className="nutrition-control-fade size-4" />
      ) : (
        <Ellipsis key="menu" className="nutrition-control-fade size-4" />
      )}
    </button>
  )
  return (
    <div className={`nutrition-date-header ${open ? "is-open" : ""}`}>
      <MobileSiteNavbar
        title={title}
        titleLabel="Nutrition"
        left={left}
        showMenu={false}
        right={right}
        className={visible ? "calendar-picker-navbar-open" : ""}
      />
      <header className="hidden h-14 grid-cols-[44px_1fr_44px] items-center gap-3 px-4 md:grid">
        <div>{left}</div>
        <div className="text-center">{desktopTitle}</div>
        {right}
      </header>
      {visible && (
        <>
          <button
            tabIndex={-1}
            className="nutrition-date-dismiss"
            aria-label="Dismiss nutrition calendar"
            onClick={close}
          />
          <div
            id="nutrition-date-picker"
            className={`mobile-calendar-picker-panel nutrition-date-panel ${mobile ? "nutrition-date-panel-mobile" : "nutrition-date-panel-desktop"} ${closing ? "is-closing" : ""}`}
            role="region"
            aria-label="Choose date"
          >
            {mobile ? (
              <div ref={container} />
            ) : (
              <DateCalendar
                className="mx-auto [--cell-size:2.5rem]"
                classNames={{ month_caption: "hidden" }}
                hideNavigation
                weekStartsOn={1}
                mode="single"
                month={month}
                onMonthChange={setMonth}
                selected={new Date(`${date}T12:00:00`)}
                onSelect={(value) => {
                  if (value) {
                    onSelect(
                      `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
                    )
                    close()
                  }
                }}
              />
            )}
            <button
              className="mb-3 w-full py-2 text-sm font-medium"
              onClick={() => {
                onSelect(nutritionToday())
                close()
              }}
            >
              Today
            </button>
          </div>
        </>
      )}
    </div>
  )
}
