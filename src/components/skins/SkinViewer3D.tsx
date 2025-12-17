import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from "react"
import { SkinViewer, WalkingAnimation, IdleAnimation, RunningAnimation, WaveAnimation } from "skinview3d"
import { Loader2 } from "lucide-react"

// Convert skin URLs to CORS-compatible URLs
// textures.minecraft.net doesn't send CORS headers, breaking WebGL texture loading
function getCorsCompatibleSkinUrl(url: string): string {
  // Extract texture hash from textures.minecraft.net URL
  const minecraftTextureMatch = url.match(/textures\.minecraft\.net\/texture\/([a-f0-9]+)/i)
  if (minecraftTextureMatch) {
    // Use mc-heads.net which supports CORS and can resolve texture hashes
    return `https://mc-heads.net/skin/${minecraftTextureMatch[1]}`
  }
  // Return original URL if it's already from a CORS-friendly source
  return url
}

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
  backgroundImage?: string
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
  backgroundImage,
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

  // Create/recreate viewer when core settings change (not skin/cape - those update dynamically)
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
      // skinview3d/Three.js doesn't understand "transparent" - use undefined for transparent background
      // When using a background image, make the canvas transparent so the CSS background shows through
      const bgColor = backgroundImage || background === "transparent" ? undefined : background

      // Convert skin URL to CORS-compatible URL
      const corsCompatibleSkinUrl = getCorsCompatibleSkinUrl(skinUrl)

      const viewer = new SkinViewer({
        canvas: canvasRef.current,
        width: dimensions.width || width,
        height: dimensions.height || height,
        skin: corsCompatibleSkinUrl,
        cape: capeUrl,
        model: slim ? "slim" : "default",
        background: bgColor,
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
      console.error("[SkinViewer3D] Failed to create viewer:", err)
      setError("Failed to load skin")
      setIsLoading(false)
    }

    return () => {
      if (viewerRef.current) {
        viewerRef.current.dispose()
        viewerRef.current = null
      }
    }
    // Note: skinUrl and capeUrl are handled by separate effects for efficiency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimensions.width, dimensions.height, width, height, animation, controls, zoom, slim, background, backgroundImage, onLoad])

  // Update skin dynamically without recreating the viewer
  useEffect(() => {
    if (viewerRef.current && skinUrl) {
      const corsCompatibleUrl = getCorsCompatibleSkinUrl(skinUrl)
      viewerRef.current.loadSkin(corsCompatibleUrl, { model: slim ? "slim" : "default" })
        .catch((err) => console.error("[SkinViewer3D] Failed to load skin:", err))
    }
  }, [skinUrl, slim])

  // Update cape dynamically without recreating the viewer
  useEffect(() => {
    if (viewerRef.current) {
      if (capeUrl) {
        viewerRef.current.loadCape(capeUrl)
          .catch((err) => console.error("[SkinViewer3D] Failed to load cape:", err))
      } else {
        viewerRef.current.resetCape()
      }
    }
  }, [capeUrl])

  // Build container style with optional background image
  const containerStyle: React.CSSProperties = fillContainer
    ? { width: "100%", height: "100%" }
    : { width, height }

  if (backgroundImage) {
    containerStyle.backgroundImage = `url(${backgroundImage})`
    containerStyle.backgroundSize = "cover"
    containerStyle.backgroundPosition = "center"
    containerStyle.backgroundRepeat = "no-repeat"
  } else if (background && background !== "transparent") {
    containerStyle.backgroundColor = background
  }

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
      style={containerStyle}
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
