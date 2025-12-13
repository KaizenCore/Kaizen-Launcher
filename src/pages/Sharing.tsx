import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Share2,
  Download,
  Upload,
  Copy,
  StopCircle,
  Clock,
  Package,
  Link2,
} from "lucide-react";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSharingStore } from "@/stores/sharingStore";

// Types matching Rust backend
interface ActiveShare {
  share_id: string;
  instance_name: string;
  package_path: string;
  local_port: number;
  public_url: string | null;
  download_count: number;
  uploaded_bytes: number;
  started_at: string;
  file_size: number;
  provider: "bore" | "cloudflare";
}

interface ShareStatusEvent {
  share_id: string;
  status: string;
  public_url?: string;
  error?: string;
}

interface ShareDownloadEvent {
  share_id: string;
  download_count: number;
  uploaded_bytes: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDuration(startedAt: string): string {
  const start = new Date(startedAt).getTime();
  const seconds = Math.floor((Date.now() - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function Sharing() {
  const { t } = useTranslation();
  const { removeSeed, activeSeeds } = useSharingStore();
  const [activeShares, setActiveShares] = useState<ActiveShare[]>([]);
  const [shareToStop, setShareToStop] = useState<ActiveShare | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch active shares on mount
  useEffect(() => {
    const fetchShares = async () => {
      try {
        const shares = await invoke<ActiveShare[]>("get_active_shares");
        setActiveShares(shares);
      } catch (err) {
        console.error("[SHARE] Failed to fetch active shares:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchShares();

    // Refresh periodically
    const interval = setInterval(fetchShares, 5000);

    return () => clearInterval(interval);
  }, []);

  // Listen for share status events
  useEffect(() => {
    const unlisten = listen<ShareStatusEvent>("share-status", async () => {
      // Refresh active shares when status changes
      try {
        const shares = await invoke<ActiveShare[]>("get_active_shares");
        setActiveShares(shares);
      } catch (err) {
        console.error("[SHARE] Failed to refresh shares:", err);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for share download events (real-time stats update)
  useEffect(() => {
    const unlisten = listen<ShareDownloadEvent>("share-download", (event) => {
      // Update the specific share's stats without full refresh
      setActiveShares((prev) =>
        prev.map((share) =>
          share.share_id === event.payload.share_id
            ? {
                ...share,
                download_count: event.payload.download_count,
                uploaded_bytes: event.payload.uploaded_bytes,
              }
            : share
        )
      );
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleCopyLink = async (share: ActiveShare) => {
    if (!share.public_url) return;
    try {
      await navigator.clipboard.writeText(share.public_url);
      setCopiedId(share.share_id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleStopShare = async (share: ActiveShare) => {
    console.log(`[Sharing] Stopping share: ${share.instance_name} (${share.share_id})`)
    try {
      await invoke("stop_share", { shareId: share.share_id });
      console.log(`[Sharing] Share stopped: ${share.instance_name}`)
      setActiveShares((prev) =>
        prev.filter((s) => s.share_id !== share.share_id)
      );
      // Also remove from the store (match by package_path since IDs differ)
      for (const [exportId, seed] of activeSeeds.entries()) {
        if (seed.packagePath === share.package_path) {
          removeSeed(exportId);
          break;
        }
      }
    } catch (err) {
      console.error("[Sharing] Failed to stop share:", err);
    }
    setShareToStop(null);
  };

  const handleStopAll = async () => {
    console.log(`[Sharing] Stopping all ${activeShares.length} shares...`)
    try {
      await invoke("stop_all_shares");
      console.log("[Sharing] All shares stopped")
      setActiveShares([]);
      // Clear all seeds from store
      for (const exportId of activeSeeds.keys()) {
        removeSeed(exportId);
      }
    } catch (err) {
      console.error("[Sharing] Failed to stop all shares:", err);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <Share2 className="h-12 w-12 text-muted-foreground animate-pulse" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Share2 className="h-6 w-6" />
            {t("sharing.title")}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t("sharing.subtitle")}
          </p>
        </div>
        {activeShares.length > 0 && (
          <Button variant="destructive" onClick={handleStopAll}>
            <StopCircle className="h-4 w-4 mr-2" />
            {t("sharing.stopAll")}
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {activeShares.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Share2 className="h-16 w-16 text-muted-foreground/50 mb-4" />
            <h2 className="text-xl font-semibold mb-2">
              {t("sharing.noActiveShares")}
            </h2>
            <p className="text-muted-foreground max-w-md">
              {t("sharing.noActiveSharesDescription")}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2 3xl:grid-cols-3 4xl:grid-cols-4">
            {activeShares.map((share) => (
              <Card key={share.share_id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-primary/10 rounded-lg">
                        <Package className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">
                          {share.instance_name}
                        </CardTitle>
                        <CardDescription className="flex items-center gap-2 mt-1">
                          <Clock className="h-3 w-3" />
                          {t("sharing.seedingFor", { duration: formatDuration(share.started_at) })}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={
                          share.provider === "cloudflare"
                            ? "bg-blue-500/10 text-blue-500 border-blue-500/30"
                            : "bg-orange-500/10 text-orange-500 border-orange-500/30"
                        }
                      >
                        {share.provider === "cloudflare" ? "HTTPS" : "HTTP"}
                      </Badge>
                      <Badge variant="secondary" className="bg-green-500/10 text-green-500">
                        {t("sharing.seeding")}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-3">
                    {/* Share URL */}
                    {share.public_url && (
                      <div className="flex items-center gap-2 p-2 bg-muted rounded-lg">
                        <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm font-mono truncate flex-1">
                          {share.public_url}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      {/* Stats */}
                      <div className="flex items-center gap-6 text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Download className="h-4 w-4" />
                          <span>
                            {share.download_count} {t("sharing.downloads")}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Upload className="h-4 w-4" />
                          <span>{formatBytes(share.uploaded_bytes)}</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        {share.public_url && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleCopyLink(share)}
                          >
                            <Copy className="h-4 w-4 mr-2" />
                            {copiedId === share.share_id
                              ? t("sharing.copied")
                              : t("sharing.copyMagnet")}
                          </Button>
                        )}
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setShareToStop(share)}
                        >
                          <StopCircle className="h-4 w-4 mr-2" />
                          {t("sharing.stop")}
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Stop confirmation dialog */}
      <AlertDialog open={!!shareToStop} onOpenChange={() => setShareToStop(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("sharing.stopSeedingTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("sharing.stopSeedingDescription", {
                name: shareToStop?.instance_name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => shareToStop && handleStopShare(shareToStop)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("sharing.stopSharing")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
