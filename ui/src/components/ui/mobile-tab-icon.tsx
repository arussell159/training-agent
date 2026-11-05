// Share the outline in both states so filling the symbol never moves its edges.
const calendarOutline =
  "M7.2 5.5h13.6a2.5 2.5 0 0 1 2.5 2.5v14a2.5 2.5 0 0 1-2.5 2.5H7.2a2.5 2.5 0 0 1-2.5-2.5V8a2.5 2.5 0 0 1 2.5-2.5Z"
const calendarMarks = [14.5, 19.5]
  .flatMap((y) =>
    [9, 14, 19].map((x) => `M${x - 1.3} ${y - 1.3}h2.6v2.6h-2.6Z`)
  )
  .join(" ")
const planMarks =
  "M9 13.55h10a.95.95 0 0 1 0 1.9H9a.95.95 0 0 1 0-1.9ZM9 18.55h7a.95.95 0 0 1 0 1.9H9a.95.95 0 0 1 0-1.9Z"
const coachOutline =
  "M24.5 12.8c0 5-4.5 8.7-10.5 8.7-1.1 0-2.2-.1-3.1-.4l-4.3 2.2 1-3.6c-2.6-1.6-4-4.1-4.1-6.9C3.5 7.8 8 4 14 4s10.5 3.8 10.5 8.8Z"
const coachMarks = [8, 14, 20]
  .map((x) => `M${x} 11.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 1 0 0-2.4Z`)
  .join(" ")

/** Web-drawn symbols with the native tab bar's filled selected treatment. */
export function MobileTabIcon({
  page,
  selected,
}: {
  page: string
  selected: boolean
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 28 28"
      fill="none"
      className="mobile-tab-icon"
    >
      {page === "home" && (
        <path
          fill={selected ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          d="m3.5 12.8 9.1-8.2a2.1 2.1 0 0 1 2.8 0l9.1 8.2-3.2-2.9v13.3a1 1 0 0 1-1 1H17v-8.1h-6v8.1H7.7a1 1 0 0 1-1-1V9.9Z"
        />
      )}
      {(page === "calendar" || page === "annual-plan") && (
        <>
          {selected && (
            <path
              fill="currentColor"
              fillRule="evenodd"
              d={`${calendarOutline} M6.6 9.05h14.8v1.9H6.6Z ${page === "calendar" ? calendarMarks : planMarks}`}
            />
          )}
          <path d={calendarOutline} stroke="currentColor" strokeWidth="1.9" />
          {!selected && (
            <g
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 10h18" />
              {page === "calendar" ? (
                <path
                  d="M9 14.5h.01m5 0h.01m5 0h.01M9 19.5h.01m5 0h.01m5 0h.01"
                  strokeWidth="2.6"
                />
              ) : (
                <path d="M9 14.5h10M9 19.5h7" />
              )}
            </g>
          )}
          <path
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            d="M9 3.5v3.7m10-3.7v3.7"
          />
          {page === "annual-plan" && (
            <path
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              d="M1.8 12.5v8"
            />
          )}
        </>
      )}
      {page === "coach" && (
        <>
          {selected && (
            <path
              fill="currentColor"
              fillRule="evenodd"
              d={`${coachOutline} ${coachMarks}`}
            />
          )}
          <g
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={coachOutline} />
            {!selected && (
              <path d="M8 13h.01m6 0h.01m6 0h.01" strokeWidth="2.4" />
            )}
          </g>
        </>
      )}
      {page === "settings" && (
        <path
          stroke="currentColor"
          strokeWidth="2.7"
          strokeLinecap="round"
          d="M5 7h18M5 14h18M5 21h18"
        />
      )}
    </svg>
  )
}
