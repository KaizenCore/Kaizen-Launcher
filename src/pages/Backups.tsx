import { useState, useEffect, useMemo } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Archive, Loader2, Search, Trash2, RotateCcw, HardDrive, Server, Gamepad2, Upload, Check, AlertCircle } from "lucide-react"
import { toast } from "sonner"
import { useTranslation } from "@/i18n"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface GlobalBackupInfo {
  instance_id: string
  instance_name: string
  world_name: string
  filename: string
  timestamp: string
  size_bytes: number
  is_server: boolean
  icon_data_url?: string
}

interface BackupStats {
  total_size: number
  backup_count: number
  instance_count: number
}

interface Instance {
  id: string
  name: string
  is_server: boolean
  is_proxy: boolean
}

interface CloudBackupSync {
  id: string
  local_backup_path: string
  instance_id: string
  world_name: string
  backup_filename: string
  remote_path: string | null
  sync_status: "pending" | "uploading" | "synced" | "failed"
  last_synced_at: string | null
  file_size_bytes: number | null
  error_message: string | null
}

interface CloudStorageConfig {
  enabled: boolean
  provider: string
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString)
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return isoString
  }
}

type SortOption = "date" | "size" | "instance"

export function Backups() {
  const { t } = useTranslation()
  const [backups, setBackups] = useState<GlobalBackupInfo[]>([])
  const [stats, setStats] = useState<BackupStats | null>(null)
  const [instances, setInstances] = useState<Instance[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [instanceFilter, setInstanceFilter] = useState<string>("all")
  const [sortBy, setSortBy] = useState<SortOption>("date")

  // Cloud sync state
  const [cloudConfig, setCloudConfig] = useState<CloudStorageConfig | null>(null)
  const [cloudSyncStatuses, setCloudSyncStatuses] = useState<Map<string, CloudBackupSync>>(new Map())
  const [uploadingBackups, setUploadingBackups] = useState<Set<string>>(new Set())

  // Dialogs
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false)
  const [selectedBackup, setSelectedBackup] = useState<GlobalBackupInfo | null>(null)
  const [targetInstanceId, setTargetInstanceId] = useState<string>("")
  const [isDeleting, setIsDeleting] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)

  const loadData = async () => {
    console.log("[Backups] Loading backup data...")
    try {
      const [backupsResult, statsResult, instancesResult] = await Promise.all([
        invoke<GlobalBackupInfo[]>("get_all_backups"),
        invoke<BackupStats>("get_backup_stats"),
        invoke<Instance[]>("get_instances"),
      ])
      console.log(`[Backups] Loaded ${backupsResult.length} backups from ${statsResult.instance_count} instances`)
      setBackups(backupsResult)
      setStats(statsResult)
      setInstances(instancesResult)

      // Load cloud config and sync statuses
      try {
        const [configResult, syncStatuses] = await Promise.all([
          invoke<CloudStorageConfig | null>("get_cloud_storage_config"),
          invoke<CloudBackupSync[]>("get_all_cloud_backups"),
        ])
        setCloudConfig(configResult)
        const statusMap = new Map<string, CloudBackupSync>()
        syncStatuses.forEach((sync) => {
          statusMap.set(sync.backup_filename, sync)
        })
        setCloudSyncStatuses(statusMap)
      } catch {
        // Cloud storage not configured or error - ignore silently
        setCloudConfig(null)
      }
    } catch (err) {
      console.error("[Backups] Failed to load backups:", err)
      toast.error(t("backups.loadError"))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const filteredAndSortedBackups = useMemo(() => {
    let result = [...backups]

    // Filter by search
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (b) =>
          b.world_name.toLowerCase().includes(query) ||
          b.instance_name.toLowerCase().includes(query)
      )
    }

    // Filter by instance
    if (instanceFilter !== "all") {
      result = result.filter((b) => b.instance_id === instanceFilter)
    }

    // Sort
    switch (sortBy) {
      case "date":
        result.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        break
      case "size":
        result.sort((a, b) => b.size_bytes - a.size_bytes)
        break
      case "instance":
        result.sort((a, b) => a.instance_name.localeCompare(b.instance_name))
        break
    }

    return result
  }, [backups, searchQuery, instanceFilter, sortBy])

  // Get compatible instances for restore (same type: client->client, server->server)
  const compatibleInstances = useMemo(() => {
    if (!selectedBackup) return []
    return instances.filter((i) => {
      const targetIsServer = i.is_server || i.is_proxy
      return targetIsServer === selectedBackup.is_server
    })
  }, [instances, selectedBackup])

  // Get unique instances with backups for filter dropdown
  const instancesWithBackups = useMemo(() => {
    const uniqueIds = new Set(backups.map((b) => b.instance_id))
    return instances.filter((i) => uniqueIds.has(i.id))
  }, [backups, instances])

  // Get cloud sync status for a backup
  const getCloudSyncStatus = (backup: GlobalBackupInfo) => {
    return cloudSyncStatuses.get(backup.filename)
  }

  // Upload a backup to cloud storage
  const handleUploadToCloud = async (backup: GlobalBackupInfo) => {
    if (!cloudConfig?.enabled) {
      toast.error(t("cloudStorage.noCloudConfigured"))
      return
    }

    setUploadingBackups((prev) => new Set(prev).add(backup.filename))

    try {
      const result = await invoke<CloudBackupSync>("upload_backup_to_cloud", {
        instanceId: backup.instance_id,
        worldName: backup.world_name,
        backupFilename: backup.filename,
      })

      // Update local sync status
      setCloudSyncStatuses((prev) => {
        const newMap = new Map(prev)
        newMap.set(backup.filename, result)
        return newMap
      })

      toast.success(t("cloudStorage.synced"))
    } catch (err) {
      console.error("Failed to upload backup:", err)
      toast.error(t("cloudStorage.failed"))
    } finally {
      setUploadingBackups((prev) => {
        const newSet = new Set(prev)
        newSet.delete(backup.filename)
        return newSet
      })
    }
  }

  const openDeleteDialog = (backup: GlobalBackupInfo) => {
    setSelectedBackup(backup)
    setDeleteDialogOpen(true)
  }

  const openRestoreDialog = (backup: GlobalBackupInfo) => {
    setSelectedBackup(backup)
    setTargetInstanceId("")
    setRestoreDialogOpen(true)
  }

  const handleDelete = async () => {
    if (!selectedBackup) return
    console.log(`[Backups] Deleting backup: ${selectedBackup.filename}`)
    setIsDeleting(true)
    try {
      await invoke("delete_world_backup", {
        instanceId: selectedBackup.instance_id,
        worldName: selectedBackup.world_name,
        backupFilename: selectedBackup.filename,
      })
      console.log(`[Backups] Backup deleted: ${selectedBackup.filename}`)
      toast.success(t("backups.deleteSuccess"))
      setDeleteDialogOpen(false)
      loadData()
    } catch (err) {
      console.error("[Backups] Failed to delete backup:", err)
      toast.error(t("backups.deleteError"))
    } finally {
      setIsDeleting(false)
    }
  }

  const handleRestore = async () => {
    if (!selectedBackup || !targetInstanceId) return
    console.log(`[Backups] Restoring backup: ${selectedBackup.filename} to instance ${targetInstanceId}`)
    setIsRestoring(true)
    try {
      await invoke("restore_backup_to_other_instance", {
        sourceInstanceId: selectedBackup.instance_id,
        worldName: selectedBackup.world_name,
        backupFilename: selectedBackup.filename,
        targetInstanceId,
      })
      console.log(`[Backups] Backup restored: ${selectedBackup.filename}`)
      toast.success(t("backups.restoreSuccess"))
      setRestoreDialogOpen(false)
    } catch (err) {
      console.error("[Backups] Failed to restore backup:", err)
      toast.error(t("backups.restoreError"))
    } finally {
      setIsRestoring(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6 h-full">
        <div>
          <h1 className="text-2xl font-bold">{t("backups.title")}</h1>
          <p className="text-muted-foreground">{t("backups.subtitle")}</p>
        </div>
        <Card className="flex-1">
          <CardContent className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={0}>
    <div className="flex flex-col gap-6 h-full">
      {/* Header with stats */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("backups.title")}</h1>
          <p className="text-muted-foreground">{t("backups.subtitle")}</p>
        </div>
        {stats && stats.backup_count > 0 && (
          <div className="flex gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Archive className="h-4 w-4" />
              <span>{t("backups.backupCount", { count: String(stats.backup_count) })}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <HardDrive className="h-4 w-4" />
              <span>{formatBytes(stats.total_size)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Empty state */}
      {backups.length === 0 ? (
        <Card className="border-dashed flex-1">
          <CardContent className="flex flex-col items-center justify-center h-full text-center">
            <Archive className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium">{t("backups.noBackups")}</h3>
            <p className="text-muted-foreground text-sm mt-1 max-w-sm">
              {t("backups.noBackupsDesc")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-6 flex-1 min-h-0">
          {/* Toolbar */}
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("backups.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={instanceFilter} onValueChange={setInstanceFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder={t("backups.allInstances")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("backups.allInstances")}</SelectItem>
                {instancesWithBackups.map((instance) => (
                  <SelectItem key={instance.id} value={instance.id}>
                    {instance.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date">{t("backups.sortByDate")}</SelectItem>
                <SelectItem value="size">{t("backups.sortBySize")}</SelectItem>
                <SelectItem value="instance">{t("backups.sortByInstance")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Backups list */}
          <ScrollArea className="flex-1">
            <div className="space-y-2 pr-4">
              {filteredAndSortedBackups.map((backup) => {
                const syncStatus = getCloudSyncStatus(backup)
                const isUploading = uploadingBackups.has(backup.filename)

                return (
                  <Card key={`${backup.instance_id}-${backup.world_name}-${backup.filename}`}>
                    <CardContent className="flex items-center justify-between py-3 px-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                          {backup.icon_data_url ? (
                            <img
                              src={backup.icon_data_url}
                              alt={backup.world_name}
                              className="h-10 w-10 object-cover"
                            />
                          ) : backup.is_server ? (
                            <Server className="h-5 w-5 text-muted-foreground" />
                          ) : (
                            <Gamepad2 className="h-5 w-5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{backup.world_name}</span>
                            <Badge variant="secondary" className="text-xs">
                              {backup.instance_name}
                            </Badge>
                            {/* Cloud sync status badge */}
                            {cloudConfig?.enabled && (
                              <>
                                {syncStatus?.sync_status === "synced" && (
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <Badge variant="outline" className="text-xs text-green-600 border-green-600/30 gap-1">
                                        <Check className="h-3 w-3" />
                                        {t("cloudStorage.synced")}
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {syncStatus.last_synced_at && formatDate(syncStatus.last_synced_at)}
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                                {syncStatus?.sync_status === "failed" && (
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <Badge variant="outline" className="text-xs text-red-600 border-red-600/30 gap-1">
                                        <AlertCircle className="h-3 w-3" />
                                        {t("cloudStorage.failed")}
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {syncStatus.error_message || t("cloudStorage.failed")}
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                                {(syncStatus?.sync_status === "uploading" || isUploading) && (
                                  <Badge variant="outline" className="text-xs text-blue-600 border-blue-600/30 gap-1">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    {t("cloudStorage.uploading")}
                                  </Badge>
                                )}
                              </>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground flex items-center gap-2">
                            <span>{formatDate(backup.timestamp)}</span>
                            <span>•</span>
                            <span>{formatBytes(backup.size_bytes)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Cloud upload button */}
                        {cloudConfig?.enabled && syncStatus?.sync_status !== "synced" && !isUploading && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleUploadToCloud(backup)}
                              >
                                <Upload className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("cloudStorage.uploadToCloud")}
                            </TooltipContent>
                          </Tooltip>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openRestoreDialog(backup)}
                        >
                          <RotateCcw className="h-4 w-4 mr-1.5" />
                          {t("backups.restoreTo")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => openDeleteDialog(backup)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
              {filteredAndSortedBackups.length === 0 && (
                <Card className="border-dashed">
                  <CardContent className="py-8 text-center text-muted-foreground">
                    {t("backups.noBackups")}
                  </CardContent>
                </Card>
              )}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("backups.deleteConfirm")}</DialogTitle>
            <DialogDescription>
              {selectedBackup && (
                <>
                  {selectedBackup.world_name} - {formatDate(selectedBackup.timestamp)}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore Dialog */}
      <Dialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("backups.restoreToInstance")}</DialogTitle>
            <DialogDescription>
              {selectedBackup && (
                <>
                  {selectedBackup.world_name} - {formatDate(selectedBackup.timestamp)}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Select value={targetInstanceId} onValueChange={setTargetInstanceId}>
              <SelectTrigger>
                <SelectValue placeholder={t("backups.selectInstance")} />
              </SelectTrigger>
              <SelectContent>
                {compatibleInstances.length === 0 ? (
                  <SelectItem value="none" disabled>
                    {t("backups.noCompatibleInstances")}
                  </SelectItem>
                ) : (
                  compatibleInstances.map((instance) => (
                    <SelectItem key={instance.id} value={instance.id}>
                      {instance.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {compatibleInstances.length > 0 && (
              <p className="text-sm text-muted-foreground mt-2">
                {t("backups.compatibleOnly")}
              </p>
            )}
            {targetInstanceId && (
              <p className="text-sm text-yellow-600 dark:text-yellow-500 mt-2">
                {t("backups.restoreWarning")}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleRestore}
              disabled={!targetInstanceId || isRestoring}
            >
              {isRestoring && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("backups.restore")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  )
}
