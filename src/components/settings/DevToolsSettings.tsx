import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Terminal,
  Bug,
  ExternalLink,
  Loader2,
  Check,
  AlertCircle,
  Send,
  Keyboard,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "@/i18n";
import { useDevModeStore } from "@/stores/devModeStore";

export function DevToolsSettings() {
  const { t } = useTranslation();
  const {
    enabled,
    webhookUrl,
    loading,
    load,
    setEnabled,
    setWebhookUrl,
    testWebhook,
    openLogViewer,
  } = useDevModeStore();

  const [webhookInput, setWebhookInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setWebhookInput(webhookUrl || "");
  }, [webhookUrl]);

  const handleToggleDevMode = async (checked: boolean) => {
    try {
      await setEnabled(checked);
      toast.success(
        checked
          ? t("devtools.devModeEnabled")
          : t("devtools.devModeDisabled")
      );
    } catch {
      toast.error(t("devtools.toggleFailed"));
    }
  };

  const handleOpenLogViewer = async () => {
    try {
      await openLogViewer();
    } catch (error) {
      console.error("Failed to open log viewer:", error);
      toast.error(t("devtools.openLogViewerFailed"));
    }
  };

  const handleSaveWebhook = async () => {
    setSaving(true);
    try {
      await setWebhookUrl(webhookInput || null);
      toast.success(t("devtools.webhookSaved"));
    } catch (error) {
      console.error("Failed to save webhook:", error);
      toast.error(
        error instanceof Error ? error.message : t("devtools.webhookSaveFailed")
      );
    } finally {
      setSaving(false);
    }
  };

  const handleTestWebhook = async () => {
    setTesting(true);
    try {
      const success = await testWebhook();
      if (success) {
        toast.success(t("devtools.webhookTestSuccess"));
      } else {
        toast.error(t("devtools.webhookTestFailed"));
      }
    } catch (error) {
      console.error("Webhook test failed:", error);
      toast.error(t("devtools.webhookTestFailed"));
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Dev Mode Toggle */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <Terminal className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <CardTitle className="text-lg">
                  {t("devtools.devMode")}
                </CardTitle>
                <CardDescription>{t("devtools.devModeDesc")}</CardDescription>
              </div>
            </div>
            <Switch checked={enabled} onCheckedChange={handleToggleDevMode} />
          </div>
        </CardHeader>
      </Card>

      {enabled && (
        <>
          {/* Log Viewer */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Terminal className="h-5 w-5" />
                {t("devtools.logViewer")}
              </CardTitle>
              <CardDescription>{t("devtools.logViewerDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button onClick={handleOpenLogViewer} className="gap-2">
                <ExternalLink className="h-4 w-4" />
                {t("devtools.openLogViewer")}
              </Button>

              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Keyboard className="h-4 w-4" />
                <span>{t("devtools.logViewerHotkey")}</span>
                <Badge variant="secondary" className="font-mono text-xs">
                  Ctrl+Shift+L
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Bug Report Webhook */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-red-500/10">
                  <Bug className="h-5 w-5 text-red-500" />
                </div>
                <div>
                  <CardTitle className="text-lg">
                    {t("devtools.bugReportWebhook")}
                  </CardTitle>
                  <CardDescription>
                    {t("devtools.bugReportWebhookDesc")}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="webhook-url">
                  {t("devtools.discordWebhookUrl")}
                </Label>
                <Input
                  id="webhook-url"
                  type="url"
                  placeholder="https://discord.com/api/webhooks/..."
                  value={webhookInput}
                  onChange={(e) => setWebhookInput(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t("devtools.webhookUrlHint")}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  onClick={handleSaveWebhook}
                  disabled={saving || webhookInput === (webhookUrl || "")}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4 mr-2" />
                  )}
                  {t("common.save")}
                </Button>

                {webhookUrl && (
                  <Button
                    variant="outline"
                    onClick={handleTestWebhook}
                    disabled={testing}
                  >
                    {testing ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    {t("devtools.testWebhook")}
                  </Button>
                )}
              </div>

              {!webhookUrl && (
                <div className="flex items-center gap-2 text-sm text-yellow-500">
                  <AlertCircle className="h-4 w-4" />
                  <span>{t("devtools.webhookNotConfigured")}</span>
                </div>
              )}

              <Separator />

              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {t("devtools.bugReportHotkey")}
                </p>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Keyboard className="h-4 w-4" />
                  <span>{t("devtools.pressToReport")}</span>
                  <Badge variant="secondary" className="font-mono text-xs">
                    Ctrl+Shift+B
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("devtools.bugReportIncludesDesc")}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Dev Monitor Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Terminal className="h-5 w-5" />
                {t("devtools.devMonitor")}
              </CardTitle>
              <CardDescription>{t("devtools.devMonitorDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Keyboard className="h-4 w-4" />
                <span>{t("devtools.devMonitorHotkey")}</span>
                <Badge variant="secondary" className="font-mono text-xs">
                  Ctrl+Shift+D
                </Badge>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
