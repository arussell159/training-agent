import { Bike, Dumbbell, Timer, Waves } from "lucide-react"
import { desktopSportPaths } from "./desktop-sport-icon-paths"
import { desktopVariantIcons } from "./desktop-variant-icon-paths"
export function DesktopSportIcon({ sport }: { sport: string }) {
  const variantName = /^brick$/i.test(sport) ? "Brick" : /^day[ -]?off$/i.test(sport) ? "Day off" : /^custom$/i.test(sport) ? "Custom" : null
  if (variantName) {
    const glyph = desktopVariantIcons[variantName]
    return <svg width="20" height="20" viewBox={glyph.viewBox} fill="none" aria-hidden="true">{glyph.paths.map((path,index)=><path key={index} {...path}/>)}</svg>
  }
  const glyph = /run/i.test(sport) ? "Run"
    : /walk/i.test(sport) ? "Walk"
    : /bike|ride|brick/i.test(sport) ? "Bike"
    : /swim/i.test(sport) ? "Swim"
    : /row/i.test(sport) ? "Rowing"
    : /nordic|xc-ski/i.test(sport) ? "XC-Ski"
    : /other|sauna|workout|crosstrain/i.test(sport) ? "Other" : null
  if (glyph)
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        {desktopSportPaths[glyph].map((path, index) => <path key={index} {...path} />)}
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
