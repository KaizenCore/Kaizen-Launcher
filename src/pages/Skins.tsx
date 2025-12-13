import { useState, useEffect, useCallback, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { open, save } from "@tauri-apps/plugin-dialog"
import { writeFile } from "@tauri-apps/plugin-fs"
import {
  User,
  Search,
  Upload,
  TrendingUp,
  Clock,
  RotateCcw,
  Loader2,
  AlertCircle,
  Users,
  Image,
  Heart,
  Trash2,
  Camera,
  RotateCw,
  Play,
  Pause,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import { toast } from "sonner"
import { useTranslation } from "@/i18n"
import { useTheme } from "@/hooks/useTheme"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { SkinViewer3D, AnimationType, SkinViewer3DRef } from "@/components/skins/SkinViewer3D"
import { SkinCard, CommunitySkin } from "@/components/skins/SkinCard"
import { CapeSelector, Cape } from "@/components/skins/CapeSelector"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface Account {
  id: string
  uuid: string
  username: string
  access_token: string
  skin_url: string | null
  is_active: boolean
}

interface Skin {
  id: string
  name: string
  url: string
  variant: "classic" | "slim"
  source: "mojang" | "namemc" | "mineskin" | "local"
  author?: string
  thumbnail_url?: string
}

interface PlayerSkinProfile {
  uuid: string
  username: string
  current_skin: Skin | null
  available_capes: Cape[]
  current_cape: Cape | null
}

interface SearchSkinsResponse {
  skins: CommunitySkin[]
  total: number
  page: number
  has_more: boolean
}

interface FavoriteSkin {
  id: string
  skin_id: string
  name: string
  url: string
  thumbnail_url: string
  variant: string
  source: string
  author: string | null
  created_at: string
}

export function Skins() {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const viewerRef = useRef<SkinViewer3DRef>(null)
  const [activeAccount, setActiveAccount] = useState<Account | null>(null)
  const [profile, setProfile] = useState<PlayerSkinProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isApplying, setIsApplying] = useState(false)
  const [selectedCapeId, setSelectedCapeId] = useState<string | null>(null)

  // My Skin viewer controls
  const [mySkinAnimation, setMySkinAnimation] = useState<AnimationType>("idle")
  const [zoomLevel, setZoomLevel] = useState(0.9)

  // Browse tab state
  const [searchQuery, setSearchQuery] = useState("")
  const [browseMode, setBrowseMode] = useState<"trending" | "recent" | "search">("trending")
  const [searchType, setSearchType] = useState<"gallery" | "player">("gallery")
  const [communitySkins, setCommunitySkins] = useState<CommunitySkin[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchPage, setSearchPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)

  // Favorites state
  const [favorites, setFavorites] = useState<FavoriteSkin[]>([])
  const [favoritedIds, setFavoritedIds] = useState<Set<string>>(new Set())
  const [isLoadingFavorites, setIsLoadingFavorites] = useState(false)

  // Upload tab state
  const [uploadUrl, setUploadUrl] = useState("")
  const [uploadVariant, setUploadVariant] = useState<"classic" | "slim">("classic")
  const [isUploading, setIsUploading] = useState(false)

  // Preview dialog state
  const [previewSkin, setPreviewSkin] = useState<CommunitySkin | null>(null)
  const [previewAnimation, setPreviewAnimation] = useState<AnimationType>("idle")

  // Apply dialog state
  const [skinToApply, setSkinToApply] = useState<CommunitySkin | null>(null)
  const [applyVariant, setApplyVariant] = useState<"classic" | "slim">("classic")

  const isOfflineAccount = activeAccount?.access_token === "offline"

  // Load active account and profile
  const loadProfile = useCallback(async () => {
    console.log("[Skins] Loading skin profile...")
    setIsLoading(true)
    try {
      const account = await invoke<Account | null>("get_active_account")
      setActiveAccount(account)

      if (account) {
        console.log(`[Skins] Loading profile for account: ${account.username}`)
        try {
          const skinProfile = await invoke<PlayerSkinProfile>("get_skin_profile", {
            accountId: account.id,
          })
          console.log(`[Skins] Profile loaded, ${skinProfile.available_capes?.length || 0} capes available`)
          setProfile(skinProfile)
          setSelectedCapeId(skinProfile.current_cape?.id || null)
        } catch (profileErr) {
          // API might fail for offline accounts or expired tokens - that's ok
          console.warn("[Skins] Failed to load skin profile:", profileErr)
          setProfile({
            uuid: account.uuid,
            username: account.username,
            current_skin: null,
            available_capes: [],
            current_cape: null,
          })
        }
      }
    } catch (err) {
      console.error("[Skins] Failed to load account:", err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadProfile()
  }, [loadProfile])

  // Load favorites
  const loadFavorites = useCallback(async () => {
    console.log("[Skins] Loading favorite skins...")
    setIsLoadingFavorites(true)
    try {
      const favs = await invoke<FavoriteSkin[]>("get_favorite_skins")
      console.log(`[Skins] Loaded ${favs.length} favorite skins`)
      setFavorites(favs)
      setFavoritedIds(new Set(favs.map((f) => f.skin_id)))
    } catch (err) {
      console.error("[Skins] Failed to load favorites:", err)
    } finally {
      setIsLoadingFavorites(false)
    }
  }, [])

  useEffect(() => {
    loadFavorites()
  }, [loadFavorites])

  // Add skin to favorites
  const handleAddFavorite = async (skin: CommunitySkin) => {
    if (favoritedIds.has(skin.id)) {
      // Already favorited, remove it
      console.log(`[Skins] Removing favorite: ${skin.name}`)
      const favorite = favorites.find((f) => f.skin_id === skin.id)
      if (favorite) {
        await handleRemoveFavorite(favorite.id)
      }
      return
    }

    console.log(`[Skins] Adding to favorites: ${skin.name}`)
    try {
      await invoke("add_favorite_skin", {
        skinId: skin.id,
        name: skin.name,
        url: skin.url,
        thumbnailUrl: skin.thumbnail_url,
        variant: skin.variant,
        source: skin.source,
        author: skin.author || null,
      })
      console.log(`[Skins] Added to favorites: ${skin.name}`)
      toast.success(t("skins.addedToFavorites"))
      loadFavorites()
    } catch (err) {
      console.error("[Skins] Failed to add favorite:", err)
      toast.error(t("skins.addToFavoritesError"))
    }
  }

  // Remove skin from favorites
  const handleRemoveFavorite = async (id: string) => {
    console.log(`[Skins] Removing favorite with id: ${id}`)
    try {
      await invoke("remove_favorite_skin", { id })
      console.log(`[Skins] Favorite removed: ${id}`)
      toast.success(t("skins.removedFromFavorites"))
      loadFavorites()
    } catch (err) {
      console.error("[Skins] Failed to remove favorite:", err)
      toast.error(t("skins.removeFromFavoritesError"))
    }
  }

  // Convert FavoriteSkin to CommunitySkin for display
  const favoriteToCommunitySkin = (fav: FavoriteSkin): CommunitySkin => ({
    id: fav.skin_id,
    name: fav.name,
    url: fav.url,
    thumbnail_url: fav.thumbnail_url,
    variant: fav.variant as "classic" | "slim",
    source: fav.source as "namemc" | "mineskin" | "local" | "mojang",
    author: fav.author || undefined,
  })

  // Load community skins
  const loadCommunitySkins = useCallback(async (page = 1, append = false) => {
    console.log(`[Skins] Loading community skins (mode: ${browseMode}, page: ${page})`)
    setIsSearching(true)
    try {
      let response: SearchSkinsResponse

      if (browseMode === "search" && searchQuery.trim()) {
        // If searching by player name
        if (searchType === "player") {
          console.log(`[Skins] Searching player skin: ${searchQuery}`)
          const playerSkin = await invoke<CommunitySkin | null>("search_player_skin", {
            username: searchQuery,
          })
          response = {
            skins: playerSkin ? [playerSkin] : [],
            total: playerSkin ? 1 : 0,
            page: 1,
            has_more: false,
          }
        } else {
          // Gallery search
          console.log(`[Skins] Searching gallery: "${searchQuery}"`)
          response = await invoke<SearchSkinsResponse>("search_community_skins", {
            query: searchQuery,
            page,
          })
        }
      } else if (browseMode === "recent") {
        response = await invoke<SearchSkinsResponse>("get_recent_skins", { page })
      } else {
        response = await invoke<SearchSkinsResponse>("get_trending_skins", { page })
      }

      console.log(`[Skins] Found ${response.skins.length} skins (total: ${response.total})`)
      if (append) {
        setCommunitySkins((prev) => [...prev, ...response.skins])
      } else {
        setCommunitySkins(response.skins)
      }
      setSearchPage(page)
      setHasMore(response.has_more)
    } catch (err) {
      console.error("[Skins] Failed to load community skins:", err)
      // Don't show error toast - just show empty state
      if (!append) {
        setCommunitySkins([])
      }
      setHasMore(false)
    } finally {
      setIsSearching(false)
    }
  }, [browseMode, searchQuery, searchType])

  useEffect(() => {
    loadCommunitySkins(1, false)
  }, [browseMode]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = () => {
    if (searchQuery.trim()) {
      setBrowseMode("search")
      loadCommunitySkins(1, false)
    }
  }

  const handleLoadMore = () => {
    loadCommunitySkins(searchPage + 1, true)
  }

  // Apply skin
  const handleApplySkin = async () => {
    if (!skinToApply || !activeAccount) return

    console.log(`[Skins] Applying skin: ${skinToApply.name} (variant: ${applyVariant})`)
    setIsApplying(true)
    try {
      await invoke("apply_skin", {
        accountId: activeAccount.id,
        skinUrl: skinToApply.url,
        variant: applyVariant,
      })
      console.log(`[Skins] Skin applied successfully: ${skinToApply.name}`)
      toast.success(t("skins.skinApplied"))
      setSkinToApply(null)
      loadProfile()
    } catch (err) {
      console.error("[Skins] Failed to apply skin:", err)
      toast.error(t("skins.skinApplyError"))
    } finally {
      setIsApplying(false)
    }
  }

  // Reset skin
  const handleResetSkin = async () => {
    if (!activeAccount) return

    console.log(`[Skins] Resetting skin for account: ${activeAccount.username}`)
    setIsApplying(true)
    try {
      await invoke("reset_skin", { accountId: activeAccount.id })
      console.log("[Skins] Skin reset successfully")
      toast.success(t("skins.skinReset"))
      loadProfile()
    } catch (err) {
      console.error("[Skins] Failed to reset skin:", err)
      toast.error(t("skins.skinApplyError"))
    } finally {
      setIsApplying(false)
    }
  }

  // Set cape
  const handleSetCape = async (cape: Cape | null) => {
    if (!activeAccount || isOfflineAccount) return

    console.log(`[Skins] Setting cape: ${cape?.name || "none"}`)
    setSelectedCapeId(cape?.id || null)
    try {
      await invoke("set_active_cape", {
        accountId: activeAccount.id,
        capeId: cape?.id || null,
      })
      console.log(`[Skins] Cape ${cape ? "set" : "hidden"} successfully`)
      toast.success(cape ? t("skins.capeSet") : t("skins.capeHidden"))
    } catch (err) {
      console.error("[Skins] Failed to set cape:", err)
      toast.error(t("skins.capeError"))
      // Revert UI
      setSelectedCapeId(profile?.current_cape?.id || null)
    }
  }

  // Upload from file
  const handleUploadFile = async () => {
    console.log("[Skins] Opening file picker for skin upload...")
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "PNG Images", extensions: ["png"] }],
      })

      if (selected && activeAccount) {
        console.log(`[Skins] Uploading skin from file: ${selected}`)
        setIsUploading(true)
        await invoke("apply_skin_from_file", {
          accountId: activeAccount.id,
          filePath: selected,
          variant: uploadVariant,
        })
        console.log("[Skins] Skin uploaded successfully from file")
        toast.success(t("skins.uploadSuccess"))
        loadProfile()
      }
    } catch (err) {
      console.error("[Skins] Failed to upload skin:", err)
      toast.error(t("skins.uploadError"))
    } finally {
      setIsUploading(false)
    }
  }

  // Upload from URL
  const handleUploadUrl = async () => {
    if (!uploadUrl.trim() || !activeAccount) return

    console.log(`[Skins] Uploading skin from URL: ${uploadUrl}`)
    setIsUploading(true)
    try {
      await invoke("apply_skin", {
        accountId: activeAccount.id,
        skinUrl: uploadUrl,
        variant: uploadVariant,
      })
      console.log("[Skins] Skin uploaded successfully from URL")
      toast.success(t("skins.uploadSuccess"))
      setUploadUrl("")
      loadProfile()
    } catch (err) {
      console.error("[Skins] Failed to upload skin from URL:", err)
      toast.error(t("skins.uploadError"))
    } finally {
      setIsUploading(false)
    }
  }

  // Screenshot handler
  const handleScreenshot = async () => {
    if (!viewerRef.current) return

    console.log("[Skins] Taking screenshot...")
    const dataUrl = viewerRef.current.takeScreenshot()
    if (!dataUrl) {
      toast.error(t("skins.screenshotError"))
      return
    }

    try {
      const filePath = await save({
        defaultPath: `${profile?.username || "skin"}_screenshot.png`,
        filters: [{ name: "PNG Image", extensions: ["png"] }],
      })

      if (filePath) {
        console.log(`[Skins] Saving screenshot to: ${filePath}`)
        // Convert data URL to binary
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "")
        const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))
        await writeFile(filePath, binaryData)
        console.log("[Skins] Screenshot saved")
        toast.success(t("skins.screenshotSaved"))
      }
    } catch (err) {
      console.error("[Skins] Failed to save screenshot:", err)
      toast.error(t("skins.screenshotError"))
    }
  }

  // Camera controls
  const handleResetCamera = () => {
    viewerRef.current?.resetCamera()
    setZoomLevel(0.9)
  }

  const handleZoom = (delta: number) => {
    const newZoom = Math.max(0.5, Math.min(2, zoomLevel + delta))
    setZoomLevel(newZoom)
    viewerRef.current?.setZoom(newZoom)
  }

  // Get current skin URL for viewer
  const currentSkinUrl = profile?.current_skin?.url ||
    `https://mc-heads.net/skin/${activeAccount?.username || "Steve"}`

  const currentCapeUrl = profile?.available_capes?.find(c => c.id === selectedCapeId)?.url

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!activeAccount) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="rounded-full bg-muted p-4">
          <User className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="font-semibold">{t("skins.noAccount")}</h3>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          {t("skins.addAccountFirst")}
        </p>
      </div>
    )
  }

  return (
    <>
    <Tabs defaultValue="my-skin" className="flex flex-col gap-4">
      {/* Header with Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("skins.title")}</h1>
        <TabsList className="grid w-full grid-cols-4 sm:flex sm:w-auto h-9">
          <TabsTrigger value="my-skin" className="text-xs sm:text-sm px-3">{t("skins.mySkin")}</TabsTrigger>
          <TabsTrigger value="favorites" className="gap-1.5 text-xs sm:text-sm px-3">
            <Heart className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("skins.favorites")}</span>
          </TabsTrigger>
          <TabsTrigger value="browse" className="text-xs sm:text-sm px-3">{t("skins.browse")}</TabsTrigger>
          <TabsTrigger value="upload" disabled={isOfflineAccount} className="text-xs sm:text-sm px-3">
            {t("skins.upload")}
          </TabsTrigger>
        </TabsList>
      </div>

      {/* Offline Warning */}
      {isOfflineAccount && (
        <Card className="border-yellow-500/50 bg-yellow-500/10">
          <CardContent className="flex items-center gap-3 py-2">
            <AlertCircle className="h-4 w-4 text-yellow-500" />
            <p className="text-xs">{t("skins.offlineNotSupported")}</p>
          </CardContent>
        </Card>
      )}

      {/* My Skin Tab */}
      <TabsContent value="my-skin" className="mt-0 h-[calc(100vh-180px)] min-h-[500px]">
          <div className="grid gap-6 lg:grid-cols-[1fr,280px] h-full">
            {/* 3D Viewer - Full space */}
            <Card className="overflow-hidden h-full">
              <div className="relative h-full flex flex-col">
                <CardContent className="flex-1 p-0 relative">
                  <SkinViewer3D
                    ref={viewerRef}
                    skinUrl={currentSkinUrl}
                    capeUrl={currentCapeUrl}
                    animation={mySkinAnimation}
                    slim={profile?.current_skin?.variant === "slim"}
                    fillContainer
                    background={resolvedTheme === "dark" ? "#1a1a2e" : "#e8e8f0"}
                  />
                </CardContent>

                {/* Viewer Controls Overlay */}
                <TooltipProvider delayDuration={300}>
                  <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
                    {/* Animation controls */}
                    <div className="flex items-center gap-1 bg-background/90 backdrop-blur-sm rounded-lg p-1 shadow-lg">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant={mySkinAnimation === "none" ? "default" : "ghost"}
                            className="h-8 w-8"
                            onClick={() => setMySkinAnimation("none")}
                          >
                            <Pause className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p>{t("skins.poseNone")}</p>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant={mySkinAnimation === "idle" ? "default" : "ghost"}
                            className="h-8 w-8"
                            onClick={() => setMySkinAnimation("idle")}
                          >
                            <User className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p>{t("skins.poseIdle")}</p>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant={mySkinAnimation === "walk" ? "default" : "ghost"}
                            className="h-8 w-8"
                            onClick={() => setMySkinAnimation("walk")}
                          >
                            <Play className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p>{t("skins.poseWalk")}</p>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant={mySkinAnimation === "run" ? "default" : "ghost"}
                            className="h-8 w-8"
                            onClick={() => setMySkinAnimation("run")}
                          >
                            <Play className="h-4 w-4 fill-current" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p>{t("skins.poseRun")}</p>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant={mySkinAnimation === "wave" ? "default" : "ghost"}
                            className="h-8 w-8"
                            onClick={() => setMySkinAnimation("wave")}
                          >
                            👋
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p>{t("skins.poseWave")}</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>

                    {/* Camera & Screenshot controls */}
                    <div className="flex items-center gap-1 bg-background/90 backdrop-blur-sm rounded-lg p-1 shadow-lg">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => handleZoom(-0.1)}
                          >
                            <ZoomOut className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p>{t("skins.zoomOut")}</p>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => handleZoom(0.1)}
                          >
                            <ZoomIn className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p>{t("skins.zoomIn")}</p>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={handleResetCamera}
                          >
                            <RotateCw className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p>{t("skins.resetCamera")}</p>
                        </TooltipContent>
                      </Tooltip>
                      <div className="w-px h-6 bg-border mx-1" />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={handleScreenshot}
                          >
                            <Camera className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p>{t("skins.screenshot")}</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </TooltipProvider>
              </div>
            </Card>

            {/* Profile Info & Controls - Sidebar */}
            <div className="space-y-4 overflow-auto">
              {/* Profile Card */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{t("skins.profile")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Username</span>
                    <span className="font-medium">{profile?.username}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{t("skins.skinVariant")}</span>
                    <span className="font-medium">
                      {profile?.current_skin?.variant === "slim"
                        ? t("skins.slim")
                        : t("skins.classic")}
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* Actions */}
              {!isOfflineAccount && (
                <Card>
                  <CardContent className="pt-4">
                    <Button
                      variant="outline"
                      onClick={handleResetSkin}
                      disabled={isApplying}
                      className="w-full"
                    >
                      <RotateCcw className="h-4 w-4 mr-2" />
                      {t("skins.resetSkin")}
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* Capes */}
              {!isOfflineAccount && (
                <Card>
                  <CardContent className="pt-4">
                    <CapeSelector
                      capes={profile?.available_capes || []}
                      selectedCapeId={selectedCapeId}
                      onSelect={handleSetCape}
                      disabled={isOfflineAccount}
                    />
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Favorites Tab */}
        <TabsContent value="favorites" className="mt-6">
          <div className="space-y-4">
            {isLoadingFavorites ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : favorites.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Heart className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="font-semibold text-lg">{t("skins.noFavorites")}</h3>
                  <p className="text-muted-foreground text-sm text-center max-w-md mt-2">
                    {t("skins.noFavoritesDescription")}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 3xl:grid-cols-10 4xl:grid-cols-12 gap-4">
                {favorites.map((fav) => {
                  const skin = favoriteToCommunitySkin(fav)
                  return (
                    <div key={fav.id} className="relative group">
                      <SkinCard
                        skin={skin}
                        onPreview={setPreviewSkin}
                        onApply={(s) => {
                          setSkinToApply(s)
                          setApplyVariant(s.variant)
                        }}
                        onFavorite={() => handleRemoveFavorite(fav.id)}
                        isFavorited={true}
                        showApplyButton={!isOfflineAccount}
                      />
                      <Button
                        size="icon"
                        variant="destructive"
                        className="absolute top-2 left-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handleRemoveFavorite(fav.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Browse Tab */}
        <TabsContent value="browse" className="mt-4">
          <div className="space-y-4">
            {/* Unified Toolbar */}
            <div className="flex flex-wrap items-center gap-3 p-3 bg-card border rounded-lg">
              {/* Search Type Toggle */}
              <div className="flex p-0.5 bg-muted rounded-md">
                <Button
                  size="sm"
                  variant={searchType === "gallery" ? "default" : "ghost"}
                  onClick={() => setSearchType("gallery")}
                  className="h-8 gap-1.5 px-3"
                >
                  <Image className="h-3.5 w-3.5" />
                  {t("skins.gallery")}
                </Button>
                <Button
                  size="sm"
                  variant={searchType === "player" ? "default" : "ghost"}
                  onClick={() => setSearchType("player")}
                  className="h-8 gap-1.5 px-3"
                >
                  <Users className="h-3.5 w-3.5" />
                  {t("skins.searchPlayer")}
                </Button>
              </div>

              {/* Separator */}
              <div className="w-px h-6 bg-border hidden sm:block" />

              {/* Search Input */}
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder={searchType === "player" ? t("skins.searchPlayerPlaceholder") : t("skins.search")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="h-8 pl-8 text-sm"
                />
              </div>

              <Button size="sm" className="h-8" onClick={handleSearch} disabled={isSearching}>
                {isSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("common.search")}
              </Button>

              {/* Separator */}
              {searchType === "gallery" && <div className="w-px h-6 bg-border hidden md:block" />}

              {/* Trending/Recent Toggle - only for gallery mode */}
              {searchType === "gallery" && (
                <div className="flex p-0.5 bg-muted rounded-md">
                  <Button
                    size="sm"
                    variant={browseMode === "trending" ? "default" : "ghost"}
                    onClick={() => setBrowseMode("trending")}
                    className="h-8 gap-1.5 px-3"
                  >
                    <TrendingUp className="h-3.5 w-3.5" />
                    {t("skins.trending")}
                  </Button>
                  <Button
                    size="sm"
                    variant={browseMode === "recent" ? "default" : "ghost"}
                    onClick={() => setBrowseMode("recent")}
                    className="h-8 gap-1.5 px-3"
                  >
                    <Clock className="h-3.5 w-3.5" />
                    {t("skins.recent")}
                  </Button>
                </div>
              )}
            </div>

            {/* Skins Grid */}
            {isSearching && communitySkins.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : communitySkins.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <p className="text-muted-foreground">{t("skins.noResults")}</p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 3xl:grid-cols-10 4xl:grid-cols-12 gap-4">
                  {communitySkins.map((skin) => (
                    <SkinCard
                      key={skin.id}
                      skin={skin}
                      onPreview={setPreviewSkin}
                      onApply={(s) => {
                        setSkinToApply(s)
                        setApplyVariant(s.variant)
                      }}
                      onFavorite={handleAddFavorite}
                      isFavorited={favoritedIds.has(skin.id)}
                      showApplyButton={!isOfflineAccount}
                    />
                  ))}
                </div>

                {hasMore && (
                  <div className="flex justify-center pt-4">
                    <Button
                      variant="outline"
                      onClick={handleLoadMore}
                      disabled={isSearching}
                    >
                      {isSearching ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : null}
                      {t("skins.loadMore")}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </TabsContent>

        {/* Upload Tab */}
        <TabsContent value="upload" className="mt-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Upload from File */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Upload className="h-5 w-5" />
                  {t("skins.uploadFromFile")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {t("skins.uploadDescription")}
                </p>

                <div className="space-y-2">
                  <Label>{t("skins.skinVariant")}</Label>
                  <RadioGroup
                    value={uploadVariant}
                    onValueChange={(v: string) => setUploadVariant(v as "classic" | "slim")}
                    className="flex gap-4"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="classic" id="classic" />
                      <Label htmlFor="classic">{t("skins.classic")}</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="slim" id="slim" />
                      <Label htmlFor="slim">{t("skins.slim")}</Label>
                    </div>
                  </RadioGroup>
                </div>

                <Button
                  onClick={handleUploadFile}
                  disabled={isUploading}
                  className="w-full"
                >
                  {isUploading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  {t("skins.selectFile")}
                </Button>
              </CardContent>
            </Card>

            {/* Upload from URL */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t("skins.uploadFromUrl")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder={t("skins.urlPlaceholder")}
                  value={uploadUrl}
                  onChange={(e) => setUploadUrl(e.target.value)}
                />

                <div className="space-y-2">
                  <Label>{t("skins.skinVariant")}</Label>
                  <RadioGroup
                    value={uploadVariant}
                    onValueChange={(v: string) => setUploadVariant(v as "classic" | "slim")}
                    className="flex gap-4"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="classic" id="classic-url" />
                      <Label htmlFor="classic-url">{t("skins.classic")}</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="slim" id="slim-url" />
                      <Label htmlFor="slim-url">{t("skins.slim")}</Label>
                    </div>
                  </RadioGroup>
                </div>

                <Button
                  onClick={handleUploadUrl}
                  disabled={isUploading || !uploadUrl.trim()}
                  className="w-full"
                >
                  {isUploading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  {t("skins.applySkin")}
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Preview Dialog */}
      <Dialog open={!!previewSkin} onOpenChange={() => setPreviewSkin(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{previewSkin?.name}</DialogTitle>
            {previewSkin?.author && (
              <DialogDescription>
                {t("skins.skinBy", { author: previewSkin.author })}
              </DialogDescription>
            )}
          </DialogHeader>

          <div className="flex flex-col items-center gap-4 py-4">
            {previewSkin && (
              <SkinViewer3D
                skinUrl={previewSkin.url}
                width={200}
                height={300}
                animation={previewAnimation}
                slim={previewSkin.variant === "slim"}
              />
            )}

            <Select
              value={previewAnimation}
              onValueChange={(v) => setPreviewAnimation(v as AnimationType)}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="idle">Idle</SelectItem>
                <SelectItem value="walk">Walk</SelectItem>
                <SelectItem value="run">Run</SelectItem>
                <SelectItem value="wave">Wave</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            {!isOfflineAccount && (
              <Button
                onClick={() => {
                  if (previewSkin) {
                    setSkinToApply(previewSkin)
                    setApplyVariant(previewSkin.variant)
                    setPreviewSkin(null)
                  }
                }}
              >
                {t("skins.applySkin")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Apply Confirmation Dialog */}
      <Dialog open={!!skinToApply} onOpenChange={() => setSkinToApply(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("skins.applySkin")}</DialogTitle>
            <DialogDescription>
              {t("skins.applyConfirm")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <Label>{t("skins.skinVariant")}</Label>
            <RadioGroup
              value={applyVariant}
              onValueChange={(v: string) => setApplyVariant(v as "classic" | "slim")}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="classic" id="apply-classic" />
                <Label htmlFor="apply-classic">{t("skins.classic")}</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="slim" id="apply-slim" />
                <Label htmlFor="apply-slim">{t("skins.slim")}</Label>
              </div>
            </RadioGroup>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSkinToApply(null)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleApplySkin} disabled={isApplying}>
              {isApplying ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {t("skins.applySkin")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
