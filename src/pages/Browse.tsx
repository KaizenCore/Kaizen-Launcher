import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Package, Blocks } from "lucide-react"
import { useTranslation } from "@/i18n"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ModpackBrowser } from "@/components/browse/ModpackBrowser"
import { ModBrowser } from "@/components/browse/ModBrowser"

export function Browse() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState("modpacks")

  const handleModpackInstalled = () => {
    console.log("[Browse] Modpack installed, navigating to instances")
    // Navigate to instances page after installing a modpack
    navigate("/instances")
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex-shrink-0 mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("browse.title")}</h1>
        <p className="text-muted-foreground">
          {t("browse.discoverContent")}
        </p>
      </div>

      {/* Content tabs - only mount active tab to prevent concurrent API calls */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
        <TabsList className="flex-shrink-0 w-fit">
          <TabsTrigger value="modpacks" className="gap-2">
            <Package className="h-4 w-4" />
            {t("browse.modpacks")}
          </TabsTrigger>
          <TabsTrigger value="mods" className="gap-2">
            <Blocks className="h-4 w-4" />
            {t("browse.mods")}
          </TabsTrigger>
        </TabsList>

        {activeTab === "modpacks" && (
          <TabsContent value="modpacks" className="mt-4 flex-1 min-h-0 flex flex-col" forceMount>
            <ModpackBrowser onInstalled={handleModpackInstalled} />
          </TabsContent>
        )}

        {activeTab === "mods" && (
          <TabsContent value="mods" className="mt-4 flex-1 min-h-0 flex flex-col" forceMount>
            <ModBrowser />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
