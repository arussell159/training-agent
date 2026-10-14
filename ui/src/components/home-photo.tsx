import { useEffect, useLayoutEffect, useRef, useState } from "react"

// Subject bounds include a little room around the athlete and, for cycling,
// both wheels. Fit these bounds, rather than cropping the subject with cover.
const photos = {
  "bike-side": {
    width: 1400,
    height: 933,
    subject: { x: 0.17, y: 0.095, width: 0.465, height: 0.705 },
  },
  "bike-bridge": {
    width: 1400,
    height: 933,
    subject: { x: 0.35, y: 0.2, width: 0.325, height: 0.59 },
  },
  "run-waco": {
    width: 933,
    height: 1400,
    subject: { x: 0.32, y: 0.07, width: 0.295, height: 0.49 },
  },
  "run-texas": {
    width: 934,
    height: 1400,
    subject: { x: 0.31, y: 0.36, width: 0.325, height: 0.555 },
  },
  "finish-texas": {
    width: 1400,
    height: 934,
    subject: { x: 0.585, y: 0.39, width: 0.105, height: 0.395 },
  },
} as const

type Photo = keyof typeof photos
const frames = {
  hero: { x: 0.64, y: 0.23, width: 0.32, height: 0.38 },
  session: { x: 0.54, y: 0.08, width: 0.43, height: 0.78 },
  race: { x: 0.52, y: 0.12, width: 0.46, height: 0.8 },
} as const

export function sessionPhoto(sport: string, id: string): Photo {
  const variant =
    Array.from(id).reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 2
  return /bike|ride/i.test(sport)
    ? (["bike-side", "bike-bridge"] as const)[variant]
    : (["run-waco", "run-texas"] as const)[variant]
}

export function HomePhoto({
  photo,
  frame,
}: {
  photo: Photo
  frame: keyof typeof frames
}) {
  const ref = useRef<HTMLImageElement>(null)
  const [visible, setVisible] = useState(frame === "hero")

  useEffect(() => {
    if (frame === "hero" || typeof IntersectionObserver === "undefined") {
      setVisible(true)
      return
    }
    const container = ref.current?.parentElement
    if (!container) return
    // Defer both layers of lower cards, preserving the first screen's bandwidth.
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      setVisible(true)
      observer.disconnect()
    }, { rootMargin: "200px 0px" })
    observer.observe(container)
    return () => observer.disconnect()
  }, [frame])

  useLayoutEffect(() => {
    const element = ref.current
    const container = element?.parentElement
    if (!element || !container) return
    const fit = () => {
      const { width, height } = container.getBoundingClientRect()
      if (!width || !height) return
      const image = photos[photo]
      const subject = image.subject
      const region = frames[frame]
      const scale = Math.min(
        (width * region.width) / (image.width * subject.width),
        (height * region.height) / (image.height * subject.height)
      )
      const left =
        width * (region.x + region.width / 2) -
        image.width * scale * (subject.x + subject.width / 2)
      const top =
        height * (region.y + region.height / 2) -
        image.height * scale * (subject.y + subject.height / 2)
      element.style.width = `${image.width * scale}px`
      element.style.height = `${image.height * scale}px`
      element.style.left = `${left}px`
      element.style.top = `${top}px`
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(container)
    return () => observer.disconnect()
  }, [photo, frame])

  return (
    <div
      className={`home-photo home-${frame}-photo`}
      data-photo={photo}
      aria-hidden="true"
      style={visible ? { backgroundImage: `url("/images/home/${photo}.webp")` } : undefined}
    >
      <img
        ref={ref}
        className="home-photo-subject"
        src={visible ? `/images/home/${photo}.webp` : undefined}
        loading={frame === "hero" ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={frame === "hero" ? "high" : "low"}
        alt=""
      />
    </div>
  )
}
