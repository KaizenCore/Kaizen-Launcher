/**
 * Shared utilities for Modrinth browse components
 */

import type { ViewMode } from "@/types/browse"

// ============================================================================
// Formatters
// ============================================================================

/**
 * Format download count to human-readable string (e.g., 1.5M, 10.2K)
 */
export function formatDownloads(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`
  }
  return count.toString()
}

/**
 * Format file size to human-readable string
 */
export function formatSize(bytes: number): string {
  if (bytes >= 1_048_576) {
    return `${(bytes / 1_048_576).toFixed(1)} MB`
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${bytes} B`
}

// ============================================================================
// View Mode Persistence
// ============================================================================

/**
 * Get the stored view mode from localStorage
 */
export function getStoredViewMode(storageKey: string): ViewMode {
  try {
    const stored = localStorage.getItem(storageKey)
    if (stored === "grid" || stored === "list" || stored === "compact") {
      return stored
    }
  } catch {
    // Ignore localStorage errors
  }
  return "list" // Default
}

/**
 * Store view mode to localStorage
 */
export function setStoredViewMode(storageKey: string, mode: ViewMode): void {
  try {
    localStorage.setItem(storageKey, mode)
  } catch {
    // Ignore localStorage errors
  }
}

// ============================================================================
// Pagination
// ============================================================================

/**
 * Generate page numbers for pagination with ellipsis
 */
export function getPageNumbers(
  currentPage: number,
  totalPages: number,
  maxVisible: number = 5
): (number | "ellipsis")[] {
  const pages: (number | "ellipsis")[] = []

  if (totalPages <= maxVisible) {
    for (let i = 1; i <= totalPages; i++) {
      pages.push(i)
    }
  } else {
    pages.push(1)
    if (currentPage > 3) {
      pages.push("ellipsis")
    }
    const start = Math.max(2, currentPage - 1)
    const end = Math.min(totalPages - 1, currentPage + 1)
    for (let i = start; i <= end; i++) {
      pages.push(i)
    }
    if (currentPage < totalPages - 2) {
      pages.push("ellipsis")
    }
    pages.push(totalPages)
  }

  return pages
}
