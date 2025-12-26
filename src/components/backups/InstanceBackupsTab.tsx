import { useState, useEffect, useMemo } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { Loader2, Search, Trash2, RotateCcw, HardDrive, Server, Gamepad2, Package, Cloud, CloudOff, CheckCircle2 } from "lucide-react"
import { toast } from "sonner"
import { useTranslation } from "@/i18n"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
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
import type {
  GlobalInstanceBackupInfo,
  InstanceBackupStats,
  RestoreMode,
  InstanceBackupProgressEvent,
} from "@/types/backups"

interface Instance {
  id: string
  name: string
  mc_version: string
  loader: string | null
  is_server: boolean
  is_proxy: boolean
}

interface CloudBackupSync {
  id: string
  backup_filename: string
  instance_id: string
  sync_status: "pending" | "uploading" | "synced" | "failed"
  error_message: string | null
}

interface CloudStorageConfig {
  enabled: boolean
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

interface InstanceBackupsTabProps {
  onStatsChange?: (stats: InstanceBackupStats | null) => void
}

export function InstanceBackupsTab({ onStatsChange }: InstanceBackupsTabProps) {
  const { t } = useTranslation()
  const [backups, setBackups] = useState<GlobalInstanceBackupInfo[]>([])
  const [stats, setStats] = useState<InstanceBackupStats | null>(null)
  const [instances, setInstances] = useState<Instance[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [instanceFilter, setInstanceFilter] = useState<string>("all")
  const [sortBy, setSortBy] = useState<SortOption>("date")

  // Dialogs
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false)
  const [selectedBackup, setSelectedBackup] = useState<GlobalInstanceBackupInfo | null>(null)
  const [restoreMode, setRestoreMode] = useState<RestoreMode>("replace")
  const [newInstanceName, setNewInstanceName] = useState("")
  const [isDeleting, setIsDeleting] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [restoreProgress, setRestoreProgress] = useState<InstanceBackupProgressEvent | null>(null)

  // Cloud state
  const [cloudConfig, setCloudConfig] = useState<CloudStorageConfig | null>(null)
  const [cloudSyncs, setCloudSyncs] = useState<CloudBackupSync[]>([])
  const [uploadingBackups, setUploadingBackups] = useState<Set<string>>(new Set())

  const loadData = async () => {
    try {
      const [backupsResult, statsResult, instancesResult, cloudConfigResult, cloudSyncsResult] = await Promise.all([
        invoke<GlobalInstanceBackupInfo[]>("get_all_instance_backups"),
        invoke<InstanceBackupStats>("get_instance_backup_stats"),
        invoke<Instance[]>("get_instances"),
        invoke<CloudStorageConfig | null>("get_cloud_storage_config").catch(() => null),
        invoke<CloudBackupSync[]>("get_instance_backup_cloud_syncs").catch(() => []),
      ])
      setBackups(backupsResult)
      setStats(statsResult)
      setInstances(instancesResult)
      setCloudConfig(cloudConfigResult)
      setCloudSyncs(cloudSyncsResult)
      onStatsChange?.(statsResult)
    } catch (err) {
      console.error("[InstanceBackupsTab] Failed to load backups:", err)
      toast.error(t("backups.loadError"))
    } finally {
      setIsLoading(false)
    }
  }

  const handleCloudUpload = async (backup: GlobalInstanceBackupInfo) => {
    const key = `${backup.instance_id}-${backup.filename}`
    setUploadingBackups(prev => new Set(prev).add(key))

    try {
      await invoke("upload_instance_backup_to_cloud", {
        instanceId: backup.instance_id,
        backupFilename: backup.filename,
      })
      toast.success(t("backups.instanceBackups.cloudUploadSuccess"))
      // Reload cloud syncs
      const syncs = await invoke<CloudBackupSync[]>("get_instance_backup_cloud_syncs")
      setCloudSyncs(syncs)
    } catch (err) {
      console.error("[InstanceBackupsTab] Failed to upload to cloud:", err)
      toast.error(t("backups.instanceBackups.cloudUploadError"))
    } finally {
      setUploadingBackups(prev => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  const getCloudSyncStatus = (backup: GlobalInstanceBackupInfo): CloudBackupSync | undefined => {
    return cloudSyncs.find(s => s.instance_id === backup.instance_id && s.backup_filename === backup.filename)
  }

  useEffect(() => {
    loadData()

    // Listen for backup progress events
    const unlisten = listen<InstanceBackupProgressEvent>("instance-backup-progress", (event) => {
      setRestoreProgress(event.payload)
      if (event.payload.stage === "complete") {
        setTimeout(() => setRestoreProgress(null), 1000)
      }
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  const filteredAndSortedBackups = useMemo(() => {
    let result = [...backups]

    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (b) =>
          b.instance_name.toLowerCase().includes(query) ||
          b.mc_version.toLowerCase().includes(query) ||
          (b.loader && b.loader.toLowerCase().includes(query))
      )
    }

    if (instanceFilter !== "all") {
      result = result.filter((b) => b.instance_id === instanceFilter)
    }

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

  const instancesWithBackups = useMemo(() => {
    const uniqueIds = new Set(backups.map((b) => b.instance_id))
    return instances.filter((i) => uniqueIds.has(i.id))
  }, [backups, instances])

  const openDeleteDialog = (backup: GlobalInstanceBackupInfo) => {
    setSelectedBackup(backup)
    setDeleteDialogOpen(true)
  }

  const openRestoreDialog = (backup: GlobalInstanceBackupInfo) => {
    setSelectedBackup(backup)
    setRestoreMode("replace")
    setNewInstanceName("")
    setRestoreDialogOpen(true)
  }

  const handleDelete = async () => {
    if (!selectedBackup) return
    setIsDeleting(true)
    try {
      await invoke("delete_instance_backup", {
        instanceId: selectedBackup.instance_id,
        backupFilename: selectedBackup.filename,
      })
      toast.success(t("backups.deleteSuccess"))
      setDeleteDialogOpen(false)
      loadData()
    } catch (err) {
      console.error("[InstanceBackupsTab] Failed to delete backup:", err)
      toast.error(t("backups.deleteError"))
    } finally {
      setIsDeleting(false)
    }
  }

  const handleRestore = async () => {
    if (!selectedBackup) return
    setIsRestoring(true)
    setRestoreProgress(null)

    try {
      const result = await invoke<Instance | null>("restore_instance_backup", {
        instanceId: selectedBackup.instance_id,
        backupFilename: selectedBackup.filename,
        restoreMode: restoreMode,
        newName: restoreMode === "create_new" ? (newInstanceName || undefined) : undefined,
      })

      if (result) {
        toast.success(t("backups.instanceBackups.restoreSuccessNew", { name: result.name }))
      } else {
        toast.success(t("backups.instanceBackups.restoreSuccess"))
      }
      setRestoreDialogOpen(false)
      loadData()
    } catch (err) {
      console.error("[InstanceBackupsTab] Failed to restore backup:", err)
      toast.error(t("backups.restoreError"))
    } finally {
      setIsRestoring(false)
      setRestoreProgress(null)
    }
  }

  // Check if instance still exists
  const instanceExists = (instanceId: string) => {
    return instances.some((i) => i.id === instanceId)
  }

  if (isLoading) {
    return (
      <Card className="flex-1">
        <CardContent className="flex items-center justify-center h-full min-h-[300px]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  if (backups.length === 0) {
    return (
      <Card className="border-dashed flex-1">
        <CardContent className="flex flex-col items-center justify-center h-full min-h-[300px] text-center">
          <Package className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium">{t("backups.instanceBackups.noBackups")}</h3>
          <p className="text-muted-foreground text-sm mt-1 max-w-sm">
            {t("backups.instanceBackups.noBackupsDesc")}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      {/* Stats bar */}
      {stats && stats.backup_count > 0 && (
        <div className="flex gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Package className="h-4 w-4" />
            <span>{t("backups.instanceBackups.backupCount", { count: String(stats.backup_count) })}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <HardDrive className="h-4 w-4" />
            <span>{formatBytes(stats.total_size)}</span>
          </div>
        </div>
      )}

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
            const exists = instanceExists(backup.instance_id)
            const cloudSync = getCloudSyncStatus(backup)
            const isUploading = uploadingBackups.has(`${backup.instance_id}-${backup.filename}`)
            const isSynced = cloudSync?.sync_status === "synced"
            const cloudEnabled = cloudConfig?.enabled ?? false

            return (
              <Card key={`${backup.instance_id}-${backup.filename}`}>
                <CardContent className="flex items-center justify-between py-3 px-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                      {backup.is_server ? (
                        <Server className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        <Gamepad2 className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{backup.instance_name}</span>
                        <Badge variant="secondary" className="text-xs">
                          {backup.mc_version}
                        </Badge>
                        {backup.loader && (
                          <Badge variant="outline" className="text-xs">
                            {backup.loader}
                          </Badge>
                        )}
                        {isSynced && (
                          <Badge variant="outline" className="text-xs text-green-600 border-green-600/30">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            {t("backups.instanceBackups.synced")}
                          </Badge>
                        )}
                        {!exists && (
                          <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-600/30">
                            {t("backups.instanceBackups.instanceDeleted")}
                          </Badge>
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
                    {cloudEnabled && !isSynced && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleCloudUpload(backup)}
                        disabled={isUploading}
                        title={t("backups.instanceBackups.uploadToCloud")}
                      >
                        {isUploading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Cloud className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                    {!cloudEnabled && (
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled
                        title={t("backups.instanceBackups.cloudNotConfigured")}
                      >
                        <CloudOff className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openRestoreDialog(backup)}
                    >
                      <RotateCcw className="h-4 w-4 mr-1.5" />
                      {t("backups.restore")}
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
                {t("backups.instanceBackups.noBackups")}
              </CardContent>
            </Card>
          )}
        </div>
      </ScrollArea>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("backups.deleteConfirm")}</DialogTitle>
            <DialogDescription>
              {selectedBackup && (
                <>
                  {selectedBackup.instance_name} - {formatDate(selectedBackup.timestamp)}
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
            <DialogTitle>{t("backups.instanceBackups.restoreInstance")}</DialogTitle>
            <DialogDescription>
              {selectedBackup && (
                <>
                  {selectedBackup.instance_name} - {formatDate(selectedBackup.timestamp)}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <RadioGroup value={restoreMode} onValueChange={(v) => setRestoreMode(v as RestoreMode)}>
              <div className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
                <RadioGroupItem value="replace" id="replace" className="mt-0.5" />
                <Label htmlFor="replace" className="flex flex-col cursor-pointer">
                  <span className="font-medium">{t("backups.instanceBackups.replaceExisting")}</span>
                  <span className="text-sm text-muted-foreground">
                    {t("backups.instanceBackups.replaceExistingDesc")}
                  </span>
                </Label>
              </div>
              <div className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
                <RadioGroupItem value="create_new" id="create_new" className="mt-0.5" />
                <Label htmlFor="create_new" className="flex flex-col cursor-pointer">
                  <span className="font-medium">{t("backups.instanceBackups.createNew")}</span>
                  <span className="text-sm text-muted-foreground">
                    {t("backups.instanceBackups.createNewDesc")}
                  </span>
                </Label>
              </div>
            </RadioGroup>

            {restoreMode === "create_new" && (
              <div className="space-y-2">
                <Label>{t("backups.instanceBackups.newInstanceName")}</Label>
                <Input
                  value={newInstanceName}
                  onChange={(e) => setNewInstanceName(e.target.value)}
                  placeholder={`${selectedBackup?.instance_name} (Backup)`}
                />
              </div>
            )}

            {restoreMode === "replace" && instanceExists(selectedBackup?.instance_id || "") && (
              <p className="text-sm text-yellow-600 dark:text-yellow-500">
                {t("backups.instanceBackups.replaceWarning")}
              </p>
            )}

            {restoreMode === "replace" && !instanceExists(selectedBackup?.instance_id || "") && (
              <p className="text-sm text-muted-foreground">
                {t("backups.instanceBackups.instanceDeletedRestore")}
              </p>
            )}

            {/* Progress */}
            {restoreProgress && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>{restoreProgress.message}</span>
                  <span>{restoreProgress.progress}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all"
                    style={{ width: `${restoreProgress.progress}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreDialogOpen(false)} disabled={isRestoring}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleRestore} disabled={isRestoring}>
              {isRestoring && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("backups.restore")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
