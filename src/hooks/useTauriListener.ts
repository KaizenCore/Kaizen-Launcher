import { useEffect, useRef } from "react"
import { listen, UnlistenFn, Event } from "@tauri-apps/api/event"

/**
 * Custom hook for safely listening to Tauri events with proper cleanup.
 *
 * This hook handles the race condition that can occur when a component unmounts
 * before the async listen() call completes. Without proper handling, this can
 * lead to memory leaks where the unlisten function is never called.
 *
 * @param eventName - The name of the Tauri event to listen to
 * @param handler - The callback function to handle the event payload
 * @param deps - Optional array of dependencies that will trigger re-subscription
 *
 * @example
 * ```tsx
 * useTauriListener<LogEvent>("instance-log", (event) => {
 *   console.log(event.payload.line)
 * }, [instanceId])
 * ```
 */
export function useTauriListener<T>(
  eventName: string,
  handler: (event: Event<T>) => void,
  deps: React.DependencyList = []
) {
  // Use refs to track mounting state and unlisten function
  const isMountedRef = useRef(true)
  const unlistenRef = useRef<UnlistenFn | null>(null)
  const handlerRef = useRef(handler)

  // Keep handler ref up to date to avoid stale closures
  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    isMountedRef.current = true

    const setupListener = async () => {
      try {
        const unlisten = await listen<T>(eventName, (event) => {
          // Only call handler if component is still mounted
          if (isMountedRef.current) {
            handlerRef.current(event)
          }
        })

        // Only store unlisten if still mounted
        if (isMountedRef.current) {
          unlistenRef.current = unlisten
        } else {
          // Component unmounted while we were setting up - cleanup immediately
          unlisten()
        }
      } catch (error) {
        console.error(`[useTauriListener] Failed to listen to ${eventName}:`, error)
      }
    }

    setupListener()

    return () => {
      isMountedRef.current = false
      if (unlistenRef.current) {
        unlistenRef.current()
        unlistenRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventName, ...deps])
}

/**
 * Custom hook for listening to Tauri events with a filter condition.
 * Only calls the handler when the filter returns true.
 *
 * @param eventName - The name of the Tauri event to listen to
 * @param filter - A function that returns true if the event should be handled
 * @param handler - The callback function to handle the event payload
 * @param deps - Optional array of dependencies that will trigger re-subscription
 *
 * @example
 * ```tsx
 * useTauriListenerFiltered<LogEvent>(
 *   "instance-log",
 *   (event) => event.payload.instance_id === instanceId,
 *   (event) => console.log(event.payload.line),
 *   [instanceId]
 * )
 * ```
 */
export function useTauriListenerFiltered<T>(
  eventName: string,
  filter: (event: Event<T>) => boolean,
  handler: (event: Event<T>) => void,
  deps: React.DependencyList = []
) {
  const filterRef = useRef(filter)
  const handlerRef = useRef(handler)

  // Keep refs up to date
  useEffect(() => {
    filterRef.current = filter
    handlerRef.current = handler
  }, [filter, handler])

  useTauriListener<T>(
    eventName,
    (event) => {
      if (filterRef.current(event)) {
        handlerRef.current(event)
      }
    },
    deps
  )
}
