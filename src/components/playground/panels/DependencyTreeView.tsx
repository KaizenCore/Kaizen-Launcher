import { useMemo } from "react";
import {
  Package,
  AlertCircle,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import type { ModInfoWithDependencies, DependencyInfo } from "@/types/playground";

interface DependencyTreeViewProps {
  mod: ModInfoWithDependencies;
}

export function DependencyTreeView({ mod }: DependencyTreeViewProps) {
  const mods = usePlaygroundStore((s) => s.mods);

  const requiredDeps = useMemo(
    () => mod.dependencies.filter((d) => d.dependency_type === "required"),
    [mod.dependencies]
  );

  const optionalDeps = useMemo(
    () => mod.dependencies.filter((d) => d.dependency_type === "optional"),
    [mod.dependencies]
  );

  const dependents = useMemo(() => {
    // Find mods that depend on this one
    return mods.filter((m) =>
      m.dependencies.some((d) => d.project_id === mod.project_id)
    );
  }, [mods, mod.project_id]);

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 space-y-4">
      {/* Required dependencies */}
      <div>
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
          Required Dependencies
          <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
            {requiredDeps.length}
          </Badge>
        </h4>
        {requiredDeps.length > 0 ? (
          <div className="space-y-1">
            {requiredDeps.map((dep) => (
              <DependencyItem key={dep.project_id} dependency={dep} mods={mods} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No required dependencies</p>
        )}
      </div>

      {/* Optional dependencies */}
      {optionalDeps.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
            Optional Dependencies
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
              {optionalDeps.length}
            </Badge>
          </h4>
          <div className="space-y-1">
            {optionalDeps.map((dep) => (
              <DependencyItem key={dep.project_id} dependency={dep} mods={mods} />
            ))}
          </div>
        </div>
      )}

      {/* Dependents (mods that depend on this one) */}
      <div>
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
          Required By
          <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
            {dependents.length}
          </Badge>
        </h4>
        {dependents.length > 0 ? (
          <div className="space-y-1">
            {dependents.map((dep) => (
              <DependentItem key={dep.filename} mod={dep} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No mods depend on this</p>
        )}
      </div>
    </div>
  );
}

interface DependencyItemProps {
  dependency: DependencyInfo;
  mods: ModInfoWithDependencies[];
}

function DependencyItem({ dependency, mods }: DependencyItemProps) {
  const selectMod = usePlaygroundStore((s) => s.selectMod);

  // Find installed mod matching this dependency
  const installedMod = mods.find((m) => m.project_id === dependency.project_id);
  const isInstalled = !!installedMod;
  const isEnabled = installedMod?.enabled ?? false;
  const isRequired = dependency.dependency_type === "required";

  const handleClick = () => {
    if (installedMod) {
      selectMod(installedMod.filename);
    }
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2 p-2 rounded-md transition-colors",
        installedMod && "cursor-pointer hover:bg-accent/50"
      )}
      onClick={handleClick}
    >
      {/* Status icon */}
      {!isInstalled ? (
        <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />
      ) : isEnabled ? (
        <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
      ) : (
        <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      )}

      {/* Icon */}
      {installedMod?.icon_url ? (
        <img
          src={installedMod.icon_url}
          alt={installedMod.name}
          className="w-6 h-6 rounded object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-6 h-6 rounded bg-muted flex items-center justify-center flex-shrink-0">
          <Package className="h-3 w-3 text-muted-foreground" />
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <span className="text-sm truncate block">
          {installedMod?.name || dependency.project_id}
        </span>
        {installedMod && (
          <span className="text-xs text-muted-foreground">{installedMod.version}</span>
        )}
      </div>

      {/* Badges */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {!isInstalled && isRequired && (
          <Badge variant="destructive" className="text-[10px] h-4 px-1.5">
            Missing
          </Badge>
        )}
        {isInstalled && !isEnabled && (
          <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
            Disabled
          </Badge>
        )}
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] h-4 px-1.5",
            isRequired ? "border-destructive/50 text-destructive" : "text-muted-foreground"
          )}
        >
          {isRequired ? "Required" : "Optional"}
        </Badge>
      </div>
    </div>
  );
}

interface DependentItemProps {
  mod: ModInfoWithDependencies;
}

function DependentItem({ mod }: DependentItemProps) {
  const selectMod = usePlaygroundStore((s) => s.selectMod);

  const handleClick = () => {
    selectMod(mod.filename);
  };

  return (
    <div
      className="flex items-center gap-2 p-2 rounded-md cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={handleClick}
    >
      {/* Icon */}
      {mod.icon_url ? (
        <img
          src={mod.icon_url}
          alt={mod.name}
          className="w-6 h-6 rounded object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-6 h-6 rounded bg-muted flex items-center justify-center flex-shrink-0">
          <Package className="h-3 w-3 text-muted-foreground" />
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <span className="text-sm truncate block">{mod.name}</span>
        <span className="text-xs text-muted-foreground">{mod.version}</span>
      </div>

      {/* Status */}
      {!mod.enabled && (
        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
          Disabled
        </Badge>
      )}
    </div>
  );
}

export default DependencyTreeView;
