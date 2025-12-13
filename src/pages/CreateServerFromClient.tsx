import { useState, useEffect, useCallback, useMemo, memo } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import {
  ArrowLeft,
  Server,
  Loader2,
  Check,
  X,
  HelpCircle,
  AlertTriangle,
  Search,
  Package,
  Settings,
  RefreshCw,
  Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { useTranslation } from "@/i18n"

interface ModServerCompatibility {
  filename: string
  name: string
  has_metadata: boolean
  project_id: string | null
  server_side: string
  client_side: string
  include_by_default: boolean
  icon_url: string | null
}

interface ModAnalysisResult {
  server_compatible: ModServerCompatibility[]
  client_only: ModServerCompatibility[]
  unknown: ModServerCompatibility[]
  total_mods: number
}

interface EnrichmentResult {
  total_mods: number
  enriched_count: number
  already_had_metadata: number
  not_found_on_modrinth: number
  errors: string[]
}

interface DetectedIssue {
  issue_type: string
  mod_id: string | null
  mod_name: string | null
  required_mod_id: string | null
  required_mod_name: string | null
  required_version: string | null
  found_version: string | null
  message: string
}

type ProcessingStep = "idle" | "enriching" | "analyzing" | "ready" | "creating" | "checking_deps"

interface CreateServerFromClientOptions {
  source_instance_id: string
  server_name: string
  mods_to_include: string[]
  copy_configs: boolean
  server_port: number
}

interface Instance {
  id: string
  name: string
  icon_path: string | null
  mc_version: string
  loader: string | null
  loader_version: string | null
  is_server: boolean
  is_proxy: boolean
}

// Memoized ModCard component - defined outside to prevent recreation
const ModCard = memo(function ModCard({
  mod,
  showCheckbox = false,
  checked = false,
  onToggle,
  dimmed = false,
  badgeText,
  badgeVariant,
}: {
  mod: ModServerCompatibility
  showCheckbox?: boolean
  checked?: boolean
  onToggle?: () => void
  dimmed?: boolean
  badgeText: string
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
}) {
  return (
    <div
      className={`flex items-center gap-2 p-2 rounded-md border bg-card hover:bg-accent/50 transition-colors ${dimmed ? "opacity-50" : ""}`}
      onClick={showCheckbox && onToggle ? onToggle : undefined}
      style={{ cursor: showCheckbox ? "pointer" : "default" }}
    >
      {showCheckbox && (
        <Checkbox
          checked={checked}
          onCheckedChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          className="flex-shrink-0"
        />
      )}
      {mod.icon_url ? (
        <img src={mod.icon_url} alt="" className="w-8 h-8 rounded flex-shrink-0" />
      ) : (
        <div className="w-8 h-8 rounded bg-muted flex items-center justify-center text-xs font-bold flex-shrink-0">
          {mod.name.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{mod.name}</p>
      </div>
      <Badge
        variant={badgeVariant}
        className={`text-xs flex-shrink-0 ${badgeVariant === "default" ? "bg-green-600" : ""}`}
      >
        {badgeText}
      </Badge>
    </div>
  )
})

export function CreateServerFromClient() {
  const { t } = useTranslation()
  const { instanceId } = useParams<{ instanceId: string }>()
  const navigate = useNavigate()

  const [instance, setInstance] = useState<Instance | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [analysis, setAnalysis] = useState<ModAnalysisResult | null>(null)

  // Processing step state
  const [processingStep, setProcessingStep] = useState<ProcessingStep>("idle")
  const [progressPercent, setProgressPercent] = useState(0)

  // Derived states
  const isAnalyzing = processingStep === "analyzing"
  const isEnriching = processingStep === "enriching"
  const isCreating = processingStep === "creating" || processingStep === "checking_deps"

  const [serverName, setServerName] = useState("")
  const [serverPort, setServerPort] = useState(25565)
  const [copyConfigs, setCopyConfigs] = useState(true)
  const [selectedUnknownMods, setSelectedUnknownMods] = useState<Set<string>>(new Set())
  const [excludedOptionalMods, setExcludedOptionalMods] = useState<Set<string>>(new Set())

  // Search filters
  const [searchIncluded, setSearchIncluded] = useState("")
  const [searchUnknown, setSearchUnknown] = useState("")
  const [searchExcluded, setSearchExcluded] = useState("")

  // Badge text mappings - memoized
  const badgeTexts = useMemo(() => ({
    required: t("serverFromClient.required"),
    optional: t("serverFromClient.optional"),
    unsupported: t("serverFromClient.clientOnly"),
    unknown: t("serverFromClient.unknown"),
  }), [t])

  const getBadgeInfo = useCallback((serverSide: string): { text: string; variant: "default" | "secondary" | "destructive" | "outline" } => {
    switch (serverSide) {
      case "required":
        return { text: badgeTexts.required, variant: "default" }
      case "optional":
        return { text: badgeTexts.optional, variant: "secondary" }
      case "unsupported":
        return { text: badgeTexts.unsupported, variant: "destructive" }
      default:
        return { text: badgeTexts.unknown, variant: "outline" }
    }
  }, [badgeTexts])

  // Load instance and enrich/analyze mods
  useEffect(() => {
    let mounted = true

    async function loadEnrichAndAnalyze() {
      if (!instanceId) return

      console.log(`[CreateServerFromClient] Loading instance: ${instanceId}`)
      setIsLoading(true)
      try {
        // Load instance
        const inst = await invoke<Instance | null>("get_instance", { instanceId })
        if (!mounted) return

        if (!inst) {
          toast.error(t("serverFromClient.instanceNotFound"))
          navigate("/instances")
          return
        }
        if (inst.is_server || inst.is_proxy) {
          toast.error(t("serverFromClient.notClientInstance"))
          navigate(`/instances/${instanceId}`)
          return
        }

        console.log(`[CreateServerFromClient] Instance loaded: ${inst.name}`)
        setInstance(inst)
        setServerName(`${inst.name} Server`)
        setIsLoading(false)

        // Step 1: Enrich mods without metadata
        console.log("[CreateServerFromClient] Enriching mods metadata...")
        setProcessingStep("enriching")
        setProgressPercent(10)

        const enrichResult = await invoke<EnrichmentResult>("enrich_instance_mods", {
          instanceId: inst.id
        })
        if (!mounted) return

        console.log(`[CreateServerFromClient] Enriched ${enrichResult.enriched_count} mods`)
        setProgressPercent(50)

        if (enrichResult.enriched_count > 0) {
          toast.success(t("serverFromClient.enrichedMods", { count: enrichResult.enriched_count }))
        }

        // Step 2: Analyze mods for server compatibility
        console.log("[CreateServerFromClient] Analyzing mods for server compatibility...")
        setProcessingStep("analyzing")
        setProgressPercent(70)

        const result = await invoke<ModAnalysisResult>("analyze_mods_for_server", {
          instanceId: inst.id
        })
        if (!mounted) return

        console.log(`[CreateServerFromClient] Analysis complete: ${result.server_compatible.length} compatible, ${result.client_only.length} client-only, ${result.unknown.length} unknown`)
        setAnalysis(result)
        setProgressPercent(100)
        setProcessingStep("ready")
      } catch (error) {
        if (!mounted) return
        console.error("[CreateServerFromClient] Failed to load/analyze:", error)
        toast.error(String(error))
        setProcessingStep("idle")
      }
    }
    loadEnrichAndAnalyze()

    return () => { mounted = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId])

  // Re-run enrichment manually
  const handleReEnrich = useCallback(async () => {
    if (!instance) return

    console.log(`[CreateServerFromClient] Re-enriching mods for: ${instance.name}`)
    setProcessingStep("enriching")
    setProgressPercent(10)

    try {
      const enrichResult = await invoke<EnrichmentResult>("enrich_instance_mods", {
        instanceId: instance.id
      })

      console.log(`[CreateServerFromClient] Re-enriched ${enrichResult.enriched_count} mods`)
      setProgressPercent(50)

      if (enrichResult.enriched_count > 0) {
        toast.success(t("serverFromClient.enrichedMods", { count: enrichResult.enriched_count }))
      } else {
        toast.info(t("serverFromClient.noModsEnriched"))
      }

      // Re-analyze
      console.log("[CreateServerFromClient] Re-analyzing mods...")
      setProcessingStep("analyzing")
      setProgressPercent(70)

      const result = await invoke<ModAnalysisResult>("analyze_mods_for_server", {
        instanceId: instance.id
      })

      console.log(`[CreateServerFromClient] Re-analysis complete: ${result.server_compatible.length} compatible`)
      setAnalysis(result)
      setProgressPercent(100)
      setProcessingStep("ready")
    } catch (error) {
      console.error("[CreateServerFromClient] Failed to re-enrich:", error)
      toast.error(String(error))
      setProcessingStep("ready")
    }
  }, [instance, t])

  const handleToggleUnknownMod = useCallback((filename: string) => {
    setSelectedUnknownMods(prev => {
      const newSet = new Set(prev)
      if (newSet.has(filename)) {
        newSet.delete(filename)
      } else {
        newSet.add(filename)
      }
      return newSet
    })
  }, [])

  const handleToggleOptionalMod = useCallback((filename: string) => {
    setExcludedOptionalMods(prev => {
      const newSet = new Set(prev)
      if (newSet.has(filename)) {
        newSet.delete(filename)
      } else {
        newSet.add(filename)
      }
      return newSet
    })
  }, [])

  const handleSelectAllUnknown = useCallback(() => {
    if (!analysis) return
    setSelectedUnknownMods(new Set(analysis.unknown.map(m => m.filename)))
  }, [analysis])

  const handleDeselectAllUnknown = useCallback(() => {
    setSelectedUnknownMods(new Set())
  }, [])

  const handleGoBack = useCallback(() => {
    navigate(`/instances/${instanceId}`)
  }, [navigate, instanceId])

  // Separate required mods (always included) from optional mods (can be toggled)
  const { requiredMods, optionalMods } = useMemo(() => {
    if (!analysis) return { requiredMods: [], optionalMods: [] }
    const required: ModServerCompatibility[] = []
    const optional: ModServerCompatibility[] = []
    for (const mod of analysis.server_compatible) {
      if (mod.server_side === "optional") {
        optional.push(mod)
      } else {
        required.push(mod)
      }
    }
    return { requiredMods: required, optionalMods: optional }
  }, [analysis])

  // Active optional mods (not excluded)
  const activeOptionalMods = useMemo(() => {
    return optionalMods.filter(m => !excludedOptionalMods.has(m.filename))
  }, [optionalMods, excludedOptionalMods])

  // Excluded optional mods (moved to excluded section)
  const excludedOptionalModsList = useMemo(() => {
    return optionalMods.filter(m => excludedOptionalMods.has(m.filename))
  }, [optionalMods, excludedOptionalMods])

  // Filtered mod lists
  const filteredRequired = useMemo(() => {
    if (!searchIncluded.trim()) return requiredMods
    const query = searchIncluded.toLowerCase()
    return requiredMods.filter(m =>
      m.name.toLowerCase().includes(query) || m.filename.toLowerCase().includes(query)
    )
  }, [requiredMods, searchIncluded])

  const filteredOptional = useMemo(() => {
    if (!searchIncluded.trim()) return activeOptionalMods
    const query = searchIncluded.toLowerCase()
    return activeOptionalMods.filter(m =>
      m.name.toLowerCase().includes(query) || m.filename.toLowerCase().includes(query)
    )
  }, [activeOptionalMods, searchIncluded])

  const filteredUnknown = useMemo(() => {
    if (!analysis) return []
    if (!searchUnknown.trim()) return analysis.unknown
    const query = searchUnknown.toLowerCase()
    return analysis.unknown.filter(m =>
      m.name.toLowerCase().includes(query) || m.filename.toLowerCase().includes(query)
    )
  }, [analysis, searchUnknown])

  // Combine client_only mods with excluded optional mods
  const allExcludedMods = useMemo(() => {
    if (!analysis) return []
    return [...excludedOptionalModsList, ...analysis.client_only]
  }, [analysis, excludedOptionalModsList])

  const totalIncluded = analysis
    ? requiredMods.length + activeOptionalMods.length + selectedUnknownMods.size
    : 0

  const handleCreate = useCallback(async () => {
    if (!analysis || !instance || !serverName.trim()) return

    console.log(`[CreateServerFromClient] Creating server: ${serverName.trim()} from ${instance.name}`)
    setProcessingStep("creating")
    try {
      // Include required mods, active optional mods, and selected unknown mods
      const modsToInclude = [
        ...requiredMods.map(m => m.filename),
        ...activeOptionalMods.map(m => m.filename),
        ...Array.from(selectedUnknownMods)
      ]

      console.log(`[CreateServerFromClient] Including ${modsToInclude.length} mods`)

      const options: CreateServerFromClientOptions = {
        source_instance_id: instance.id,
        server_name: serverName.trim(),
        mods_to_include: modsToInclude,
        copy_configs: copyConfigs,
        server_port: serverPort
      }

      const newInstance = await invoke<Instance>("create_server_from_client", { options })

      console.log(`[CreateServerFromClient] Server created: ${newInstance.name} (${newInstance.id})`)

      // Check for dependency issues after creation
      setProcessingStep("checking_deps")
      try {
        console.log("[CreateServerFromClient] Checking dependencies...")
        const issues = await invoke<DetectedIssue[]>("check_server_dependencies", {
          instanceId: newInstance.id
        })

        if (issues && issues.length > 0) {
          console.warn(`[CreateServerFromClient] ${issues.length} dependency issues found`)
          // Show warning but still navigate
          toast.warning(t("serverFromClient.dependencyWarning", { count: issues.length }))
        } else {
          console.log("[CreateServerFromClient] No dependency issues")
          toast.success(t("serverFromClient.success", { name: newInstance.name }))
        }
      } catch (depError) {
        console.warn("[CreateServerFromClient] Failed to check dependencies:", depError)
        // Don't block navigation for dependency check failure
        toast.success(t("serverFromClient.success", { name: newInstance.name }))
      }

      navigate(`/instances/${newInstance.id}`)
    } catch (error) {
      console.error("[CreateServerFromClient] Failed to create server:", error)
      toast.error(String(error))
      setProcessingStep("ready")
    }
  }, [analysis, instance, serverName, requiredMods, activeOptionalMods, selectedUnknownMods, copyConfigs, serverPort, t, navigate])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!instance) {
    return null
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 p-6 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <Button variant="ghost" size="icon" onClick={handleGoBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Server className="h-6 w-6" />
            {t("serverFromClient.pageTitle")}
          </h1>
          <p className="text-muted-foreground">
            {t("serverFromClient.pageDescription", { name: instance.name })}
          </p>
        </div>
        <Button
          onClick={handleCreate}
          disabled={isAnalyzing || isCreating || !serverName.trim() || !analysis}
          size="lg"
          className="gap-2"
        >
          {isCreating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("serverFromClient.creating")}
            </>
          ) : (
            <>
              <Server className="h-4 w-4" />
              {t("serverFromClient.createButton", { count: totalIncluded })}
            </>
          )}
        </Button>
      </div>

      {(isEnriching || isAnalyzing) ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-4 p-8">
          <div className="w-full max-w-md space-y-4">
            <div className="flex items-center justify-center gap-3">
              {isEnriching ? (
                <>
                  <Sparkles className="h-8 w-8 animate-pulse text-primary" />
                  <p className="text-lg text-muted-foreground">{t("serverFromClient.enriching")}</p>
                </>
              ) : (
                <>
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-lg text-muted-foreground">{t("serverFromClient.analyzing")}</p>
                </>
              )}
            </div>
            <Progress value={progressPercent} className="w-full" />
            <p className="text-sm text-center text-muted-foreground">
              {isEnriching
                ? t("serverFromClient.enrichingDesc")
                : t("serverFromClient.analyzingDesc")
              }
            </p>
          </div>
        </div>
      ) : analysis ? (
        <div className="flex-1 overflow-hidden p-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
            {/* Left Column: Configuration */}
            <div className="space-y-6">
              {/* Server Configuration Card */}
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2">
                    <Settings className="h-5 w-5" />
                    {t("serverFromClient.configuration")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="server-name">{t("serverFromClient.serverName")}</Label>
                    <Input
                      id="server-name"
                      value={serverName}
                      onChange={(e) => setServerName(e.target.value)}
                      placeholder={t("serverFromClient.serverNamePlaceholder")}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="server-port">{t("serverFromClient.serverPort")}</Label>
                    <Input
                      id="server-port"
                      type="number"
                      min={1}
                      max={65535}
                      value={serverPort}
                      onChange={(e) => setServerPort(parseInt(e.target.value) || 25565)}
                    />
                  </div>

                  <div className="flex items-center justify-between py-2">
                    <div className="space-y-0.5">
                      <Label>{t("serverFromClient.copyConfigs")}</Label>
                      <p className="text-xs text-muted-foreground">
                        {t("serverFromClient.copyConfigsDesc")}
                      </p>
                    </div>
                    <Switch checked={copyConfigs} onCheckedChange={setCopyConfigs} />
                  </div>

                  <div className="pt-2 border-t">
                    <p className="text-sm text-muted-foreground mb-2">{t("serverFromClient.sourceInfo")}</p>
                    <div className="flex items-center gap-2 text-sm">
                      <Badge variant="outline">{instance.loader}</Badge>
                      <span className="text-muted-foreground">{instance.mc_version}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Summary Card */}
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle>{t("serverFromClient.summary")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-500" />
                      <span className="text-sm">{t("serverFromClient.compatibleMods")}</span>
                    </div>
                    <Badge variant="secondary">{analysis.server_compatible.length}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <HelpCircle className="h-4 w-4 text-yellow-500" />
                      <span className="text-sm">{t("serverFromClient.selectedManual")}</span>
                    </div>
                    <Badge variant="outline" className="border-yellow-500/50">
                      {selectedUnknownMods.size} / {analysis.unknown.length}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <X className="h-4 w-4 text-red-500" />
                      <span className="text-sm">{t("serverFromClient.excludedMods")}</span>
                    </div>
                    <Badge variant="destructive">{analysis.client_only.length}</Badge>
                  </div>
                  <div className="border-t pt-3 mt-3">
                    <div className="flex items-center justify-between font-medium">
                      <span>{t("serverFromClient.totalIncluded")}</span>
                      <span className="text-lg text-primary">{totalIncluded}</span>
                    </div>
                  </div>

                  {/* Enrichment info and re-enrich button */}
                  {analysis.unknown.length > 0 && (
                    <div className="border-t pt-3 mt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full gap-2"
                        onClick={handleReEnrich}
                        disabled={isEnriching || isAnalyzing}
                      >
                        <RefreshCw className={`h-4 w-4 ${isEnriching ? "animate-spin" : ""}`} />
                        {t("serverFromClient.reEnrich")}
                      </Button>
                      <p className="text-xs text-muted-foreground mt-2 text-center">
                        {t("serverFromClient.reEnrichDesc")}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

            </div>

            {/* Middle Column: Mods to Include */}
            <Card className="flex flex-col overflow-hidden">
              <CardHeader className="pb-3 flex-shrink-0">
                <CardTitle className="flex items-center gap-2">
                  <Check className="h-5 w-5 text-green-500" />
                  {t("serverFromClient.willBeIncluded")}
                  <Badge variant="secondary">{totalIncluded}</Badge>
                </CardTitle>
                <CardDescription>{t("serverFromClient.willBeIncludedDesc")}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden flex flex-col p-0">
                {/* Search input */}
                {(requiredMods.length > 0 || optionalMods.length > 0) && (
                  <div className="px-4 pb-2 flex-shrink-0">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={searchIncluded}
                        onChange={(e) => setSearchIncluded(e.target.value)}
                        placeholder={t("serverFromClient.searchMods")}
                        className="pl-9"
                      />
                    </div>
                  </div>
                )}
                <ScrollArea className="flex-1 px-4 pb-4">
                  <div className="space-y-1.5">
                    {/* Required mods - always included */}
                    {filteredRequired.map((mod) => {
                      const badge = getBadgeInfo(mod.server_side)
                      return (
                        <ModCard
                          key={mod.filename}
                          mod={mod}
                          badgeText={badge.text}
                          badgeVariant={badge.variant}
                        />
                      )
                    })}
                    {/* Optional mods - with checkbox to toggle */}
                    {filteredOptional.map((mod) => {
                      const badge = getBadgeInfo(mod.server_side)
                      return (
                        <ModCard
                          key={mod.filename}
                          mod={mod}
                          showCheckbox
                          checked={true}
                          onToggle={() => handleToggleOptionalMod(mod.filename)}
                          badgeText={badge.text}
                          badgeVariant={badge.variant}
                        />
                      )
                    })}
                    {requiredMods.length === 0 && optionalMods.length === 0 && (
                      <div className="text-center py-8 text-muted-foreground">
                        <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p>{t("serverFromClient.noCompatibleMods")}</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Right Column: Manual Selection + Excluded */}
            <div className="flex flex-col gap-6 overflow-hidden">
              {/* Unknown Mods - Need Decision */}
              {analysis.unknown.length > 0 && (
                <Card className="flex flex-col overflow-hidden flex-1">
                  <CardHeader className="pb-3 flex-shrink-0">
                    <CardTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-yellow-500" />
                      {t("serverFromClient.needsDecision")}
                      <Badge variant="outline" className="border-yellow-500/50">{analysis.unknown.length}</Badge>
                    </CardTitle>
                    <CardDescription>{t("serverFromClient.unknownModsDesc")}</CardDescription>
                    <div className="flex gap-2 pt-2">
                      <Button variant="outline" size="sm" onClick={handleSelectAllUnknown}>
                        {t("serverFromClient.selectAll")}
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleDeselectAllUnknown}>
                        {t("serverFromClient.deselectAll")}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-hidden flex flex-col p-0">
                    <div className="px-4 pb-2 flex-shrink-0">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          value={searchUnknown}
                          onChange={(e) => setSearchUnknown(e.target.value)}
                          placeholder={t("serverFromClient.searchMods")}
                          className="pl-9"
                        />
                      </div>
                    </div>
                    <ScrollArea className="flex-1 px-4 pb-4">
                      <div className="space-y-1.5">
                        {filteredUnknown.map((mod) => {
                          const badge = getBadgeInfo(mod.server_side)
                          return (
                            <ModCard
                              key={mod.filename}
                              mod={mod}
                              showCheckbox
                              checked={selectedUnknownMods.has(mod.filename)}
                              onToggle={() => handleToggleUnknownMod(mod.filename)}
                              badgeText={badge.text}
                              badgeVariant={badge.variant}
                            />
                          )
                        })}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}

              {/* Excluded Mods (client-only + excluded optional) */}
              {allExcludedMods.length > 0 && (
                <Card className={`flex flex-col overflow-hidden ${analysis.unknown.length > 0 ? "flex-1" : "flex-1"}`}>
                  <CardHeader className="pb-3 flex-shrink-0">
                    <CardTitle className="flex items-center gap-2">
                      <X className="h-5 w-5 text-red-500" />
                      {t("serverFromClient.willBeExcluded")}
                      <Badge variant="destructive">{allExcludedMods.length}</Badge>
                    </CardTitle>
                    <CardDescription>{t("serverFromClient.clientOnlyDesc")}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-hidden flex flex-col p-0">
                    <div className="px-4 pb-2 flex-shrink-0">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          value={searchExcluded}
                          onChange={(e) => setSearchExcluded(e.target.value)}
                          placeholder={t("serverFromClient.searchMods")}
                          className="pl-9"
                        />
                      </div>
                    </div>
                    <ScrollArea className="flex-1 px-4 pb-4">
                      <div className="space-y-1.5">
                        {/* Excluded optional mods - with checkbox to re-include */}
                        {excludedOptionalModsList.filter(m =>
                          !searchExcluded.trim() ||
                          m.name.toLowerCase().includes(searchExcluded.toLowerCase()) ||
                          m.filename.toLowerCase().includes(searchExcluded.toLowerCase())
                        ).map((mod) => {
                          const badge = getBadgeInfo(mod.server_side)
                          return (
                            <ModCard
                              key={mod.filename}
                              mod={mod}
                              showCheckbox
                              checked={false}
                              onToggle={() => handleToggleOptionalMod(mod.filename)}
                              badgeText={badge.text}
                              badgeVariant={badge.variant}
                              dimmed
                            />
                          )
                        })}
                        {/* Client-only mods - always excluded */}
                        {analysis.client_only.filter(m =>
                          !searchExcluded.trim() ||
                          m.name.toLowerCase().includes(searchExcluded.toLowerCase()) ||
                          m.filename.toLowerCase().includes(searchExcluded.toLowerCase())
                        ).map((mod) => {
                          const badge = getBadgeInfo(mod.server_side)
                          return (
                            <ModCard
                              key={mod.filename}
                              mod={mod}
                              dimmed
                              badgeText={badge.text}
                              badgeVariant={badge.variant}
                            />
                          )
                        })}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}

              {/* No mods to show */}
              {analysis.unknown.length === 0 && allExcludedMods.length === 0 && (
                <Card className="flex-1">
                  <CardContent className="flex flex-col items-center justify-center h-full text-muted-foreground">
                    <Check className="h-12 w-12 mb-4 text-green-500" />
                    <p className="text-lg font-medium">{t("serverFromClient.allModsCompatible")}</p>
                    <p className="text-sm">{t("serverFromClient.allModsCompatibleDesc")}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default CreateServerFromClient
