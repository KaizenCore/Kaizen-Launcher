import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "@/i18n";
import { toast } from "sonner";
import {
  Globe,
  Loader2,
  FolderOpen,
  Trash2,
  Copy,
  Pencil,
  Archive,
  RotateCcw,
  MoreVertical,
  Search,
  HardDrive,
  Upload,
  Check,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface WorldInfo {
  name: string;
  display_name: string;
  size_bytes: number;
  last_modified: string;
  icon_data_url: string | null;
  backup_count: number;
  is_server_world: boolean;
  world_folders: string[];
}

interface BackupInfo {
  filename: string;
  timestamp: string;
  size_bytes: number;
  world_name: string;
  icon_data_url?: string;
}

interface CloudStorageConfig {
  enabled: boolean;
  provider: string;
}

interface CloudBackupSync {
  backup_filename: string;
  sync_status: "pending" | "uploading" | "synced" | "failed";
}

interface WorldsTabProps {
  instanceId: string;
  isServer: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

export function WorldsTab({ instanceId, isServer }: WorldsTabProps) {
  const { t } = useTranslation();

  // State
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Selected world for actions
  const [selectedWorld, setSelectedWorld] = useState<WorldInfo | null>(null);

  // Backups dialog
  const [backupsDialogOpen, setBackupsDialogOpen] = useState(false);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);

  // Action states
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);

  // Dialogs
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<BackupInfo | null>(null);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [deleteBackupDialogOpen, setDeleteBackupDialogOpen] = useState(false);

  // Cloud storage
  const [cloudConfig, setCloudConfig] = useState<CloudStorageConfig | null>(null);
  const [cloudSyncStatuses, setCloudSyncStatuses] = useState<Map<string, CloudBackupSync>>(new Map());
  const [uploadingBackup, setUploadingBackup] = useState<string | null>(null);

  // Load worlds
  const loadWorlds = useCallback(async () => {
    if (!instanceId) return;
    setIsLoading(true);
    try {
      const data = await invoke<WorldInfo[]>("get_instance_worlds", {
        instanceId,
      });
      setWorlds(data);
    } catch (err) {
      console.error("Failed to load worlds:", err);
      toast.error(t("instanceDetails.worldsLoadError"));
    } finally {
      setIsLoading(false);
    }
  }, [instanceId]);

  // Load cloud config
  const loadCloudConfig = useCallback(async () => {
    try {
      const config = await invoke<CloudStorageConfig | null>("get_cloud_storage_config");
      setCloudConfig(config);
      if (config?.enabled) {
        loadCloudSyncStatuses();
      }
    } catch {
      // Cloud storage not configured
    }
  }, []);

  useEffect(() => {
    loadWorlds();
    loadCloudConfig();
  }, [loadWorlds, loadCloudConfig]);

  // Load cloud sync statuses
  const loadCloudSyncStatuses = async () => {
    try {
      const syncs = await invoke<CloudBackupSync[]>("get_all_cloud_backups");
      const statusMap = new Map<string, CloudBackupSync>();
      syncs.forEach((sync) => {
        statusMap.set(sync.backup_filename, sync);
      });
      setCloudSyncStatuses(statusMap);
    } catch {
      // Ignore errors
    }
  };

  // Upload backup to cloud
  const handleCloudUpload = async (backup: BackupInfo) => {
    if (!selectedWorld) return;
    setUploadingBackup(backup.filename);
    try {
      await invoke("upload_backup_to_cloud", {
        instanceId,
        worldName: selectedWorld.name,
        backupFilename: backup.filename,
      });
      toast.success(t("cloudStorage.uploadSuccess"));
      await loadCloudSyncStatuses();
    } catch (err) {
      console.error("Failed to upload backup:", err);
      toast.error(t("cloudStorage.uploadFailed"));
    } finally {
      setUploadingBackup(null);
    }
  };

  // Get sync status for a backup
  const getSyncStatus = (filename: string) => {
    return cloudSyncStatuses.get(filename)?.sync_status;
  };

  // Filter worlds
  const filteredWorlds = useMemo(() => {
    if (!searchQuery.trim()) return worlds;
    const query = searchQuery.toLowerCase();
    return worlds.filter(
      (w) =>
        w.name.toLowerCase().includes(query) ||
        w.display_name.toLowerCase().includes(query)
    );
  }, [worlds, searchQuery]);

  // Load backups for selected world
  const loadBackups = useCallback(async (worldName: string) => {
    setIsLoadingBackups(true);
    try {
      const data = await invoke<BackupInfo[]>("get_world_backups", {
        instanceId,
        worldName,
      });
      setBackups(data);
    } catch (err) {
      console.error("Failed to load backups:", err);
      toast.error(t("instanceDetails.backupsLoadError"));
    } finally {
      setIsLoadingBackups(false);
    }
  }, [instanceId]);

  // Actions
  const handleOpenBackups = async (world: WorldInfo) => {
    setSelectedWorld(world);
    setBackupsDialogOpen(true);
    await loadBackups(world.name);
  };

  const handleBackup = async (world: WorldInfo) => {
    setIsBackingUp(true);
    try {
      await invoke("backup_world", {
        instanceId,
        worldName: world.name,
      });
      toast.success(t("instanceDetails.backupCreated"));
      await loadWorlds();
      if (backupsDialogOpen && selectedWorld?.name === world.name) {
        await loadBackups(world.name);
      }
    } catch (err) {
      console.error("Failed to backup world:", err);
      toast.error(t("instanceDetails.backupError"));
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRestore = async () => {
    if (!selectedWorld || !selectedBackup) return;
    setIsRestoring(true);
    try {
      await invoke("restore_world_backup", {
        instanceId,
        worldName: selectedWorld.name,
        backupFilename: selectedBackup.filename,
      });
      toast.success(t("instanceDetails.restoreSuccess"));
      setRestoreDialogOpen(false);
      await loadWorlds();
    } catch (err) {
      console.error("Failed to restore world:", err);
      toast.error(t("instanceDetails.restoreError"));
    } finally {
      setIsRestoring(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedWorld) return;
    setIsDeleting(true);
    try {
      await invoke("delete_world", {
        instanceId,
        worldName: selectedWorld.name,
      });
      toast.success(t("instanceDetails.worldDeleted"));
      setDeleteDialogOpen(false);
      setSelectedWorld(null);
      await loadWorlds();
    } catch (err) {
      console.error("Failed to delete world:", err);
      toast.error(t("instanceDetails.deleteWorldError"));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDuplicate = async () => {
    if (!selectedWorld || !newName.trim()) return;
    setIsDuplicating(true);
    try {
      await invoke("duplicate_world", {
        instanceId,
        worldName: selectedWorld.name,
        newName: newName.trim(),
      });
      toast.success(t("instanceDetails.duplicateSuccess"));
      setDuplicateDialogOpen(false);
      setNewName("");
      await loadWorlds();
    } catch (err) {
      console.error("Failed to duplicate world:", err);
      toast.error(t("instanceDetails.duplicateError"));
    } finally {
      setIsDuplicating(false);
    }
  };

  const handleRename = async () => {
    if (!selectedWorld || !newName.trim()) return;
    setIsRenaming(true);
    try {
      await invoke("rename_world", {
        instanceId,
        oldName: selectedWorld.name,
        newName: newName.trim(),
      });
      toast.success(t("instanceDetails.renameSuccess"));
      setRenameDialogOpen(false);
      setNewName("");
      await loadWorlds();
    } catch (err) {
      console.error("Failed to rename world:", err);
      toast.error(t("instanceDetails.renameError"));
    } finally {
      setIsRenaming(false);
    }
  };

  const handleOpenFolder = async (world: WorldInfo) => {
    try {
      await invoke("open_world_folder", {
        instanceId,
        worldName: world.name,
      });
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  };

  const handleDeleteBackup = async () => {
    if (!selectedWorld || !selectedBackup) return;
    try {
      await invoke("delete_world_backup", {
        instanceId,
        worldName: selectedWorld.name,
        backupFilename: selectedBackup.filename,
      });
      toast.success(t("instanceDetails.backupDeleted"));
      setDeleteBackupDialogOpen(false);
      await loadBackups(selectedWorld.name);
      await loadWorlds();
    } catch (err) {
      console.error("Failed to delete backup:", err);
      toast.error(t("instanceDetails.deleteBackupError"));
    }
  };

  return (
    <>
      <Card className="flex flex-col flex-1 min-h-0">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              {t("instanceDetails.worlds")}
              {worlds.length > 0 && (
                <Badge variant="secondary">{worlds.length}</Badge>
              )}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col min-h-0">
          {/* Search */}
          {worlds.length > 0 && (
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("instanceDetails.searchWorlds")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          )}

          {/* Content */}
          {isLoading ? (
            <div className="flex items-center justify-center py-8 flex-1">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : worlds.length === 0 ? (
            <div className="text-center py-8 flex-1 flex flex-col items-center justify-center">
              <Globe className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-2">
                {t("instanceDetails.noWorlds")}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("instanceDetails.noWorldsDesc")}
              </p>
            </div>
          ) : filteredWorlds.length === 0 ? (
            <div className="text-center py-8 flex-1">
              <p className="text-muted-foreground">
                {t("instanceDetails.noSearchResults")}
              </p>
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="space-y-2 pr-4">
                {filteredWorlds.map((world) => (
                  <div
                    key={world.name}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                  >
                    {/* Icon */}
                    <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
                      {world.icon_data_url ? (
                        <img
                          src={world.icon_data_url}
                          alt={world.display_name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Globe className="h-6 w-6 text-muted-foreground" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">
                          {world.display_name}
                        </span>
                        {world.is_server_world && (
                          <Badge variant="outline" className="text-xs">
                            {t("instanceDetails.serverWorld")}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <HardDrive className="h-3 w-3" />
                          {formatBytes(world.size_bytes)}
                        </span>
                        <span>{formatDate(world.last_modified)}</span>
                        {world.backup_count > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            {world.backup_count}{" "}
                            {t("instanceDetails.backupsAvailable")}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleBackup(world)}
                        disabled={isBackingUp}
                        title={t("instanceDetails.createBackup")}
                      >
                        {isBackingUp ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Archive className="h-4 w-4" />
                        )}
                      </Button>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => handleOpenBackups(world)}
                          >
                            <Archive className="h-4 w-4 mr-2" />
                            {t("instanceDetails.viewBackups")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleOpenFolder(world)}
                          >
                            <FolderOpen className="h-4 w-4 mr-2" />
                            {t("instanceDetails.openWorldFolder")}
                          </DropdownMenuItem>
                          {!isServer && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => {
                                  setSelectedWorld(world);
                                  setNewName(world.name + " - Copy");
                                  setDuplicateDialogOpen(true);
                                }}
                              >
                                <Copy className="h-4 w-4 mr-2" />
                                {t("instanceDetails.duplicateWorld")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setSelectedWorld(world);
                                  setNewName(world.name);
                                  setRenameDialogOpen(true);
                                }}
                              >
                                <Pencil className="h-4 w-4 mr-2" />
                                {t("instanceDetails.renameWorld")}
                              </DropdownMenuItem>
                            </>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedWorld(world);
                              setDeleteDialogOpen(true);
                            }}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            {t("instanceDetails.deleteWorld")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Backups Dialog */}
      <Dialog open={backupsDialogOpen} onOpenChange={setBackupsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t("instanceDetails.backups")} - {selectedWorld?.display_name}
            </DialogTitle>
            <DialogDescription>
              {t("instanceDetails.backupsDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {isLoadingBackups ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : backups.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {t("instanceDetails.noBackups")}
              </div>
            ) : (
              <ScrollArea className="max-h-[300px]">
                <div className="space-y-2">
                  {backups.map((backup) => (
                    <div
                      key={backup.filename}
                      className="flex items-center justify-between p-3 rounded-lg border"
                    >
                      <div>
                        <p className="font-medium text-sm">
                          {formatDate(backup.timestamp)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatBytes(backup.size_bytes)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {/* Cloud sync status badge */}
                        {cloudConfig?.enabled && getSyncStatus(backup.filename) && (
                          <Badge
                            variant="outline"
                            className={
                              getSyncStatus(backup.filename) === "synced"
                                ? "bg-green-500/10 text-green-500"
                                : getSyncStatus(backup.filename) === "failed"
                                ? "bg-red-500/10 text-red-500"
                                : "bg-yellow-500/10 text-yellow-500"
                            }
                          >
                            {getSyncStatus(backup.filename) === "synced" && <Check className="h-3 w-3 mr-1" />}
                            {getSyncStatus(backup.filename) === "failed" && <AlertCircle className="h-3 w-3 mr-1" />}
                            {getSyncStatus(backup.filename) === "synced"
                              ? t("cloudStorage.synced")
                              : getSyncStatus(backup.filename) === "failed"
                              ? t("cloudStorage.failed")
                              : t("cloudStorage.pending")}
                          </Badge>
                        )}
                        {/* Cloud upload button */}
                        {cloudConfig?.enabled && getSyncStatus(backup.filename) !== "synced" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleCloudUpload(backup)}
                            disabled={uploadingBackup === backup.filename}
                            title={t("cloudStorage.uploadToCloud")}
                          >
                            {uploadingBackup === backup.filename ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Upload className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setSelectedBackup(backup);
                            setRestoreDialogOpen(true);
                          }}
                          title={t("instanceDetails.restoreBackup")}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setSelectedBackup(backup);
                            setDeleteBackupDialogOpen(true);
                          }}
                          title={t("instanceDetails.deleteBackup")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={() => selectedWorld && handleBackup(selectedWorld)}
              disabled={isBackingUp}
            >
              {isBackingUp && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("instanceDetails.createBackup")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete World Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("instanceDetails.deleteWorld")}
            </DialogTitle>
            <DialogDescription>
              {t("instanceDetails.deleteWorldConfirm")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
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
            <DialogTitle>
              {t("instanceDetails.restoreBackup")}
            </DialogTitle>
            <DialogDescription>
              {t("instanceDetails.restoreConfirm")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleRestore} disabled={isRestoring}>
              {isRestoring && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("instanceDetails.restore")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicate Dialog */}
      <Dialog open={duplicateDialogOpen} onOpenChange={setDuplicateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("instanceDetails.duplicateWorld")}</DialogTitle>
            <DialogDescription>
              {t("instanceDetails.duplicateWorldDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="newName">{t("instanceDetails.newWorldName")}</Label>
            <Input
              id="newName"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("instanceDetails.worldNamePlaceholder")}
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDuplicateDialogOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleDuplicate}
              disabled={isDuplicating || !newName.trim()}
            >
              {isDuplicating && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {t("instanceDetails.duplicate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("instanceDetails.renameWorld")}</DialogTitle>
            <DialogDescription>
              {t("instanceDetails.renameWorldDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="renameName">
              {t("instanceDetails.newWorldName")}
            </Label>
            <Input
              id="renameName"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("instanceDetails.worldNamePlaceholder")}
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameDialogOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleRename}
              disabled={isRenaming || !newName.trim()}
            >
              {isRenaming && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("instanceDetails.rename")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Backup Dialog */}
      <Dialog
        open={deleteBackupDialogOpen}
        onOpenChange={setDeleteBackupDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("instanceDetails.deleteBackup")}
            </DialogTitle>
            <DialogDescription>
              {t("instanceDetails.deleteBackupConfirm")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteBackupDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteBackup}
            >
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default WorldsTab;
