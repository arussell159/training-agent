import { Calendar } from "@/components/ui/calendar"

type DatePickerCalendarProps = {
  defaultMonth: Date
  month?: Date
  onMonthChange?: (month: Date) => void
  selected?: Date
  onSelect: (date: Date | undefined) => void
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6
}

export function DatePickerCalendar({
  defaultMonth,
  month,
  onMonthChange,
  selected,
  onSelect,
  weekStartsOn = 1,
}: DatePickerCalendarProps) {
  return (
    <Calendar
      className="mx-auto [--cell-size:2.5rem]"
      mode="single"
      captionLayout="dropdown"
      weekStartsOn={weekStartsOn}
      startMonth={new Date(1900, 0)}
      endMonth={new Date(new Date().getFullYear() + 10, 11)}
      defaultMonth={defaultMonth}
      month={month}
      onMonthChange={onMonthChange}
      selected={selected}
      onSelect={onSelect}
    />
  )
}
