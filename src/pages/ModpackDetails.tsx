import { useState, useEffect, useCallback } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import {
  ArrowLeft,
  Download,
  Loader2,
  Package,
  Calendar,
  ExternalLink,
  Globe,
  MessageCircle,
  Github,
  Heart,
  Check,
  ChevronDown,
  Image as ImageIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { useTranslation } from "@/i18n"
import { useInstallationStore } from "@/stores/installationStore"

interface Project {
  id: string
  slug: string
  project_type: string
  title: string
  description: string
  body: string
  categories: string[]
  client_side: string
  server_side: string
  downloads: number
  followers: number
  icon_url: string | null
  issues_url: string | null
  source_url: string | null
  wiki_url: string | null
  discord_url: string | null
  gallery: GalleryImage[]
  versions: string[]
  game_versions: string[]
  loaders: string[]
  team: string
  published: string
  updated: string
  license: License | null
}

interface GalleryImage {
  url: string
  featured: boolean
  title: string | null
  description: string | null
  created: string
  ordering: number
}

interface License {
  id: string
  name: string
  url: string | null
}

interface ModpackVersion {
  id: string
  name: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  version_type: string
  downloads: number
  date_published: string
}

interface ModpackInstallResult {
  instance_id: string
  name: string
  mc_version: string
  loader: string | null
  loader_version: string | null
  files_count: number
}

export function ModpackDetails() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()

  // Global installation store
  const { startInstallation, isInstalling: checkIsInstalling } = useInstallationStore()

  const [project, setProject] = useState<Project | null>(null)
  const [versions, setVersions] = useState<ModpackVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState<string>("")
  const [isInstalled, setIsInstalled] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [selectedImage, setSelectedImage] = useState<string | null>(null)

  // Check if this modpack is currently installing
  const isInstalling = projectId ? checkIsInstalling(`modpack_${projectId}`) : false

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr)
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  const loadProject = useCallback(async () => {
    if (!projectId) return

    setLoading(true)
    try {
      const [projectData, installedIds] = await Promise.all([
        invoke<Project>("get_modrinth_mod_details", { projectId }),
        invoke<string[]>("get_installed_modpack_ids"),
      ])
      setProject(projectData)
      setIsInstalled(installedIds.includes(projectId))
    } catch (err) {
      console.error("Failed to load project:", err)
      toast.error(t("browse.modpackLoadError"))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const loadVersions = useCallback(async () => {
    if (!projectId) return

    setLoadingVersions(true)
    try {
      const versionsData = await invoke<ModpackVersion[]>("get_modrinth_mod_versions", {
        projectId,
        gameVersion: null,
        loader: null,
      })
      setVersions(versionsData)
      if (versionsData.length > 0) {
        setSelectedVersion(versionsData[0].id)
      }
    } catch (err) {
      console.error("Failed to load versions:", err)
    } finally {
      setLoadingVersions(false)
    }
  }, [projectId])

  useEffect(() => {
    loadProject()
    loadVersions()
  }, [loadProject, loadVersions])

  const handleInstall = async () => {
    if (!projectId || !selectedVersion || !project) return

    // Start tracking in global store with modpack prefix
    const trackingId = `modpack_${projectId}`
    startInstallation(trackingId, project.title, "modpack")

    try {
      // Step 1: Install modpack files
      const result = await invoke<ModpackInstallResult>("install_modrinth_modpack", {
        projectId,
        versionId: selectedVersion,
        instanceName: null,
      })

      // Migrate tracking from temporary ID to real instance ID
      const store = useInstallationStore.getState()
      store.migrateInstallation(trackingId, result.instance_id)
      store.setStep(result.instance_id, "minecraft")

      // Step 2: Install Minecraft with the loader
      await invoke("install_instance", {
        instanceId: result.instance_id,
      })

      // Update installed status
      setIsInstalled(true)
    } catch (err) {
      console.error("Failed to install modpack:", err)
      toast.error(`Error: ${err}`)
      // Cancel the installation tracking on error
      useInstallationStore.getState().cancelInstallation(trackingId)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <Package className="h-16 w-16 text-muted-foreground" />
        <p className="text-muted-foreground">Modpack not found</p>
        <Button variant="outline" onClick={() => navigate("/browse")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Browse
        </Button>
      </div>
    )
  }

  const selectedVersionData = versions.find(v => v.id === selectedVersion)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 mb-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/browse")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold">{t("modpack.details")}</h1>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-6 pr-4 pb-4">
          {/* Main info card */}
          <Card>
            <CardContent className="p-6">
              <div className="flex gap-6">
                {/* Icon */}
                <div className="flex-shrink-0">
                  {project.icon_url ? (
                    <img
                      src={project.icon_url}
                      alt={project.title}
                      className="w-24 h-24 rounded-xl object-cover"
                    />
                  ) : (
                    <div className="w-24 h-24 rounded-xl bg-muted flex items-center justify-center">
                      <Package className="h-12 w-12 text-muted-foreground" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-bold">{project.title}</h2>
                      <p className="text-muted-foreground mt-1">{project.description}</p>
                    </div>
                    {isInstalled && (
                      <Badge className="bg-green-500/10 text-green-600 border-green-500/20 flex-shrink-0">
                        <Check className="h-3 w-3 mr-1" />
                        {t("modpack.installed")}
                      </Badge>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-6 mt-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Download className="h-4 w-4" />
                      <span>{formatNumber(project.downloads)} downloads</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Heart className="h-4 w-4" />
                      <span>{formatNumber(project.followers)} followers</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      <span>Updated {formatDate(project.updated)}</span>
                    </div>
                  </div>

                  {/* Categories & Loaders */}
                  <div className="flex flex-wrap gap-2 mt-4">
                    {project.loaders.map(loader => (
                      <Badge key={loader} variant="secondary">
                        {loader}
                      </Badge>
                    ))}
                    {project.categories.slice(0, 5).map(cat => (
                      <Badge key={cat} variant="outline">
                        {cat}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Install section */}
          <Card>
            <CardContent className="p-6">
              <h3 className="font-semibold mb-4">{t("modpack.installModpack")}</h3>
              <div className="flex items-end gap-4">
                <div className="flex-1">
                  <label className="text-sm text-muted-foreground mb-2 block">
                    {t("modpack.selectVersion")}
                  </label>
                  {loadingVersions ? (
                    <div className="h-10 flex items-center">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  ) : (
                    <Select value={selectedVersion} onValueChange={setSelectedVersion}>
                      <SelectTrigger>
                        <SelectValue placeholder={t("modpack.selectVersion")} />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px]">
                        {versions.map(v => (
                          <SelectItem key={v.id} value={v.id}>
                            <div className="flex flex-col">
                              <span>{v.name || v.version_number}</span>
                              <span className="text-xs text-muted-foreground">
                                MC {v.game_versions.slice(0, 3).join(", ")} - {v.loaders.join(", ")}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <Button
                  onClick={handleInstall}
                  disabled={!selectedVersion || isInstalling}
                  className="gap-2"
                >
                  <Download className="h-4 w-4" />
                  {t("common.install")}
                </Button>
              </div>
              {selectedVersionData && (
                <p className="text-xs text-muted-foreground mt-2">
                  {t("modpack.versionInfo", {
                    type: selectedVersionData.version_type,
                    date: formatDate(selectedVersionData.date_published),
                  })}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Gallery */}
          {project.gallery.length > 0 && (
            <Card>
              <CardContent className="p-6">
                <Collapsible open={galleryOpen} onOpenChange={setGalleryOpen}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="w-full justify-between p-0 h-auto">
                      <div className="flex items-center gap-2">
                        <ImageIcon className="h-4 w-4" />
                        <span className="font-semibold">{t("modpack.gallery")} ({project.gallery.length})</span>
                      </div>
                      <ChevronDown className={`h-4 w-4 transition-transform ${galleryOpen ? "rotate-180" : ""}`} />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 3xl:grid-cols-6 4xl:grid-cols-8 gap-4 mt-4">
                      {project.gallery.map((img, i) => (
                        <img
                          key={i}
                          src={img.url}
                          alt={img.title || `Screenshot ${i + 1}`}
                          className="rounded-lg object-cover aspect-video cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => setSelectedImage(img.url)}
                        />
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </CardContent>
            </Card>
          )}

          {/* Links */}
          <Card>
            <CardContent className="p-6">
              <h3 className="font-semibold mb-4">{t("modpack.links")}</h3>
              <div className="flex flex-wrap gap-2">
                {project.wiki_url && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={project.wiki_url} target="_blank" rel="noopener noreferrer">
                      <Globe className="h-4 w-4 mr-2" />
                      Wiki
                    </a>
                  </Button>
                )}
                {project.discord_url && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={project.discord_url} target="_blank" rel="noopener noreferrer">
                      <MessageCircle className="h-4 w-4 mr-2" />
                      Discord
                    </a>
                  </Button>
                )}
                {project.source_url && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={project.source_url} target="_blank" rel="noopener noreferrer">
                      <Github className="h-4 w-4 mr-2" />
                      Source
                    </a>
                  </Button>
                )}
                {project.issues_url && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={project.issues_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Issues
                    </a>
                  </Button>
                )}
                <Button variant="outline" size="sm" asChild>
                  <a href={`https://modrinth.com/modpack/${project.slug}`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Modrinth
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Description */}
          <Card>
            <CardContent className="p-6">
              <h3 className="font-semibold mb-4">{t("modpack.description")}</h3>
              <Separator className="mb-4" />
              <div
                className="prose prose-sm dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: project.body }}
              />
            </CardContent>
          </Card>

          {/* License */}
          {project.license && (
            <Card>
              <CardContent className="p-6">
                <h3 className="font-semibold mb-2">{t("modpack.license")}</h3>
                <p className="text-sm text-muted-foreground">
                  {project.license.name}
                  {project.license.url && (
                    <a
                      href={project.license.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3 inline" />
                    </a>
                  )}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </ScrollArea>

      {/* Image preview dialog */}
      <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
        <DialogContent className="max-w-4xl">
          {selectedImage && (
            <img
              src={selectedImage}
              alt="Gallery preview"
              className="w-full rounded-lg"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
