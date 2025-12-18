import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "@/i18n";
import {
  Check,
  X,
  Loader2,
  AlertCircle,
  RefreshCw,
  Download,
} from "lucide-react";
import type { DependencyStatus } from "@/stores/systemCheckStore";

interface DependencyCardProps {
  name: string;
  description: string;
  icon: React.ReactNode;
  isRequired: boolean;
  status: DependencyStatus;
  version?: string;
  error?: string;
  progress?: number;
  progressMessage?: string;
  onInstall: () => void;
  onSkip?: () => void;
}

export function DependencyCard({
  name,
  description,
  icon,
  isRequired,
  status,
  version,
  error,
  progress = 0,
  progressMessage,
  onInstall,
  onSkip,
}: DependencyCardProps) {
  const { t } = useTranslation();
  const getStatusIcon = () => {
    switch (status) {
      case "checking":
        return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
      case "installed":
        return <Check className="h-5 w-5 text-green-500" />;
      case "missing":
        return <X className="h-5 w-5 text-red-500" />;
      case "installing":
        return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
      case "error":
        return <AlertCircle className="h-5 w-5 text-red-500" />;
      default:
        return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case "checking":
        return t("systemCheck.checking");
      case "installed":
        return version ? `${t("systemCheck.java.installed")} (${version})` : t("systemCheck.java.installed");
      case "missing":
        return t("systemCheck.java.notInstalled");
      case "installing":
        return progressMessage || t("systemCheck.installing");
      case "error":
        return error || t("systemCheck.java.installError");
      default:
        return "";
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-colors",
        status === "missing" && isRequired && "border-red-500/50 bg-red-500/5",
        status === "error" && "border-red-500/50 bg-red-500/5",
        status === "installed" && "border-green-500/50 bg-green-500/5",
        status === "installing" && "border-primary/50 bg-primary/5"
      )}
    >
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
          {icon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold">{name}</h3>
            <Badge
              variant={isRequired ? "destructive" : "secondary"}
              className="text-xs"
            >
              {isRequired ? t("systemCheck.java.required") : t("systemCheck.cloudflare.recommended")}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mb-3">{description}</p>

          {/* Status row */}
          <div className="flex items-center gap-2 text-sm">
            {getStatusIcon()}
            <span
              className={cn(
                status === "installed" && "text-green-500",
                status === "error" && "text-red-500",
                (status === "missing" || status === "checking") && "text-muted-foreground"
              )}
            >
              {getStatusText()}
            </span>
          </div>

          {/* Progress bar when installing */}
          {status === "installing" && (
            <div className="mt-3">
              <Progress value={progress} className="h-2" />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 shrink-0">
          {(status === "missing" || status === "error") && (
            <>
              <Button
                size="sm"
                onClick={onInstall}
                className="gap-2"
              >
                {status === "error" ? (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    {t("systemCheck.retry")}
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    {t("systemCheck.install")}
                  </>
                )}
              </Button>
              {!isRequired && onSkip && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onSkip}
                  className="text-muted-foreground"
                >
                  {t("systemCheck.cloudflare.skip")}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
