import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from "react"
import { SkinViewer, WalkingAnimation, IdleAnimation, RunningAnimation, WaveAnimation } from "skinview3d"
import { Loader2 } from "lucide-react"

export type AnimationType = "idle" | "walk" | "run" | "wave" | "none"

export interface SkinViewer3DRef {
  takeScreenshot: () => string | null
  resetCamera: () => void
  setZoom: (zoom: number) => void
  rotate: (x: number, y: number) => void
}

interface SkinViewer3DProps {
  skinUrl: string
  capeUrl?: string
  width?: number
  height?: number
  animation?: AnimationType
  controls?: boolean
  zoom?: boolean
  slim?: boolean
  className?: string
  background?: string
  fillContainer?: boolean
  onLoad?: () => void
}

export const SkinViewer3D = forwardRef<SkinViewer3DRef, SkinViewer3DProps>(({
  skinUrl,
  capeUrl,
  width = 300,
  height = 400,
  animation = "idle",
  controls = true,
  zoom = true,
  slim = false,
  className = "",
  background = "transparent",
  fillContainer = false,
  onLoad,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<SkinViewer | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dimensions, setDimensions] = useState({ width, height })

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    takeScreenshot: () => {
      if (viewerRef.current) {
        return viewerRef.current.canvas.toDataURL("image/png")
      }
      return null
    },
    resetCamera: () => {
      if (viewerRef.current) {
        viewerRef.current.controls.reset()
        viewerRef.current.zoom = 0.9
      }
    },
    setZoom: (zoomLevel: number) => {
      if (viewerRef.current) {
        viewerRef.current.zoom = zoomLevel
      }
    },
    rotate: (x: number, y: number) => {
      if (viewerRef.current) {
        viewerRef.current.playerObject.rotation.y = y
        viewerRef.current.playerObject.rotation.x = x
      }
    },
  }))

  // Handle container resize for fillContainer mode
  const updateDimensions = useCallback(() => {
    if (fillContainer && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      setDimensions({ width: rect.width, height: rect.height })
    } else {
      setDimensions({ width, height })
    }
  }, [fillContainer, width, height])

  useEffect(() => {
    updateDimensions()

    if (fillContainer && containerRef.current) {
      const resizeObserver = new ResizeObserver(() => {
        updateDimensions()
      })
      resizeObserver.observe(containerRef.current)
      return () => resizeObserver.disconnect()
    }
  }, [fillContainer, updateDimensions])

  // Resize viewer when dimensions change
  useEffect(() => {
    if (viewerRef.current && dimensions.width > 0 && dimensions.height > 0) {
      viewerRef.current.width = dimensions.width
      viewerRef.current.height = dimensions.height
    }
  }, [dimensions])

  useEffect(() => {
    if (!canvasRef.current) return

    setIsLoading(true)
    setError(null)

    // Clean up existing viewer
    if (viewerRef.current) {
      viewerRef.current.dispose()
      viewerRef.current = null
    }

    try {
      const viewer = new SkinViewer({
        canvas: canvasRef.current,
        width: dimensions.width || width,
        height: dimensions.height || height,
        skin: skinUrl,
        cape: capeUrl,
        model: slim ? "slim" : "default",
        background,
      })

      // Set up controls
      viewer.controls.enabled = controls
      viewer.zoom = zoom ? 0.9 : 1

      if (controls) {
        viewer.controls.enableRotate = true
        viewer.controls.enableZoom = zoom
        viewer.controls.enablePan = false
      }

      // Set up animation
      switch (animation) {
        case "walk":
          viewer.animation = new WalkingAnimation()
          break
        case "run":
          viewer.animation = new RunningAnimation()
          break
        case "wave":
          viewer.animation = new WaveAnimation()
          break
        case "idle":
          viewer.animation = new IdleAnimation()
          break
        case "none":
        default:
          viewer.animation = null
          break
      }

      // Animation speed
      if (viewer.animation) {
        viewer.animation.speed = 0.8
      }

      viewerRef.current = viewer
      setIsLoading(false)
      onLoad?.()
    } catch (err) {
      console.error("Failed to create skin viewer:", err)
      setError("Failed to load skin")
      setIsLoading(false)
    }

    return () => {
      if (viewerRef.current) {
        viewerRef.current.dispose()
        viewerRef.current = null
      }
    }
  }, [skinUrl, capeUrl, dimensions.width, dimensions.height, width, height, animation, controls, zoom, slim, background, onLoad])

  // Update skin when URL changes
  useEffect(() => {
    if (viewerRef.current && skinUrl) {
      viewerRef.current.loadSkin(skinUrl, { model: slim ? "slim" : "default" })
    }
  }, [skinUrl, slim])

  // Update cape when URL changes
  useEffect(() => {
    if (viewerRef.current) {
      if (capeUrl) {
        viewerRef.current.loadCape(capeUrl)
      } else {
        viewerRef.current.resetCape()
      }
    }
  }, [capeUrl])

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
      style={fillContainer ? { width: "100%", height: "100%" } : { width, height }}
    >
      <canvas
        ref={canvasRef}
        className="rounded-lg"
        style={{
          width: "100%",
          height: "100%",
          opacity: isLoading ? 0.5 : 1,
          transition: "opacity 0.2s",
        }}
      />
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/50 rounded-lg">
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      )}
    </div>
  )
})

SkinViewer3D.displayName = "SkinViewer3D"
