import { useState } from "react";
import {
  Share2,
  Users,
  Upload,
  Copy,
  StopCircle,
  Clock,
  Package,
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
import { useSharingStore, type SeedSession } from "@/stores/sharingStore";
import { webtorrentClient } from "@/lib/webtorrent";
import { invoke } from "@tauri-apps/api/core";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDuration(startedAt: number): string {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function Sharing() {
  const { t } = useTranslation();
  const { activeSeeds, removeSeed } = useSharingStore();
  const [seedToStop, setSeedToStop] = useState<SeedSession | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const seeds = Array.from(activeSeeds.values());

  const handleCopyMagnet = async (seed: SeedSession) => {
    if (!seed.magnetUri) return;
    try {
      await navigator.clipboard.writeText(seed.magnetUri);
      setCopiedId(seed.exportId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleStopSeed = async (seed: SeedSession) => {
    try {
      // Stop WebTorrent seeding
      webtorrentClient.stopSeed(seed.exportId);

      // Cleanup temp file
      await invoke("cleanup_export", { exportId: seed.exportId });

      // Remove from store
      removeSeed(seed.exportId);
    } catch (err) {
      console.error("Failed to stop seed:", err);
    }
    setSeedToStop(null);
  };

  const handleStopAll = async () => {
    for (const seed of seeds) {
      try {
        webtorrentClient.stopSeed(seed.exportId);
        await invoke("cleanup_export", { exportId: seed.exportId });
        removeSeed(seed.exportId);
      } catch (err) {
        console.error("Failed to stop seed:", err);
      }
    }
  };

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
        {seeds.length > 0 && (
          <Button variant="destructive" onClick={handleStopAll}>
            <StopCircle className="h-4 w-4 mr-2" />
            {t("sharing.stopAll")}
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {seeds.length === 0 ? (
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
          <div className="grid gap-4">
            {seeds.map((seed) => (
              <Card key={seed.exportId}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-primary/10 rounded-lg">
                        <Package className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">
                          {seed.instanceName}
                        </CardTitle>
                        <CardDescription className="flex items-center gap-2 mt-1">
                          <Clock className="h-3 w-3" />
                          {t("sharing.seedingFor", { duration: formatDuration(seed.startedAt) })}
                        </CardDescription>
                      </div>
                    </div>
                    <Badge variant="secondary" className="bg-green-500/10 text-green-500">
                      {t("sharing.seeding")}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    {/* Stats */}
                    <div className="flex items-center gap-6 text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Users className="h-4 w-4" />
                        <span>
                          {seed.peerCount} {t("sharing.peers")}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Upload className="h-4 w-4" />
                        <span>{formatBytes(seed.uploadedBytes)}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      {seed.magnetUri && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopyMagnet(seed)}
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          {copiedId === seed.exportId
                            ? t("sharing.copied")
                            : t("sharing.copyMagnet")}
                        </Button>
                      )}
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setSeedToStop(seed)}
                      >
                        <StopCircle className="h-4 w-4 mr-2" />
                        {t("sharing.stop")}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Stop confirmation dialog */}
      <AlertDialog open={!!seedToStop} onOpenChange={() => setSeedToStop(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("sharing.stopSeedingTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("sharing.stopSeedingDescription", {
                name: seedToStop?.instanceName ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => seedToStop && handleStopSeed(seedToStop)}
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
