import { useEffect, useRef, useState } from "react"
import { ThemeProvider, createTheme } from "@mui/material/styles"
import { DesktopDatePicker } from "@mui/x-date-pickers/DesktopDatePicker"
import { DesktopTimePicker } from "@mui/x-date-pickers/DesktopTimePicker"
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider"
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns"
import type {} from "@mui/x-date-pickers/themeAugmentation"
import { format, isValid, parse } from "date-fns"
import "./desktop-strength-date-time.css"

// Scoped provider: the application's branding and other controls retain their theme.
const pickerTheme = createTheme({
  typography: {
    htmlFontSize: 14,
    fontFamily: 'InterVariable, "Inter Variable", Inter, sans-serif',
    body1: { fontSize: 15, lineHeight: 1.4375 },
    body2: { fontSize: 13, lineHeight: 1.25 },
    caption: { fontSize: 11, lineHeight: 1.25 },
    button: { fontSize: 15, lineHeight: 1.25, textTransform: "none" },
  },
  palette: {
    mode: "light",
    primary: { main: "#0d2994" },
    text: { primary: "#1a202e", secondary: "#6a758f" },
    action: { active: "#414e6c" },
  },
  components: {
    MuiPickerPopper: {
      styleOverrides: {
        paper: { boxShadow: "0 8px 16px rgba(26,32,46,.3)" },
      },
    },
    MuiPickerDay: {
      styleOverrides: {
        root: {
          fontSize: 11,
          lineHeight: 1.25,
          "&.Mui-selected": { fontWeight: 500 },
        },
      },
    },
    MuiPickersOutlinedInput: {
      styleOverrides: {
        root: { fontSize: 15, lineHeight: 1.5 },
        sectionsContainer: {
          paddingTop: 8.5,
          paddingBottom: 8.5,
          fontSize: 15,
          lineHeight: 1.4375,
        },
      },
    },
  },
})

const reference = new Date(2000, 0, 1, 12)
const dateValue = (value: string) => {
  const parsed = parse(value, "yyyy-MM-dd", reference)
  return isValid(parsed) && format(parsed, "yyyy-MM-dd") === value
    ? parsed
    : null
}
const timeValue = (value: string) => {
  if (!/^\d{2}:\d{2}$/.test(value)) return null
  const parsed = parse(value, "HH:mm", reference)
  return isValid(parsed) && format(parsed, "HH:mm") === value ? parsed : null
}

export function DesktopStrengthDateTime({
  date,
  time,
  disabled,
  onDate,
  onTime,
  onValidity,
}: {
  date: string
  time: string
  disabled: boolean
  onDate: (value: string) => void
  onTime: (value: string) => void
  onValidity: (invalid: boolean) => void
}) {
  const dateRoot = useRef<HTMLDivElement>(null),
    timeRoot = useRef<HTMLDivElement>(null)
  const restorePickerFocus = (root: HTMLDivElement | null) => {
    // The outer Base UI dialog and MUI's nested focus trap both manage focus.
    // Restore only a lost focus, without stealing a user's click on another field.
    requestAnimationFrame(() => {
      if (root?.isConnected && document.activeElement === document.body)
        root
          .querySelector<HTMLButtonElement>("button")
          ?.focus({ preventScroll: true })
    })
  }
  const [dateDraft, setDateDraft] = useState(() => dateValue(date)),
    [timeDraft, setTimeDraft] = useState(() => timeValue(time)),
    [dateError, setDateError] = useState(false),
    [timeError, setTimeError] = useState(false),
    [timeOpen, setTimeOpen] = useState(false)
  const validity = useRef({ date: false, time: false })
  const reportValidity = (field: "date" | "time", invalid: boolean) => {
    validity.current[field] = invalid
    onValidity(validity.current.date || validity.current.time)
  }
  useEffect(() => {
    setDateDraft(dateValue(date))
  }, [date])
  useEffect(() => {
    setTimeDraft(timeValue(time))
  }, [time])

  return (
    <ThemeProvider theme={pickerTheme}>
      <LocalizationProvider
        dateAdapter={AdapterDateFns}
        localeText={{ hoursClockNumberText: (hours) => `${hours} hours` }}
      >
        <div ref={dateRoot} className="dsb-picker-field dsb-picker-date">
          <DesktopDatePicker
            value={dateDraft}
            disabled={disabled}
            format="MM/dd/yyyy"
            onChange={(value, context) => {
              setDateDraft(value)
              const invalid =
                !value || !isValid(value) || Boolean(context.validationError)
              setDateError(invalid)
              reportValidity("date", invalid)
              if (!invalid && isValid(value))
                onDate(format(value, "yyyy-MM-dd"))
            }}
            onError={(error, value) => {
              const invalid = Boolean(error) || !value || !isValid(value)
              setDateError(invalid)
              reportValidity("date", invalid)
            }}
            slotProps={{
              textField: {
                size: "small",
                "aria-label": "Workout date",
                required: true,
                error: dateError,
              },
              popper: { disablePortal: true, className: "dsb-picker-popover" },
              desktopTransition: {
                onExited: () => restorePickerFocus(dateRoot.current),
              },
              actionBar: { actions: [] },
            }}
          />
        </div>
        <div ref={timeRoot} className="dsb-picker-field dsb-picker-time">
          <DesktopTimePicker
            label="Start Time"
            value={timeDraft}
            disabled={disabled}
            ampm
            format="hh:mm a"
            timeSteps={{ minutes: 5 }}
            onOpen={() => setTimeOpen(true)}
            onClose={() => {
              setTimeOpen(false)
              setTimeDraft(timeValue(time))
              setTimeError(false)
              reportValidity("time", false)
            }}
            onChange={(value, context) => {
              setTimeDraft(value)
              const invalid =
                Boolean(context.validationError) ||
                (value != null && !isValid(value))
              setTimeError(invalid)
              reportValidity("time", invalid)
              // Popup choices are a draft until OK; Cancel leaves the model untouched.
              if (
                !timeOpen &&
                !context.validationError &&
                (!value || isValid(value))
              )
                onTime(value ? format(value, "HH:mm") : "")
            }}
            onAccept={(value, context) => {
              const invalid =
                Boolean(context.validationError) ||
                (value != null && !isValid(value))
              setTimeError(invalid)
              reportValidity("time", invalid)
              if (!context.validationError && (!value || isValid(value)))
                onTime(value ? format(value, "HH:mm") : "")
            }}
            onError={(error, value) => {
              const invalid =
                Boolean(error) || (value != null && !isValid(value))
              setTimeError(invalid)
              reportValidity("time", invalid)
            }}
            slotProps={{
              textField: {
                size: "small",
                "aria-label": "Start Time",
                error: timeError,
              },
              popper: { disablePortal: true, className: "dsb-picker-popover" },
              desktopTransition: {
                onExited: () => restorePickerFocus(timeRoot.current),
              },
              actionBar: { actions: ["cancel", "accept"] },
            }}
          />
        </div>
      </LocalizationProvider>
    </ThemeProvider>
  )
}
