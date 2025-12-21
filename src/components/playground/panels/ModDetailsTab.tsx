import { useCallback } from "react";
import {
  Package,
  ExternalLink,
  Trash2,
  Power,
  PowerOff,
  AlertTriangle,
  Server,
  Monitor,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useTranslation } from "@/i18n";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import type { ModInfoWithDependencies } from "@/types/playground";

interface ModDetailsTabProps {
  mod: ModInfoWithDependencies;
}

const MODRINTH_PROJECT_URL = "https://modrinth.com/mod";

export function ModDetailsTab({ mod }: ModDetailsTabProps) {
  const { t } = useTranslation();

  const validation = usePlaygroundStore((s) => s.validation);
  const toggleMod = usePlaygroundStore((s) => s.toggleMod);
  const deleteMod = usePlaygroundStore((s) => s.deleteMod);

  const handleToggle = useCallback(() => {
    toggleMod(mod.filename, !mod.enabled);
  }, [mod.filename, mod.enabled, toggleMod]);

  const handleDelete = useCallback(() => {
    deleteMod(mod.filename);
  }, [mod.filename, deleteMod]);

  const handleOpenModrinth = useCallback(() => {
    if (mod.project_id) {
      window.open(`${MODRINTH_PROJECT_URL}/${mod.project_id}`, "_blank");
    }
  }, [mod.project_id]);

  // Check if this mod has missing dependencies
  const missingDeps = validation?.missing_required.filter(
    (m) => m.mod_name === mod.name
  ) || [];

  const depsCount = mod.dependencies?.length || 0;
  const dependentsCount = mod.dependents?.length || 0;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="p-4 space-y-4">
        <div className="flex items-start gap-3">
          {mod.icon_url ? (
            <img
              src={mod.icon_url}
              alt={mod.name}
              className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
            />
          ) : (
            <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
              <Package className="h-7 w-7 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base truncate">{mod.name}</h3>
            <p className="text-sm text-muted-foreground">{mod.version}</p>
            <div className="flex items-center gap-1.5 mt-1.5">
              <Badge variant={mod.enabled ? "default" : "secondary"} className="text-xs">
                {mod.enabled ? t("modsList.enabled") : t("modsList.disabled")}
              </Badge>
              {mod.server_side && (
                <Badge variant="outline" className="text-xs gap-1">
                  <Server className="h-3 w-3" />
                  {mod.server_side}
                </Badge>
              )}
              {mod.client_side && (
                <Badge variant="outline" className="text-xs gap-1">
                  <Monitor className="h-3 w-3" />
                  {mod.client_side}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Missing deps warning */}
        {missingDeps.length > 0 && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <div className="flex items-center gap-2 text-destructive text-sm font-medium mb-1">
              <AlertTriangle className="h-4 w-4" />
              Missing Dependencies
            </div>
            <p className="text-xs text-muted-foreground">
              This mod requires {missingDeps.length} missing{" "}
              {missingDeps.length === 1 ? "dependency" : "dependencies"}.
              Check the Dependencies tab for details.
            </p>
          </div>
        )}

        {/* Quick actions */}
        <div className="flex items-center gap-2">
          <Button
            variant={mod.enabled ? "outline" : "default"}
            size="sm"
            className="gap-1.5 flex-1"
            onClick={handleToggle}
          >
            {mod.enabled ? (
              <>
                <PowerOff className="h-4 w-4" />
                {t("common.disable")}
              </>
            ) : (
              <>
                <Power className="h-4 w-4" />
                {t("common.enable")}
              </>
            )}
          </Button>

          {mod.project_id && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={handleOpenModrinth}
            >
              <ExternalLink className="h-4 w-4" />
              Modrinth
            </Button>
          )}

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("instanceDetails.confirmDeleteMod")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("instanceDetails.confirmDeleteModDesc", { name: mod.name })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {t("common.delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <Separator />

      {/* Info section */}
      <div className="p-4 space-y-4">
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            File Info
          </h4>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Filename</span>
              <span className="font-mono text-xs truncate max-w-[60%]">{mod.filename}</span>
            </div>
            {mod.project_id && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Project ID</span>
                <span className="font-mono text-xs">{mod.project_id}</span>
              </div>
            )}
          </div>
        </div>

        <Separator />

        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Dependencies
          </h4>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Requires</span>
              <span>{depsCount} {depsCount === 1 ? "mod" : "mods"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Required by</span>
              <span>{dependentsCount} {dependentsCount === 1 ? "mod" : "mods"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ModDetailsTab;
