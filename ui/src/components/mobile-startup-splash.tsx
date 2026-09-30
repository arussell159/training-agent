export function MobileStartupSplash() {
  return (
    <div
      role="status"
      aria-label="Loading AR Performance"
      className="fixed inset-0 z-[10000] bg-[#061a46] md:hidden"
    >
      <img
        src="/ar-performance-mobile-splash.jpg"
        alt=""
        className="h-full w-full object-cover"
        fetchPriority="high"
      />
    </div>
  )
}

