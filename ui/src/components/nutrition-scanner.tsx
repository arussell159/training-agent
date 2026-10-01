import { useEffect, useRef, useState } from "react"
import {
  Camera,
  LoaderCircle,
  StopCircle,
  ScanBarcode,
  ImagePlus,
} from "lucide-react"
import { Button } from "@/components/ui/button"

export function NutritionScanner({
  onCode,
}: {
  onCode: (code: string) => void
}) {
  const video = useRef<HTMLVideoElement>(null),
    controls = useRef<{ stop: () => void } | null>(null),
    alive = useRef(true),
    scanVersion = useRef(0)
  const [active, setActive] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("")
  const stop = () => {
    scanVersion.current++
    controls.current?.stop()
    controls.current = null
    const stream = video.current?.srcObject
    if (stream instanceof MediaStream)
      stream.getTracks().forEach((track) => track.stop())
    setActive(false)
    setBusy(false)
  }
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      controls.current?.stop()
    }
  }, [])
  async function start() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(
        "Camera scanning needs HTTPS or localhost. You can upload a barcode photo or type its number instead."
      )
      return
    }
    setError("")
    setBusy(true)
    setActive(true)
    const version = ++scanVersion.current
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser")
      if (!alive.current || version !== scanVersion.current) return
      const reader = new BrowserMultiFormatReader(undefined, {
        delayBetweenScanAttempts: 200,
        delayBetweenScanSuccess: 1000,
      })
      const scanner = await reader.decodeFromVideoDevice(
        undefined,
        video.current!,
        (result, _error, scanner) => {
          if (
            result &&
            /^\d{8,14}$/.test(result.getText()) &&
            alive.current &&
            version === scanVersion.current
          ) {
            scanner.stop()
            stop()
            onCode(result.getText())
          }
        }
      )
      if (!alive.current || version !== scanVersion.current) scanner.stop()
      else controls.current = scanner
    } catch {
      if (alive.current && version === scanVersion.current) {
        setError(
          "Camera couldn’t start. Check camera permission, upload a barcode photo, or type the number."
        )
        stop()
      }
    } finally {
      if (alive.current && version === scanVersion.current) setBusy(false)
    }
  }
  async function readFile(file: File) {
    stop()
    setError("")
    setBusy(true)
    const url = URL.createObjectURL(file)
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser")
      const result = await new BrowserMultiFormatReader().decodeFromImageUrl(
        url
      )
      if (!/^\d{8,14}$/.test(result.getText())) throw Error()
      if (alive.current) onCode(result.getText())
    } catch {
      if (alive.current)
        setError(
          "No food barcode found. Try a clearer photo or type the digits below the barcode."
        )
    } finally {
      URL.revokeObjectURL(url)
      if (alive.current) setBusy(false)
    }
  }
  return (
    <div className="space-y-4">
      {!active && (
        <div className="nutrition-photo-picker">
          <ScanBarcode className="size-12 text-muted-foreground" />
          <p className="font-medium">Scan your food's barcode</p>
          <p className="text-center text-xs text-muted-foreground">
            Center the barcode in the frame, or choose a photo.
          </p>
        </div>
      )}
      <div
        className={`relative overflow-hidden rounded-2xl bg-slate-950 ${active ? "" : "hidden"}`}
      >
        <video
          ref={video}
          playsInline
          muted
          className="aspect-[4/3] w-full object-cover"
          aria-label="Barcode camera"
        />
        <div className="pointer-events-none absolute inset-x-8 top-1/3 h-1/3 rounded-lg border-2 border-white/80" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Button
          type="button"
          variant="outline"
          className="h-12 rounded-full"
          disabled={busy && !active}
          onClick={() => (active ? stop() : void start())}
        >
          {busy ? (
            <LoaderCircle className="animate-spin" />
          ) : active ? (
            <StopCircle />
          ) : (
            <Camera />
          )}
          {active ? "Stop camera" : "Open camera"}
        </Button>
        <label className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-full border bg-background px-4 text-sm font-medium">
          <ImagePlus className="size-4" />
          Choose photo
          <input
            className="sr-only"
            aria-label="Upload barcode photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void readFile(file)
              e.target.value = ""
            }}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

export async function prepareMealPhoto(file: File): Promise<string> {
  if (
    ![
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ].includes(file.type) ||
    file.size > 20000000
  )
    throw Error("Choose a photo under 20 MB. JPG, PNG, or WebP works best.")
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const scale = Math.min(
      1,
      1280 / Math.max(image.naturalWidth, image.naturalHeight)
    )
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext("2d")
    if (!context) throw Error("Photo processing is unavailable.")
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const result = canvas.toDataURL("image/jpeg", 0.8)
    if (result.length > 2800000) throw Error("Please use a smaller photo.")
    return result
  } catch (error) {
    throw Error(
      error instanceof Error && !/source image/i.test(error.message)
        ? error.message
        : "This photo format couldn’t be opened. Try a JPG or PNG.",
      { cause: error }
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}
