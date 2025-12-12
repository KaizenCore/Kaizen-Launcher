import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useTranslation } from "@/i18n";
import { Download, RefreshCw, X, AlertTriangle } from "lucide-react";
import type { UpdateInfo } from "@/hooks/useUpdateChecker";

interface UpdateNotificationProps {
  open: boolean;
  updateInfo: UpdateInfo | null;
  downloading: boolean;
  downloadProgress: number;
  error: string | null;
  onDownload: () => void;
  onDismiss: () => void;
}

export function UpdateNotification({
  open,
  updateInfo,
  downloading,
  downloadProgress,
  error,
  onDownload,
  onDismiss,
}: UpdateNotificationProps) {
  const { t } = useTranslation();

  if (!updateInfo) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onDismiss()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-primary" />
            {t("updater.updateAvailable")}
          </DialogTitle>
          <DialogDescription>
            {t("updater.newVersionAvailable", { version: updateInfo.version })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Version info */}
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("updater.version")}</span>
              <span className="font-medium">{updateInfo.version}</span>
            </div>
            {updateInfo.date && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t("updater.releaseDate")}</span>
                <span className="font-medium">
                  {new Date(updateInfo.date).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>

          {/* Warning for non-stable versions */}
          {!updateInfo.isStableVersion && (
            <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10">
              <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-amber-500">{t("updater.devVersionWarning")}</p>
                <p className="text-muted-foreground mt-1">{t("updater.devVersionDescription")}</p>
              </div>
            </div>
          )}

          {/* Release notes */}
          {updateInfo.body && (
            <div className="space-y-2">
              <span className="text-sm font-medium">{t("updater.releaseNotes")}</span>
              <div className="rounded-lg border p-3 max-h-32 overflow-y-auto">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {updateInfo.body}
                </p>
              </div>
            </div>
          )}

          {/* Download progress */}
          {downloading && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{t("updater.downloading")}</span>
                <span>{downloadProgress}%</span>
              </div>
              <Progress value={downloadProgress} className="h-2" />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-destructive bg-destructive/10 p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={onDismiss}
            disabled={downloading}
            className="w-full sm:w-auto"
          >
            <X className="h-4 w-4 mr-2" />
            {t("updater.later")}
          </Button>
          <Button
            onClick={onDownload}
            disabled={downloading}
            className="w-full sm:w-auto"
          >
            {downloading ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                {t("updater.installing")}
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                {t("updater.updateNow")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
