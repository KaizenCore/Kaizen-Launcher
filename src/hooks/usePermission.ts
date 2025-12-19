import { useEffect } from "react";
import { useKaizenStore, type LauncherPermission, PERMISSIONS } from "@/stores/kaizenStore";

/**
 * Hook to check if the current Kaizen account has a specific permission
 * @param permission - The permission to check
 * @returns Object with hasPermission boolean and loading state
 */
export function usePermission(permission: LauncherPermission | string) {
  const { hasPermission, loading, loadActiveAccount, account } = useKaizenStore();

  // Load account on mount if not already loaded
  useEffect(() => {
    if (!account && !loading) {
      loadActiveAccount();
    }
  }, [account, loading, loadActiveAccount]);

  return {
    hasPermission: hasPermission(permission),
    loading,
    isLoggedIn: !!account,
  };
}

/**
 * Hook to check if the current Kaizen account has any of the specified permissions
 * @param permissions - Array of permissions to check
 * @returns Object with hasPermission boolean and loading state
 */
export function useAnyPermission(permissions: (LauncherPermission | string)[]) {
  const { hasAnyPermission, loading, loadActiveAccount, account } = useKaizenStore();

  useEffect(() => {
    if (!account && !loading) {
      loadActiveAccount();
    }
  }, [account, loading, loadActiveAccount]);

  return {
    hasPermission: hasAnyPermission(permissions),
    loading,
    isLoggedIn: !!account,
  };
}

/**
 * Hook to check if the current Kaizen account has all of the specified permissions
 * @param permissions - Array of permissions to check
 * @returns Object with hasPermission boolean and loading state
 */
export function useAllPermissions(permissions: (LauncherPermission | string)[]) {
  const { hasAllPermissions, loading, loadActiveAccount, account } = useKaizenStore();

  useEffect(() => {
    if (!account && !loading) {
      loadActiveAccount();
    }
  }, [account, loading, loadActiveAccount]);

  return {
    hasPermission: hasAllPermissions(permissions),
    loading,
    isLoggedIn: !!account,
  };
}

/**
 * Hook to get all permissions and account info
 * @returns Object with permissions array, account, and utility functions
 */
export function useKaizenPermissions() {
  const store = useKaizenStore();

  useEffect(() => {
    if (!store.account && !store.loading) {
      store.loadActiveAccount();
    }
  }, [store]);

  return {
    permissions: store.permissions,
    account: store.account,
    tags: store.tags,
    badges: store.badges,
    loading: store.loading,
    error: store.error,
    isLoggedIn: !!store.account,
    hasPermission: store.hasPermission,
    hasAnyPermission: store.hasAnyPermission,
    hasAllPermissions: store.hasAllPermissions,
    reload: store.loadActiveAccount,
  };
}

// Re-export PERMISSIONS for convenience
export { PERMISSIONS };
