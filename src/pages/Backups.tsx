import { useState } from "react"
import { Globe, Package } from "lucide-react"
import { useTranslation } from "@/i18n"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { WorldBackupsTab } from "@/components/backups/WorldBackupsTab"
import { InstanceBackupsTab } from "@/components/backups/InstanceBackupsTab"

type BackupTab = "worlds" | "instances"

export function Backups() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<BackupTab>("worlds")

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex flex-col gap-6 h-full">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">{t("backups.title")}</h1>
          <p className="text-muted-foreground">{t("backups.subtitle")}</p>
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as BackupTab)}
          className="flex flex-col flex-1 min-h-0"
        >
          <TabsList className="w-fit">
            <TabsTrigger value="worlds" className="gap-2">
              <Globe className="h-4 w-4" />
              {t("backups.worldBackups")}
            </TabsTrigger>
            <TabsTrigger value="instances" className="gap-2">
              <Package className="h-4 w-4" />
              {t("backups.instanceBackupsTab")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="worlds" className="mt-4 flex-1 min-h-0">
            <WorldBackupsTab />
          </TabsContent>

          <TabsContent value="instances" className="mt-4 flex-1 min-h-0">
            <InstanceBackupsTab />
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  )
}
