import { useEffect, useState, useCallback, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTourStore } from "@/stores/tourStore"
import { useTranslation } from "@/i18n"

interface TargetRect {
  top: number
  left: number
  width: number
  height: number
}

export function TourOverlay() {
  const { t } = useTranslation()
  const {
    isActive,
    currentStepIndex,
    steps,
    nextStep,
    prevStep,
    skipTour,
  } = useTourStore()

  const [targetRect, setTargetRect] = useState<TargetRect | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 })
  const [progress, setProgress] = useState(0)
  const isProgrammaticClick = useRef(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const currentStep = steps[currentStepIndex]

  const updateTargetRect = useCallback(() => {
    if (!currentStep) return

    const element = document.querySelector(currentStep.targetSelector)
    if (element) {
      const rect = element.getBoundingClientRect()
      const padding = 8
      setTargetRect({
        top: rect.top - padding,
        left: rect.left - padding,
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
      })

      // Tooltip dimensions
      const tooltipWidth = 320
      const tooltipHeight = 200
      const margin = 20

      // Calculate tooltip position - prefer below the element
      let x = rect.left + rect.width / 2
      let y = rect.bottom + margin

      // If tooltip would go below viewport, put it above
      if (y + tooltipHeight > window.innerHeight - margin) {
        y = rect.top - tooltipHeight - margin
      }

      // If still off-screen (element too high), center vertically
      if (y < margin) {
        y = Math.max(margin, (window.innerHeight - tooltipHeight) / 2)
      }

      // Keep horizontal position in viewport (x is center, so check left/right edges)
      // Left edge: x - 160 >= margin => x >= margin + 160
      // Right edge: x + 160 <= window.innerWidth - margin => x <= window.innerWidth - margin - 160
      const minX = margin + tooltipWidth / 2
      const maxX = window.innerWidth - margin - tooltipWidth / 2
      x = Math.max(minX, Math.min(maxX, x))

      setTooltipPosition({ x, y })
    }
  }, [currentStep])

  useEffect(() => {
    if (!isActive || !currentStep) return

    // If this is a tab, activate it using keyboard navigation
    const clickTimeout = setTimeout(() => {
      if (currentStep.id.endsWith("-tab")) {
        const element = document.querySelector(currentStep.targetSelector) as HTMLButtonElement
        if (element) {
          // Mark as programmatic click so we don't auto-advance
          isProgrammaticClick.current = true

          // Focus and press Space to activate (Radix tabs respond to keyboard)
          element.focus()
          const spaceEvent = new KeyboardEvent("keydown", {
            key: " ",
            code: "Space",
            keyCode: 32,
            which: 32,
            bubbles: true,
            cancelable: true,
          })
          element.dispatchEvent(spaceEvent)

          setTimeout(() => {
            isProgrammaticClick.current = false
          }, 150)

          // Update rect after tab content renders
          setTimeout(updateTargetRect, 200)
        }
      }
    }, 100)

    // Initial update with delay to let tab content render
    const initialTimeout = setTimeout(updateTargetRect, 200)

    // Update on resize/scroll
    window.addEventListener("resize", updateTargetRect)
    window.addEventListener("scroll", updateTargetRect, true)

    return () => {
      window.removeEventListener("resize", updateTargetRect)
      window.removeEventListener("scroll", updateTargetRect, true)
      clearTimeout(initialTimeout)
      clearTimeout(clickTimeout)
    }
  }, [isActive, currentStep, updateTargetRect])

  // Click on highlighted element to go next (only for user clicks, not programmatic)
  useEffect(() => {
    if (!isActive || !currentStep) return

    const element = document.querySelector(currentStep.targetSelector)
    if (element) {
      const handleClick = () => {
        // Ignore programmatic clicks (when we auto-click tabs)
        if (isProgrammaticClick.current) return
        // Clear timer and advance
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        nextStep()
      }
      element.addEventListener("click", handleClick)
      return () => element.removeEventListener("click", handleClick)
    }
  }, [isActive, currentStep, nextStep])

  // Check if we're on a step that needs special handling (no auto-advance)
  const isInstallStep = currentStep?.id === "install-button"
  const isFinalPlayStep = currentStep?.id === "play-button-final"
  const isWaitingStep = isInstallStep || isFinalPlayStep

  // Auto-advance timer - use key based on step to restart timer
  const stepKey = `${isActive}-${currentStepIndex}`

  useEffect(() => {
    if (!isActive) return

    // Clear any existing timer
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    // Don't auto-advance on waiting steps - wait for user interaction
    if (isWaitingStep) {
      setProgress(0)
      return
    }

    // Reset progress
    setProgress(0)
    let currentProgress = 0

    const advanceStep = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      setProgress(100)
      // Use setTimeout to break out of the setInterval callback
      setTimeout(() => nextStep(), 0)
    }

    // PERFORMANCE: Reduced update frequency from 100ms to 200ms for tour progress
    // Still smooth enough for user experience but cuts updates in half
    timerRef.current = setInterval(() => {
      currentProgress += 4 // 4% every 200ms = 5 seconds total

      if (currentProgress >= 100) {
        advanceStep()
      } else {
        setProgress(currentProgress)
      }
    }, 200)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey, isWaitingStep])

  if (!isActive || !currentStep || !targetRect) return null

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] pointer-events-none" data-tour-overlay>
        {/* Dark overlay with spotlight cutout */}
        <svg className="absolute inset-0 w-full h-full pointer-events-auto" data-tour-overlay>
          <defs>
            <mask id="spotlight-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              <motion.rect
                initial={{ opacity: 0 }}
                animate={{
                  x: targetRect.left,
                  y: targetRect.top,
                  width: targetRect.width,
                  height: targetRect.height,
                  opacity: 1,
                }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                rx="8"
                fill="black"
              />
            </mask>
          </defs>
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="rgba(0,0,0,0.75)"
            mask="url(#spotlight-mask)"
          />
        </svg>

        {/* Highlight border */}
        <motion.div
          className="absolute border-2 border-primary rounded-lg pointer-events-none"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{
            opacity: 1,
            scale: 1,
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
          }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          style={{
            boxShadow: "0 0 0 4px rgba(var(--primary), 0.3), 0 0 20px rgba(var(--primary), 0.2)",
          }}
        />

        {/* Pulse animation on target */}
        <motion.div
          className="absolute rounded-lg pointer-events-none"
          animate={{
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
            boxShadow: [
              "0 0 0 0 rgba(var(--primary), 0.4)",
              "0 0 0 10px rgba(var(--primary), 0)",
            ],
          }}
          transition={{
            boxShadow: {
              duration: 1.5,
              repeat: Infinity,
              ease: "easeOut",
            },
          }}
        />

        {/* Clickable area over the target - allows clicks to pass through */}
        <div
          className="absolute cursor-pointer"
          style={{
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
            pointerEvents: "auto",
          }}
          onClick={() => {
            // Find and click the actual element
            const element = document.querySelector(currentStep.targetSelector) as HTMLElement
            if (element) {
              isProgrammaticClick.current = true
              element.click()
              setTimeout(() => {
                isProgrammaticClick.current = false
              }, 150)

              // On install-button step, advance to next step after clicking
              if (currentStep.id === "install-button") {
                setTimeout(() => nextStep(), 300)
              }
              // On final play-button step, end the tour
              if (currentStep.id === "play-button-final") {
                setTimeout(() => skipTour(), 300)
              }
            }
          }}
        />

        {/* Tooltip */}
        <motion.div
          className="absolute pointer-events-auto"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{
            opacity: 1,
            scale: 1,
            left: tooltipPosition.x - 160, // 160 = half of w-80 (320px)
            top: tooltipPosition.y,
          }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        >
          <div className="bg-card border rounded-xl shadow-2xl p-4 w-80">
            {/* Progress indicator with timer */}
            <div className="flex items-center gap-1 mb-3">
              {steps.map((_, index) => (
                <div
                  key={index}
                  className="h-1 flex-1 rounded-full bg-muted overflow-hidden"
                >
                  <div
                    className="h-full bg-primary transition-all duration-100"
                    style={{
                      width: index < currentStepIndex
                        ? "100%"
                        : index === currentStepIndex
                          ? `${progress}%`
                          : "0%"
                    }}
                  />
                </div>
              ))}
            </div>

            {/* Content */}
            <div className="space-y-2 mb-4">
              <h3 className="font-semibold text-lg">{currentStep.title}</h3>
              <p className="text-sm text-muted-foreground">{currentStep.description}</p>
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={skipTour}>
                <X className="h-4 w-4 mr-1" />
                {t("common.skip")}
              </Button>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={prevStep}
                  disabled={currentStepIndex === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button size="sm" onClick={() => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } nextStep(); }}>
                  {currentStepIndex === steps.length - 1 ? (
                    t("tour.finish")
                  ) : (
                    <>
                      {t("common.next")}
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Step counter */}
            <p className="text-xs text-muted-foreground text-center mt-3">
              {currentStepIndex + 1} / {steps.length}
            </p>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
