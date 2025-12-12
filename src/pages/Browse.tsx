import { useNavigate } from "react-router-dom"
import { Package, Blocks } from "lucide-react"
import { useTranslation } from "@/i18n"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ModpackBrowser } from "@/components/browse/ModpackBrowser"

export function Browse() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const handleModpackInstalled = () => {
    // Navigate to instances page after installing a modpack
    navigate("/instances")
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex-shrink-0 mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("browse.title")}</h1>
        <p className="text-muted-foreground">
          {t("browse.discoverModpacks")}
        </p>
      </div>

      {/* Content tabs */}
      <Tabs defaultValue="modpacks" className="flex flex-col flex-1 min-h-0">
        <TabsList className="flex-shrink-0 w-fit">
          <TabsTrigger value="modpacks" className="gap-2">
            <Package className="h-4 w-4" />
            {t("browse.modpacks")}
          </TabsTrigger>
          <TabsTrigger value="mods" className="gap-2" disabled>
            <Blocks className="h-4 w-4" />
            {t("browse.mods")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="modpacks" className="mt-4 flex-1 min-h-0 flex flex-col">
          <ModpackBrowser onInstalled={handleModpackInstalled} />
        </TabsContent>

        <TabsContent value="mods" className="mt-4">
          <div className="text-center py-16 text-muted-foreground">
            <Blocks className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>{t("browse.modsInInstanceDetails")}</p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
