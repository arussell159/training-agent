import { Bike, Dumbbell, Timer, Waves } from "lucide-react"
export function DesktopSportIcon({ sport }: { sport: string }) {
  if (/run/i.test(sport))
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        stroke="#55a81b"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 3 7 2l2 5 3 3 5 3c1 .5 1.5 2 .5 3-3 2-7 1-10-1L2 11c-2-2 0-3 1-4L4 3Z" />
        <path d="m7 6 3-1m-2 3 3-1m-1 3 3-1M2 10l6 5c3 2 6 3 9 1" />
      </svg>
    )
  const Icon = /swim/i.test(sport)
    ? Waves
    : /bike|ride|brick/i.test(sport)
      ? Bike
      : /strength|weight/i.test(sport)
        ? Dumbbell
        : Timer
  const color = /swim/i.test(sport)
    ? "#19aabd"
    : /bike|ride|brick/i.test(sport)
      ? "#8627aa"
      : "#a545dd"
  return (
    <Icon
      aria-hidden="true"
      style={{ color, width: 20, height: 20, strokeWidth: 1.4 }}
    />
  )
}
