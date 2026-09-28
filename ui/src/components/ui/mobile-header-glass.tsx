import LiquidGlass from "liquid-glass-react"

/** Visual surface only. The surrounding native button or select owns input. */
export function MobileHeaderGlass() {
  return (
    <span className="mobile-header-glass-wrap" aria-hidden="true">
      <LiquidGlass
        className="mobile-header-glass"
        displacementScale={24}
        blurAmount={0.1}
        saturation={130}
        aberrationIntensity={1}
        elasticity={0}
        cornerRadius={100}
        padding="0"
        style={{ position: "absolute", top: "50%", left: "50%" }}
      >
        <span className="mobile-header-glass-size" />
      </LiquidGlass>
    </span>
  )
}
