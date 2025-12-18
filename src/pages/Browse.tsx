import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { invoke } from "@tauri-apps/api/core"
import { Package, Blocks, Sparkles, Palette, Database, Plug, Gamepad2, Server, AlertCircle } from "lucide-react"
import { useTranslation } from "@/i18n"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { ModpackBrowser } from "@/components/browse/ModpackBrowser"
import { ModBrowser } from "@/components/browse/ModBrowser"
import { PluginBrowser } from "@/components/browse/PluginBrowser"
import { ShaderBrowser } from "@/components/browse/ShaderBrowser"
import { ResourcePackBrowser } from "@/components/browse/ResourcePackBrowser"
import { DatapackBrowser } from "@/components/browse/DatapackBrowser"

// Shared instance type
export interface BrowseInstance {
  id: string
  name: string
  mc_version: string
  loader: string | null
  loader_version: string | null
  is_server: boolean
  icon_path: string | null
}

// Content type compatibility helpers
const MOD_LOADERS = ["fabric", "forge", "neoforge", "quilt"]
const PLUGIN_LOADERS = ["paper", "spigot", "bukkit", "purpur", "folia", "velocity", "bungeecord", "waterfall"]

export function isModCompatible(instance: BrowseInstance | null): boolean {
  if (!instance) return false
  // Mods work on both clients AND modded servers (Fabric/Forge/NeoForge/Quilt servers)
  return !!instance.loader && MOD_LOADERS.includes(instance.loader.toLowerCase())
}

export function isPluginCompatible(instance: BrowseInstance | null): boolean {
  if (!instance) return false
  return instance.is_server && !!instance.loader && PLUGIN_LOADERS.includes(instance.loader.toLowerCase())
}

export function isResourcePackCompatible(instance: BrowseInstance | null): boolean {
  if (!instance) return false
  return !instance.is_server // Any client instance
}

export function isShaderCompatible(instance: BrowseInstance | null): boolean {
  if (!instance) return false
  // Shaders are client-only (need Iris/Optifine)
  return !instance.is_server && !!instance.loader && MOD_LOADERS.includes(instance.loader.toLowerCase())
}

export function isDatapackCompatible(instance: BrowseInstance | null): boolean {
  return instance !== null // Any instance
}

export function Browse() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState("modpacks")

  // Global instance state
  const [instances, setInstances] = useState<BrowseInstance[]>([])
  const [selectedInstance, setSelectedInstance] = useState<BrowseInstance | null>(null)
  const [isLoadingInstances, setIsLoadingInstances] = useState(true)
  const hasLoadedRef = useRef(false)

  // Load instances on mount (with guard to prevent duplicate calls)
  useEffect(() => {
    if (hasLoadedRef.current) return
    hasLoadedRef.current = true

    const loadInstances = async () => {
      try {
        console.log("[Browse] Loading instances...")
        const result = await invoke<BrowseInstance[]>("get_instances")
        setInstances(result)
        console.log("[Browse] Loaded", result.length, "instances")
      } catch (error) {
        console.error("[Browse] Failed to load instances:", error)
      } finally {
        setIsLoadingInstances(false)
      }
    }
    loadInstances()
  }, [])

  const handleModpackInstalled = () => {
    console.log("[Browse] Modpack installed, navigating to instances")
    navigate("/instances")
  }

  // Get compatibility status for current tab
  const getCompatibilityStatus = () => {
    if (!selectedInstance) return null

    switch (activeTab) {
      case "mods":
        if (!isModCompatible(selectedInstance)) {
          // Mods require a mod loader (Fabric, Forge, NeoForge, Quilt) - works on both clients and servers
          return { type: "warning" as const, message: t("browse.modsRequireLoader") }
        }
        break
      case "plugins":
        if (!isPluginCompatible(selectedInstance)) {
          if (!selectedInstance.is_server) {
            return { type: "warning" as const, message: t("browse.pluginsOnlyForServers") }
          }
          return { type: "warning" as const, message: t("browse.pluginsRequireServerType") }
        }
        break
      case "resourcepacks":
        if (!isResourcePackCompatible(selectedInstance)) {
          return { type: "warning" as const, message: t("browse.resourcePacksOnlyForClients") }
        }
        break
      case "shaders":
        if (!isShaderCompatible(selectedInstance)) {
          if (selectedInstance.is_server) {
            return { type: "warning" as const, message: t("browse.shadersNotForServers") }
          }
          return { type: "warning" as const, message: t("browse.shadersRequireLoader") }
        }
        break
      case "datapacks":
        // Datapacks work with any instance
        break
    }
    return null
  }

  const compatStatus = getCompatibilityStatus()
  const needsInstance = activeTab !== "modpacks"

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex-shrink-0 mb-4">
        <h1 className="text-2xl font-bold tracking-tight">{t("browse.title")}</h1>
        <p className="text-muted-foreground">
          {t("browse.discoverContent")}
        </p>
      </div>

      {/* Content tabs - only mount active tab to prevent concurrent API calls */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
        {/* Tabs + Instance Selector on same row */}
        <div className="flex items-center gap-4 flex-shrink-0">
          <TabsList className="w-fit">
            <TabsTrigger value="modpacks" className="gap-2">
              <Package className="h-4 w-4" />
              {t("browse.modpacks")}
            </TabsTrigger>
            <TabsTrigger value="mods" className="gap-2">
              <Blocks className="h-4 w-4" />
              {t("browse.mods")}
            </TabsTrigger>
            <TabsTrigger value="plugins" className="gap-2">
              <Plug className="h-4 w-4" />
              {t("browse.plugins")}
            </TabsTrigger>
            <TabsTrigger value="resourcepacks" className="gap-2">
              <Palette className="h-4 w-4" />
              {t("browse.resourcePacks")}
            </TabsTrigger>
            <TabsTrigger value="shaders" className="gap-2">
              <Sparkles className="h-4 w-4" />
              {t("browse.shaders")}
            </TabsTrigger>
            <TabsTrigger value="datapacks" className="gap-2">
              <Database className="h-4 w-4" />
              {t("browse.datapacks")}
            </TabsTrigger>
          </TabsList>

          {/* Instance Selector - inline with tabs */}
          {needsInstance && (
            <div className="flex items-center gap-2">
              {selectedInstance?.is_server ? (
                <Server className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Gamepad2 className="h-4 w-4 text-muted-foreground" />
              )}
              <Select
                value={selectedInstance?.id || ""}
                onValueChange={(value) => {
                  const instance = instances.find((i) => i.id === value)
                  setSelectedInstance(instance || null)
                }}
                disabled={isLoadingInstances}
              >
                <SelectTrigger className="w-[320px] h-9">
                  <SelectValue placeholder={t("browse.selectInstance")}>
                    {selectedInstance && (
                      <div className="flex items-center gap-2 truncate">
                        <span className="truncate max-w-[140px]">{selectedInstance.name}</span>
                        <Badge variant="outline" className="text-xs flex-shrink-0">
                          {selectedInstance.mc_version}
                        </Badge>
                        {selectedInstance.loader && (
                          <Badge variant="secondary" className="text-xs flex-shrink-0">
                            {selectedInstance.loader}
                          </Badge>
                        )}
                      </div>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {instances.length === 0 ? (
                    <div className="p-2 text-sm text-muted-foreground text-center">
                      {t("browse.noInstances")}
                    </div>
                  ) : (
                    instances.map((instance) => (
                      <SelectItem key={instance.id} value={instance.id}>
                        <div className="flex items-center gap-2">
                          {instance.is_server ? (
                            <Server className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                          ) : (
                            <Gamepad2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                          )}
                          <span className="truncate max-w-[160px]" title={instance.name}>{instance.name}</span>
                          <Badge variant="outline" className="text-xs flex-shrink-0">
                            {instance.mc_version}
                          </Badge>
                          {instance.loader && (
                            <Badge variant="secondary" className="text-xs flex-shrink-0">
                              {instance.loader}
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>

              {compatStatus && (
                <div className="flex items-center gap-1.5 text-xs text-amber-500" title={compatStatus.message}>
                  <AlertCircle className="h-4 w-4" />
                </div>
              )}
            </div>
          )}
        </div>

        {activeTab === "modpacks" && (
          <TabsContent value="modpacks" className="mt-4 flex-1 min-h-0 flex flex-col" forceMount>
            <ModpackBrowser onInstalled={handleModpackInstalled} />
          </TabsContent>
        )}

        {activeTab === "mods" && (
          <TabsContent value="mods" className="mt-4 flex-1 min-h-0 flex flex-col" forceMount>
            <ModBrowser selectedInstance={selectedInstance} />
          </TabsContent>
        )}

        {activeTab === "plugins" && (
          <TabsContent value="plugins" className="mt-4 flex-1 min-h-0 flex flex-col" forceMount>
            <PluginBrowser selectedInstance={selectedInstance} />
          </TabsContent>
        )}

        {activeTab === "resourcepacks" && (
          <TabsContent value="resourcepacks" className="mt-4 flex-1 min-h-0 flex flex-col" forceMount>
            <ResourcePackBrowser selectedInstance={selectedInstance} />
          </TabsContent>
        )}

        {activeTab === "shaders" && (
          <TabsContent value="shaders" className="mt-4 flex-1 min-h-0 flex flex-col" forceMount>
            <ShaderBrowser selectedInstance={selectedInstance} />
          </TabsContent>
        )}

        {activeTab === "datapacks" && (
          <TabsContent value="datapacks" className="mt-4 flex-1 min-h-0 flex flex-col" forceMount>
            <DatapackBrowser selectedInstance={selectedInstance} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
