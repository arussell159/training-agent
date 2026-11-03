/** Web-drawn symbols with the native tab bar's filled selected treatment.
 * iOS supplies San Francisco for labels; no Apple font/icon files are bundled. */
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
      {page === "home" &&
        (selected ? (
          <path
            fill="currentColor"
            fillRule="evenodd"
            d="M3.1 12.3 12.4 4a2.4 2.4 0 0 1 3.2 0l9.3 8.3a1.3 1.3 0 0 1-1.7 2l-.9-.8v10a1.8 1.8 0 0 1-1.8 1.8h-13a1.8 1.8 0 0 1-1.8-1.8v-10l-.9.8a1.3 1.3 0 0 1-1.7-2ZM11 25.3h6v-9.1a1.2 1.2 0 0 0-1.2-1.2h-3.6a1.2 1.2 0 0 0-1.2 1.2Z"
          />
        ) : (
          <path
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m3.5 12.8 9.1-8.2a2.1 2.1 0 0 1 2.8 0l9.1 8.2M6.7 10v13.2a1 1 0 0 0 1 1H11v-8.1h6v8.1h3.3a1 1 0 0 0 1-1V10"
          />
        ))}
      {(page === "calendar" || page === "annual-plan") && (
        <>
          {selected ? (
            <path
              fill="currentColor"
              fillRule="evenodd"
              d="M7 4.5h14a3 3 0 0 1 3 3v15a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-15a3 3 0 0 1 3-3ZM6 9.7h16V8.2H6Zm2 3v2.7h2.7v-2.7Zm4.7 0v2.7h2.7v-2.7Zm4.7 0v2.7h2.7v-2.7ZM8 18v2.7h2.7V18Zm4.7 0v2.7h2.7V18Zm4.7 0v2.7h2.7V18Z"
            />
          ) : (
            <g
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="4.7" y="5.5" width="18.6" height="19" rx="2.5" />
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
      {page === "coach" &&
        (selected ? (
          <path
            fill="currentColor"
            fillRule="evenodd"
            d="M14 3C7.4 3 2.5 7.2 2.5 12.8c0 3.3 1.7 6.2 4.4 7.9L5.5 25l5.6-2.8c.9.2 1.9.3 2.9.3 6.6 0 11.5-4.2 11.5-9.7S20.6 3 14 3Zm-6.5 8.8a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Zm6.5 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Zm6.5 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Z"
          />
        ) : (
          <g
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M24.5 12.8c0 5-4.5 8.7-10.5 8.7-1.1 0-2.2-.1-3.1-.4l-4.3 2.2 1-3.6c-2.6-1.6-4.1-4-4.1-6.9C3.5 7.8 8 4 14 4s10.5 3.8 10.5 8.8Z" />
            <path d="M8 13h.01m6 0h.01m6 0h.01" strokeWidth="2.4" />
          </g>
        ))}
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
