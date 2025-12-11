/**
 * WebTorrent P2P singleton for instance sharing
 * Handles seeding exports and downloading from magnet links
 *
 * Note: WebTorrent is lazy-loaded to avoid browser compatibility issues
 * In browser/Tauri environment, we need to read files into memory first
 */

import { readFile, writeFile, mkdir, exists } from "@tauri-apps/plugin-fs"
import { basename, dirname } from "@tauri-apps/api/path"

export interface TorrentProgress {
  progress: number
  downloadSpeed: number
  uploadSpeed: number
  numPeers: number
  downloaded: number
  uploaded: number
  timeRemaining: number | null
}

export interface SeedInfo {
  infoHash: string
  magnetURI: string
  name: string
  length: number
  numPeers: number
  uploaded: number
}

type ProgressCallback = (progress: TorrentProgress) => void
type CompleteCallback = (path: string) => void
type ErrorCallback = (error: Error) => void

// WebTorrent types (lazy-loaded)
interface WebTorrentTorrent {
  infoHash: string
  magnetURI: string
  name: string
  files: WebTorrentFile[]
  length: number
  downloaded: number
  uploaded: number
  progress: number
  downloadSpeed: number
  uploadSpeed: number
  numPeers: number
  timeRemaining: number
  on(event: string, callback: (...args: unknown[]) => void): void
  once(event: string, callback: (...args: unknown[]) => void): void
  destroy(): void
}

interface WebTorrentFile {
  name: string
  path: string
  length: number
  arrayBuffer(): Promise<ArrayBuffer>
}

interface WebTorrentInstance {
  seed(
    input: File | File[] | Uint8Array,
    options: object,
    callback: (torrent: WebTorrentTorrent) => void
  ): void
  add(magnetUri: string, options?: object): WebTorrentTorrent
  destroy(callback?: () => void): void
  on(event: string, callback: (...args: unknown[]) => void): void
  once(event: string, callback: (...args: unknown[]) => void): void
}

class WebTorrentClient {
  private client: WebTorrentInstance | null = null
  private seeds: Map<string, WebTorrentTorrent> = new Map()
  private downloads: Map<string, WebTorrentTorrent> = new Map()
  private WebTorrent: (new (options?: object) => WebTorrentInstance) | null = null
  private initPromise: Promise<void> | null = null

  /**
   * Lazy-load and initialize WebTorrent
   */
  private async init(): Promise<void> {
    if (this.initPromise) return this.initPromise

    this.initPromise = (async () => {
      try {
        // Dynamic import to avoid loading WebTorrent on initial page load
        const module = await import("webtorrent")
        this.WebTorrent = module.default as unknown as new (
          options?: object
        ) => WebTorrentInstance
        console.log("[WebTorrent] Module loaded successfully")
      } catch (err) {
        console.error("[WebTorrent] Failed to load module:", err)
        throw new Error("WebTorrent is not available in this environment")
      }
    })()

    return this.initPromise
  }

  /**
   * Get or create the WebTorrent client singleton
   */
  private async getClient(): Promise<WebTorrentInstance> {
    await this.init()

    if (!this.client && this.WebTorrent) {
      this.client = new this.WebTorrent({})

      this.client.on("error", (err: unknown) => {
        console.error("[WebTorrent] Client error:", err)
      })
    }

    if (!this.client) {
      throw new Error("WebTorrent client not available")
    }

    return this.client
  }

  /**
   * Seed a file and return the magnet URI
   * Reads the file using Tauri's fs API and creates a File object for WebTorrent
   */
  async seed(
    filePath: string,
    options?: {
      name?: string
      onProgress?: ProgressCallback
    }
  ): Promise<SeedInfo> {
    const client = await this.getClient()

    // Read file from filesystem using Tauri API
    console.log("[WebTorrent] Reading file:", filePath)
    const fileData = await readFile(filePath)
    const fileName = options?.name || (await basename(filePath))

    // Create a File object from the Uint8Array
    const file = new File([fileData], fileName, { type: "application/zip" })
    console.log("[WebTorrent] Created File object:", fileName, "size:", file.size)

    return new Promise((resolve, reject) => {
      client.seed(
        file,
        {
          name: fileName,
          announce: [
            // WebSocket trackers (work in browser)
            "wss://tracker.openwebtorrent.com",
            "wss://tracker.btorrent.xyz",
            "wss://tracker.webtorrent.dev",
          ],
        },
        (torrent: WebTorrentTorrent) => {
          console.log("[WebTorrent] Seeding:", torrent.infoHash)

          // Store reference
          this.seeds.set(torrent.infoHash, torrent)

          // Setup progress callback
          if (options?.onProgress) {
            const progressHandler = () => {
              options.onProgress!({
                progress: torrent.progress,
                downloadSpeed: torrent.downloadSpeed,
                uploadSpeed: torrent.uploadSpeed,
                numPeers: torrent.numPeers,
                downloaded: torrent.downloaded,
                uploaded: torrent.uploaded,
                timeRemaining: torrent.timeRemaining,
              })
            }

            torrent.on("upload", progressHandler)
            torrent.on("wire", progressHandler)
          }

          resolve({
            infoHash: torrent.infoHash,
            magnetURI: torrent.magnetURI,
            name: torrent.name,
            length: torrent.length,
            numPeers: torrent.numPeers,
            uploaded: torrent.uploaded,
          })
        }
      )

      // Error handling
      client.once("error", (err: unknown) => {
        reject(err as Error)
      })
    })
  }

  /**
   * Download a torrent from magnet URI
   * Downloads to memory, then writes to filesystem using Tauri API
   */
  async download(
    magnetURI: string,
    downloadPath: string,
    options?: {
      onProgress?: ProgressCallback
      onComplete?: CompleteCallback
      onError?: ErrorCallback
    }
  ): Promise<{ infoHash: string; name: string }> {
    const client = await this.getClient()

    return new Promise((resolve, reject) => {
      // In browser mode, we don't pass a path - files download to memory
      const torrent = client.add(magnetURI, {
        announce: [
          "wss://tracker.openwebtorrent.com",
          "wss://tracker.btorrent.xyz",
          "wss://tracker.webtorrent.dev",
        ],
      })

      this.downloads.set(torrent.infoHash, torrent)

      // Metadata received - we know the torrent info
      torrent.on("metadata", () => {
        console.log("[WebTorrent] Metadata received:", torrent.name)
        resolve({
          infoHash: torrent.infoHash,
          name: torrent.name,
        })
      })

      // Progress updates
      if (options?.onProgress) {
        const progressHandler = () => {
          options.onProgress!({
            progress: torrent.progress,
            downloadSpeed: torrent.downloadSpeed,
            uploadSpeed: torrent.uploadSpeed,
            numPeers: torrent.numPeers,
            downloaded: torrent.downloaded,
            uploaded: torrent.uploaded,
            timeRemaining: torrent.timeRemaining,
          })
        }

        torrent.on("download", progressHandler)
        torrent.on("wire", progressHandler)
      }

      // Download complete - write files to filesystem
      torrent.on("done", async () => {
        console.log("[WebTorrent] Download complete:", torrent.name)

        try {
          // Ensure download directory exists
          const dirExists = await exists(downloadPath)
          if (!dirExists) {
            await mkdir(downloadPath, { recursive: true })
          }

          // Write each file to the filesystem
          for (const file of torrent.files) {
            const filePath = `${downloadPath}/${file.name}`
            const fileDir = await dirname(filePath)

            // Ensure parent directory exists
            const parentExists = await exists(fileDir)
            if (!parentExists) {
              await mkdir(fileDir, { recursive: true })
            }

            // Get file data and write it
            const buffer = await file.arrayBuffer()
            await writeFile(filePath, new Uint8Array(buffer))
            console.log("[WebTorrent] Wrote file:", filePath)
          }

          // Call completion callback with the first file path
          const firstFile = torrent.files[0]
          if (firstFile) {
            const fullPath = `${downloadPath}/${firstFile.name}`
            options?.onComplete?.(fullPath)
          }
        } catch (err) {
          console.error("[WebTorrent] Error writing files:", err)
          options?.onError?.(err as Error)
        }
      })

      // Error handling
      torrent.on("error", (err: unknown) => {
        console.error("[WebTorrent] Torrent error:", err)
        const error = err as Error
        options?.onError?.(error)
        reject(error)
      })

      // Timeout for metadata (30 seconds)
      setTimeout(() => {
        if (!torrent.name) {
          reject(new Error("Timeout waiting for torrent metadata"))
        }
      }, 30000)
    })
  }

  /**
   * Stop seeding a torrent
   */
  stopSeed(infoHash: string): void {
    const torrent = this.seeds.get(infoHash)
    if (torrent) {
      torrent.destroy()
      this.seeds.delete(infoHash)
      console.log("[WebTorrent] Stopped seeding:", infoHash)
    }
  }

  /**
   * Cancel a download
   */
  cancelDownload(infoHash: string): void {
    const torrent = this.downloads.get(infoHash)
    if (torrent) {
      torrent.destroy()
      this.downloads.delete(infoHash)
      console.log("[WebTorrent] Cancelled download:", infoHash)
    }
  }

  /**
   * Get seed info
   */
  getSeedInfo(infoHash: string): SeedInfo | null {
    const torrent = this.seeds.get(infoHash)
    if (!torrent) return null

    return {
      infoHash: torrent.infoHash,
      magnetURI: torrent.magnetURI,
      name: torrent.name,
      length: torrent.length,
      numPeers: torrent.numPeers,
      uploaded: torrent.uploaded,
    }
  }

  /**
   * Get all active seeds
   */
  getActiveSeeds(): SeedInfo[] {
    return Array.from(this.seeds.values()).map((torrent) => ({
      infoHash: torrent.infoHash,
      magnetURI: torrent.magnetURI,
      name: torrent.name,
      length: torrent.length,
      numPeers: torrent.numPeers,
      uploaded: torrent.uploaded,
    }))
  }

  /**
   * Get download progress
   */
  getDownloadProgress(infoHash: string): TorrentProgress | null {
    const torrent = this.downloads.get(infoHash)
    if (!torrent) return null

    return {
      progress: torrent.progress,
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
      numPeers: torrent.numPeers,
      downloaded: torrent.downloaded,
      uploaded: torrent.uploaded,
      timeRemaining: torrent.timeRemaining,
    }
  }

  /**
   * Destroy the client and all torrents
   */
  destroy(): void {
    if (this.client) {
      this.client.destroy()
      this.client = null
      this.seeds.clear()
      this.downloads.clear()
      console.log("[WebTorrent] Client destroyed")
    }
  }
}

// Export singleton instance
export const webtorrentClient = new WebTorrentClient()
