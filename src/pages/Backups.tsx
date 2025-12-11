import { useState, useEffect, useMemo } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Archive, Loader2, Search, Trash2, RotateCcw, HardDrive, Server, Gamepad2 } from "lucide-react"
import { toast } from "sonner"
import { useTranslation } from "@/i18n"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
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

  // Dialogs
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false)
  const [selectedBackup, setSelectedBackup] = useState<GlobalBackupInfo | null>(null)
  const [targetInstanceId, setTargetInstanceId] = useState<string>("")
  const [isDeleting, setIsDeleting] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)

  const loadData = async () => {
    try {
      const [backupsResult, statsResult, instancesResult] = await Promise.all([
        invoke<GlobalBackupInfo[]>("get_all_backups"),
        invoke<BackupStats>("get_backup_stats"),
        invoke<Instance[]>("get_instances"),
      ])
      setBackups(backupsResult)
      setStats(statsResult)
      setInstances(instancesResult)
    } catch (err) {
      console.error("Failed to load backups:", err)
      toast.error("Failed to load backups")
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
    setIsDeleting(true)
    try {
      await invoke("delete_world_backup", {
        instanceId: selectedBackup.instance_id,
        worldName: selectedBackup.world_name,
        backupFilename: selectedBackup.filename,
      })
      toast.success(t("backups.deleteSuccess"))
      setDeleteDialogOpen(false)
      loadData()
    } catch (err) {
      console.error("Failed to delete backup:", err)
      toast.error(t("backups.deleteError"))
    } finally {
      setIsDeleting(false)
    }
  }

  const handleRestore = async () => {
    if (!selectedBackup || !targetInstanceId) return
    setIsRestoring(true)
    try {
      await invoke("restore_backup_to_other_instance", {
        sourceInstanceId: selectedBackup.instance_id,
        worldName: selectedBackup.world_name,
        backupFilename: selectedBackup.filename,
        targetInstanceId,
      })
      toast.success(t("backups.restoreSuccess"))
      setRestoreDialogOpen(false)
    } catch (err) {
      console.error("Failed to restore backup:", err)
      toast.error(t("backups.restoreError"))
    } finally {
      setIsRestoring(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold">{t("backups.title")}</h1>
          <p className="text-muted-foreground">{t("backups.subtitle")}</p>
        </div>
        <Card>
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
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
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Archive className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium">{t("backups.noBackups")}</h3>
            <p className="text-muted-foreground text-sm mt-1 max-w-sm">
              {t("backups.noBackupsDesc")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
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
          <ScrollArea className="h-[calc(100vh-280px)]">
            <div className="space-y-2">
              {filteredAndSortedBackups.map((backup) => (
                <Card key={`${backup.instance_id}-${backup.world_name}-${backup.filename}`}>
                  <CardContent className="flex items-center justify-between py-3 px-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                        {backup.is_server ? (
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
                        </div>
                        <div className="text-sm text-muted-foreground flex items-center gap-2">
                          <span>{formatDate(backup.timestamp)}</span>
                          <span>•</span>
                          <span>{formatBytes(backup.size_bytes)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
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
              ))}
              {filteredAndSortedBackups.length === 0 && (
                <Card className="border-dashed">
                  <CardContent className="py-8 text-center text-muted-foreground">
                    {t("backups.noBackups")}
                  </CardContent>
                </Card>
              )}
            </div>
          </ScrollArea>
        </>
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
  )
}
