import { ReactNode } from "react";
import { Lock, Loader2, Star } from "lucide-react";
import { usePermission, useAnyPermission } from "@/hooks/usePermission";
import { useTranslation } from "@/i18n";
import type { LauncherPermission } from "@/stores/kaizenStore";

interface RequirePermissionProps {
  /** Single permission required */
  permission?: LauncherPermission | string;
  /** Multiple permissions - user needs ANY of these */
  anyOf?: (LauncherPermission | string)[];
  /** What to show when permission is granted */
  children: ReactNode;
  /** Custom fallback when permission is denied */
  fallback?: ReactNode;
  /** Hide completely instead of showing fallback */
  hideIfDenied?: boolean;
  /** Show a compact inline version */
  inline?: boolean;
}

/**
 * Component that conditionally renders children based on Kaizen permissions
 */
export function RequirePermission({
  permission,
  anyOf,
  children,
  fallback,
  hideIfDenied = false,
  inline = false,
}: RequirePermissionProps) {
  const { t } = useTranslation();

  // Use appropriate hook based on props
  const singlePerm = usePermission(permission || "");
  const multiPerm = useAnyPermission(anyOf || []);

  const { hasPermission, loading, isLoggedIn } = anyOf ? multiPerm : singlePerm;

  // Show loading state
  if (loading) {
    if (inline) {
      return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    }
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Permission granted - render children
  if (hasPermission) {
    return <>{children}</>;
  }

  // Hide if denied
  if (hideIfDenied) {
    return null;
  }

  // Custom fallback
  if (fallback) {
    return <>{fallback}</>;
  }

  // Default denied UI
  const permissionName = permission || anyOf?.join(", ") || "unknown";

  if (inline) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground text-sm">
        <Lock className="h-3 w-3" />
        {t("permissions.locked")}
      </span>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Lock className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2">{t("permissions.accessRestricted")}</h3>
      {!isLoggedIn ? (
        <p className="text-muted-foreground text-sm max-w-md">
          {t("permissions.loginRequired")}
        </p>
      ) : (
        <p className="text-muted-foreground text-sm max-w-md">
          {t("permissions.permissionRequired", { permission: permissionName })}
        </p>
      )}
    </div>
  );
}

interface PermissionBadgeProps {
  permission: LauncherPermission | string;
  showStatus?: boolean;
}

/**
 * Badge that shows permission status
 */
export function PermissionBadge({ permission, showStatus = true }: PermissionBadgeProps) {
  const { hasPermission, loading } = usePermission(permission);

  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {permission}
      </span>
    );
  }

  if (hasPermission) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-500 border border-green-500/20">
        <Star className="h-3 w-3 fill-current" />
        {permission}
        {showStatus && <span className="opacity-60">- Granted</span>}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border">
      <Lock className="h-3 w-3" />
      {permission}
      {showStatus && <span className="opacity-60">- Denied</span>}
    </span>
  );
}

interface PermissionGateProps {
  permission: LauncherPermission | string;
  children: ReactNode;
  lockedContent?: ReactNode;
}

/**
 * Shows content but with a locked overlay if permission is denied
 * Good for showing features exist but are locked
 */
export function PermissionGate({ permission, children, lockedContent }: PermissionGateProps) {
  const { t } = useTranslation();
  const { hasPermission, loading } = usePermission(permission);

  if (loading) {
    return (
      <div className="relative">
        <div className="opacity-50 pointer-events-none">{children}</div>
        <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (hasPermission) {
    return <>{children}</>;
  }

  return (
    <div className="relative">
      <div className="opacity-30 pointer-events-none blur-[2px]">{children}</div>
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/60 backdrop-blur-sm">
        {lockedContent || (
          <>
            <Lock className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm font-medium text-muted-foreground">
              {t("permissions.featureLocked")}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">{permission}</p>
          </>
        )}
      </div>
    </div>
  );
}
