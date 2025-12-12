import { useState, useEffect, useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Plus, User, Check, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { useTranslation } from "@/i18n"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { AddAccountDialog } from "@/components/dialogs/AddAccountDialog"
import { DeleteAccountDialog } from "@/components/dialogs/DeleteAccountDialog"

interface Account {
  id: string
  uuid: string
  username: string
  access_token: string
  skin_url: string | null
  is_active: boolean
}

function isOfflineAccount(account: Account): boolean {
  return account.access_token === "offline"
}

export function Accounts() {
  const { t } = useTranslation()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [accountToDelete, setAccountToDelete] = useState<Account | null>(null)

  const loadAccounts = useCallback(async () => {
    try {
      const result = await invoke<Account[]>("get_accounts")
      setAccounts(result)
    } catch (err) {
      console.error("Failed to load accounts:", err)
      toast.error(t("accounts.unableToLoad"))
    } finally {
      setIsLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  const handleSetActive = async (accountId: string) => {
    try {
      await invoke("set_active_account", { accountId })
      toast.success(t("accounts.accountActivated"))
      loadAccounts()
    } catch (err) {
      console.error("Failed to set active account:", err)
      toast.error(t("accounts.unableToActivate"))
    }
  }

  const openDeleteDialog = (account: Account) => {
    setAccountToDelete(account)
    setDeleteDialogOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!accountToDelete) return

    try {
      await invoke("delete_account", { accountId: accountToDelete.id })
      toast.success(t("accounts.accountDeleted"))
      loadAccounts()
    } catch (err) {
      console.error("Failed to delete account:", err)
      toast.error(t("accounts.unableToDelete"))
    } finally {
      setAccountToDelete(null)
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

      {/* Accounts list */}
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
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
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

      {/* Add Account Dialog */}
      <AddAccountDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={loadAccounts}
      />

      {/* Delete Account Dialog */}
      <DeleteAccountDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        username={accountToDelete?.username || ""}
        onConfirm={handleConfirmDelete}
      />
    </div>
  )
}
