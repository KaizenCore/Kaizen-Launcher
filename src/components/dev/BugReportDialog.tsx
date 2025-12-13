import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Bug,
  Camera,
  Send,
  Loader2,
  AlertCircle,
  FileText,
  Info,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useTranslation } from "@/i18n";
import { useDevModeStore, type SystemInfo } from "@/stores/devModeStore";

interface BugReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BugReportDialog({ open, onOpenChange }: BugReportDialogProps) {
  const { t } = useTranslation();
  const { webhookUrl, submitBugReport, getSystemInfo } = useDevModeStore();

  const [message, setMessage] = useState("");
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const [includeLogs, setIncludeLogs] = useState(true);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [capturingScreenshot, setCapturingScreenshot] = useState(false);
  // Track if we're in the middle of capturing (dialog should stay hidden)
  const [dialogReady, setDialogReady] = useState(false);
  const isCapturingRef = useRef(false);

  // Load system info and capture screenshot when dialog opens
  useEffect(() => {
    if (open && !isCapturingRef.current) {
      // Start capturing - keep dialog hidden
      isCapturingRef.current = true;
      setDialogReady(false);

      // Load system info
      getSystemInfo().then(setSystemInfo).catch(console.error);

      // Capture screenshot BEFORE showing the dialog
      if (includeScreenshot) {
        // Small delay to ensure dialog overlay is not yet visible
        requestAnimationFrame(() => {
          captureScreenshot().finally(() => {
            setDialogReady(true);
            isCapturingRef.current = false;
          });
        });
      } else {
        setDialogReady(true);
        isCapturingRef.current = false;
      }
    } else if (!open) {
      // Reset state when closing
      setMessage("");
      setScreenshot(null);
      setSystemInfo(null);
      setDialogReady(false);
      isCapturingRef.current = false;
    }
  }, [open, getSystemInfo, includeScreenshot]);

  // Re-capture screenshot if option is toggled on (manual retake)
  const handleRetakeScreenshot = useCallback(async () => {
    if (!open) return;

    // Temporarily hide dialog to capture clean screenshot
    setDialogReady(false);

    // Wait for dialog to hide
    await new Promise(resolve => setTimeout(resolve, 100));

    await captureScreenshot();

    // Show dialog again
    setDialogReady(true);
  }, [open]);

  const captureScreenshot = useCallback(async () => {
    setCapturingScreenshot(true);
    try {
      // Dynamically import html2canvas to avoid bundling if not used
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(document.body, {
        useCORS: true,
        allowTaint: true,
        backgroundColor: null,
        scale: 1, // Lower scale for smaller file size
        logging: false,
      });
      const dataUrl = canvas.toDataURL("image/png");
      // Remove data:image/png;base64, prefix
      setScreenshot(dataUrl.split(",")[1]);
    } catch (error) {
      console.error("Failed to capture screenshot:", error);
      setScreenshot(null);
      toast.error(t("devtools.screenshotFailed"));
    } finally {
      setCapturingScreenshot(false);
    }
  }, [t]);

  const handleSubmit = async () => {
    if (!webhookUrl) {
      toast.error(t("devtools.webhookNotConfigured"));
      return;
    }

    setSubmitting(true);
    try {
      await submitBugReport(
        message || null,
        includeScreenshot ? screenshot : null,
        includeLogs
      );
      toast.success(t("devtools.bugReportSent"));
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to submit bug report:", error);
      toast.error(
        error instanceof Error ? error.message : t("devtools.bugReportFailed")
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Show webhook not configured warning
  if (!webhookUrl) {
    return (
      <Dialog open={open && dialogReady} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-yellow-500" />
              {t("devtools.webhookRequired")}
            </DialogTitle>
            <DialogDescription>
              {t("devtools.webhookRequiredDesc")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open && dialogReady} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bug className="h-5 w-5 text-red-500" />
            {t("devtools.reportBug")}
          </DialogTitle>
          <DialogDescription>{t("devtools.reportBugDesc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Message */}
          <div className="space-y-2">
            <Label htmlFor="message">{t("devtools.bugDescription")}</Label>
            <Textarea
              id="message"
              placeholder={t("devtools.bugDescriptionPlaceholder")}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
            />
          </div>

          {/* Options */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="screenshot"
                  checked={includeScreenshot}
                  onCheckedChange={(checked) => {
                    setIncludeScreenshot(!!checked);
                    // If toggling on and no screenshot, capture one
                    if (checked && !screenshot) {
                      handleRetakeScreenshot();
                    }
                  }}
                />
                <Label
                  htmlFor="screenshot"
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <Camera className="h-4 w-4" />
                  {t("devtools.includeScreenshot")}
                  {capturingScreenshot && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  )}
                </Label>
              </div>
              {includeScreenshot && screenshot && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRetakeScreenshot}
                  disabled={capturingScreenshot}
                  className="h-7 px-2 text-xs"
                >
                  <Camera className="h-3 w-3 mr-1" />
                  {t("devtools.retakeScreenshot")}
                </Button>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="logs"
                checked={includeLogs}
                onCheckedChange={(checked) => setIncludeLogs(!!checked)}
              />
              <Label
                htmlFor="logs"
                className="flex items-center gap-2 cursor-pointer"
              >
                <FileText className="h-4 w-4" />
                {t("devtools.includeLogs")}
              </Label>
            </div>
          </div>

          {/* System Info Preview */}
          {systemInfo && (
            <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 space-y-1">
              <p className="font-medium flex items-center gap-1">
                <Info className="h-3 w-3" />
                {t("devtools.systemInfo")}:
              </p>
              <p>
                App: v{systemInfo.app_version}
              </p>
              <p>
                OS: {systemInfo.os} {systemInfo.os_version} ({systemInfo.arch})
              </p>
              <p>
                RAM:{" "}
                {Math.round(
                  (systemInfo.total_memory_mb - systemInfo.available_memory_mb) /
                    1024
                )}
                GB /{" "}
                {Math.round(systemInfo.total_memory_mb / 1024)}
                GB
              </p>
              {systemInfo.active_instances.length > 0 && (
                <p>
                  Instances: {systemInfo.active_instances.length} (
                  {systemInfo.active_instances.filter((i) => i.is_running).length}{" "}
                  running)
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            {t("devtools.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
