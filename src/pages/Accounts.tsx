import { useState, useEffect, useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Plus, User, Check, Trash2, Crown, Star } from "lucide-react"
import { toast } from "sonner"
import { useTranslation } from "@/i18n"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { AddAccountDialog } from "@/components/dialogs/AddAccountDialog"
import { DeleteAccountDialog } from "@/components/dialogs/DeleteAccountDialog"
import { AddKaizenAccountDialog } from "@/components/dialogs/AddKaizenAccountDialog"

// Safe account info from backend - NO TOKENS (security)
interface Account {
  id: string
  uuid: string
  username: string
  expires_at: string
  skin_url: string | null
  is_active: boolean
  created_at: string
  has_valid_token: boolean
  is_offline: boolean
}

// Safe Kaizen account info from backend - NO TOKENS (security)
interface KaizenAccount {
  id: string
  user_id: string
  username: string
  email: string
  expires_at: string
  permissions: string
  tags: string
  badges: string
  is_patron: boolean
  is_active: boolean
  created_at: string
  has_valid_token: boolean
}

interface KaizenBadge {
  slug: string
  name: string
  badge_type: string
  icon: string | null
  style: {
    backgroundColor: string | null
    textColor: string | null
    borderColor: string | null
    palette: string | null
  } | null
  permissions: string[]
}

function isOfflineAccount(account: Account): boolean {
  return account.is_offline
}

function getKaizenPermissions(account: KaizenAccount): string[] {
  try {
    return JSON.parse(account.permissions) as string[]
  } catch {
    return []
  }
}

function getKaizenBadges(account: KaizenAccount): KaizenBadge[] {
  try {
    return JSON.parse(account.badges) as KaizenBadge[]
  } catch {
    return []
  }
}

export function Accounts() {
  const { t } = useTranslation()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [kaizenAccounts, setKaizenAccounts] = useState<KaizenAccount[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [kaizenDialogOpen, setKaizenDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [accountToDelete, setAccountToDelete] = useState<Account | null>(null)
  const [kaizenAccountToDelete, setKaizenAccountToDelete] = useState<KaizenAccount | null>(null)

  const loadAccounts = useCallback(async () => {
    console.log("[Accounts] Loading accounts...")
    try {
      const [minecraftAccounts, kaizenAccts] = await Promise.all([
        invoke<Account[]>("get_accounts"),
        invoke<KaizenAccount[]>("get_kaizen_accounts")
      ])
      console.log(`[Accounts] Loaded ${minecraftAccounts.length} Minecraft accounts, ${kaizenAccts.length} Kaizen accounts`)
      setAccounts(minecraftAccounts)
      setKaizenAccounts(kaizenAccts)
    } catch (err) {
      console.error("[Accounts] Failed to load accounts:", err)
      toast.error(t("accounts.unableToLoad"))
    } finally {
      setIsLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    console.log("[Accounts] Page mounted")
    loadAccounts()
  }, [loadAccounts])

  const handleSetActive = async (accountId: string) => {
    console.log(`[Accounts] Setting active account: ${accountId}`)
    try {
      await invoke("set_active_account", { accountId })
      console.log(`[Accounts] Account activated: ${accountId}`)
      toast.success(t("accounts.accountActivated"))
      loadAccounts()
    } catch (err) {
      console.error("[Accounts] Failed to set active account:", err)
      toast.error(t("accounts.unableToActivate"))
    }
  }

  const openDeleteDialog = (account: Account) => {
    setAccountToDelete(account)
    setDeleteDialogOpen(true)
  }

  const openKaizenDeleteDialog = (account: KaizenAccount) => {
    setKaizenAccountToDelete(account)
    setDeleteDialogOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (kaizenAccountToDelete) {
      // Deleting a Kaizen account
      console.log(`[Accounts] Deleting Kaizen account: ${kaizenAccountToDelete.username}`)
      try {
        await invoke("delete_kaizen_account", { accountId: kaizenAccountToDelete.id })
        console.log(`[Accounts] Kaizen account deleted: ${kaizenAccountToDelete.username}`)
        toast.success(t("accounts.kaizenAccountDisconnected"))
        loadAccounts()
      } catch (err) {
        console.error("[Accounts] Failed to delete Kaizen account:", err)
        toast.error(t("accounts.unableToDelete"))
      } finally {
        setKaizenAccountToDelete(null)
      }
      return
    }

    if (!accountToDelete) return

    console.log(`[Accounts] Deleting account: ${accountToDelete.username}`)
    try {
      await invoke("delete_account", { accountId: accountToDelete.id })
      console.log(`[Accounts] Account deleted: ${accountToDelete.username}`)
      toast.success(t("accounts.accountDeleted"))
      loadAccounts()
    } catch (err) {
      console.error("[Accounts] Failed to delete account:", err)
      toast.error(t("accounts.unableToDelete"))
    } finally {
      setAccountToDelete(null)
    }
  }

  const handleCloseDeleteDialog = (open: boolean) => {
    setDeleteDialogOpen(open)
    if (!open) {
      setAccountToDelete(null)
      setKaizenAccountToDelete(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("accounts.title")}</h1>
          <p className="text-muted-foreground">
            {t("accounts.subtitle")}
          </p>
        </div>
        <Button className="gap-2" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          {t("accounts.add")}
        </Button>
      </div>

      {/* Minecraft Accounts Section */}
      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <User className="h-5 w-5" />
          {t("accounts.minecraftAccounts")}
        </h2>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <Card key={i}>
                <CardContent className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-4">
                    <Skeleton className="h-12 w-12 rounded-full" />
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-8 w-24" />
                    <Skeleton className="h-8 w-8" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : accounts.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <div className="rounded-full bg-muted p-4 mb-4">
                <User className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="font-semibold mb-1">{t("accounts.noAccounts")}</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {t("accounts.addFirst")}
              </p>
              <Button className="gap-2" onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4" />
                {t("accounts.add")}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {accounts.map((account) => (
              <Card
                key={account.id}
                className={account.is_active ? "border-primary" : ""}
              >
                <CardContent className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-12 w-12">
                      <AvatarImage
                        src={`https://mc-heads.net/avatar/${account.username}/64`}
                        alt={account.username}
                      />
                      <AvatarFallback>
                        {account.username.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{account.username}</p>
                        {isOfflineAccount(account) ? (
                          <Badge variant="secondary" className="text-xs">
                            {t("accounts.offline")}
                          </Badge>
                        ) : (
                          <Badge variant="default" className="text-xs bg-[#00a2ed] hover:bg-[#0090d4]">
                            {t("accounts.microsoft")}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {account.is_active ? t("accounts.active") : t("accounts.setActive")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!account.is_active && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSetActive(account.id)}
                      >
                        <Check className="h-4 w-4 mr-2" />
                        {t("accounts.setActive")}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openDeleteDialog(account)}
                      aria-label={t("accounts.delete")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Kaizen Accounts Section */}
      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Star className="h-5 w-5 text-primary" />
          {t("accounts.kaizenAccounts")}
        </h2>
        {isLoading ? (
          <Card>
            <CardContent className="flex items-center justify-between py-4">
              <div className="flex items-center gap-4">
                <Skeleton className="h-12 w-12 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            </CardContent>
          </Card>
        ) : kaizenAccounts.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-8 text-center">
              <div className="rounded-full bg-primary/10 p-3 mb-3">
                <Star className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-medium mb-1">{t("accounts.noKaizenAccounts")}</h3>
              <p className="text-sm text-muted-foreground mb-3">
                {t("accounts.connectKaizen")}
              </p>
              <Button variant="outline" className="gap-2" onClick={() => setKaizenDialogOpen(true)}>
                <Plus className="h-4 w-4" />
                {t("accounts.loginKaizen")}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {kaizenAccounts.map((account) => {
              const badges = getKaizenBadges(account)
              const permissions = getKaizenPermissions(account)
              return (
                <Card key={account.id} className="border-primary/50">
                  <CardContent className="flex items-center justify-between py-4">
                    <div className="flex items-center gap-4">
                      <Avatar className="h-12 w-12 bg-primary/10">
                        <AvatarFallback className="bg-primary/10 text-primary">
                          {account.username.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium">{account.username}</p>
                          <Badge variant="default" className="text-xs bg-primary hover:bg-primary/90">
                            Kaizen
                          </Badge>
                          {account.is_patron && (
                            <Badge variant="secondary" className="text-xs gap-1 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20">
                              <Crown className="h-3 w-3" />
                              {t("kaizen.patron")}
                            </Badge>
                          )}
                          {/* Display badges from API */}
                          {badges.map((badge) => (
                            <Badge
                              key={badge.slug}
                              variant="secondary"
                              className="text-xs gap-1"
                              style={{
                                backgroundColor: badge.style?.backgroundColor || undefined,
                                color: badge.style?.textColor || undefined,
                                borderColor: badge.style?.borderColor || undefined,
                                borderWidth: badge.style?.borderColor ? '1px' : undefined,
                                borderStyle: badge.style?.borderColor ? 'solid' : undefined,
                              }}
                            >
                              {badge.name}
                            </Badge>
                          ))}
                        </div>
                        <p className="text-sm text-muted-foreground">{account.email}</p>
                        {/* Display permissions */}
                        {permissions.length > 0 && (
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className="text-xs text-muted-foreground">{t("kaizen.permissions")}:</span>
                            {permissions.map((permission) => (
                              <Badge
                                key={permission}
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 h-4 font-normal"
                              >
                                {permission.replace(/_/g, ' ')}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openKaizenDeleteDialog(account)}
                        aria-label={t("kaizen.disconnect")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* Add Account Dialog */}
      <AddAccountDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={loadAccounts}
      />

      {/* Add Kaizen Account Dialog */}
      <AddKaizenAccountDialog
        open={kaizenDialogOpen}
        onOpenChange={setKaizenDialogOpen}
        onSuccess={loadAccounts}
      />

      {/* Delete Account Dialog */}
      <DeleteAccountDialog
        open={deleteDialogOpen}
        onOpenChange={handleCloseDeleteDialog}
        username={accountToDelete?.username || kaizenAccountToDelete?.username || ""}
        onConfirm={handleConfirmDelete}
      />
    </div>
  )
}
