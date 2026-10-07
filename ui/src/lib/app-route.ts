const routes = {
  "/": "Home",
  "/nutrition": "Nutrition",
  "/calendar": "Calendar",
  "/week": "Calendar",
  "/coach": "Coach",
  "/atp": "Annual Plan",
  "/annual-plan": "Annual Plan",
  "/settings": "Settings",
  "/library": "Library",
  "/workout-reports": "Workout Reports",
} as const

// Startup and the live workspace must resolve exactly the same screen.
export function appRouteItem(pathname = window.location.pathname) {
  const path = pathname.replace(/\/+$/, "") || "/"
  return Object.hasOwn(routes, path)
    ? routes[path as keyof typeof routes]
    : "Home"
}
