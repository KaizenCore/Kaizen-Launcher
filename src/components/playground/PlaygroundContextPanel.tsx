import { useMemo, useState, useCallback, useRef } from "react";
import {
  Terminal,
  Info,
  X,
  Package,
  ExternalLink,
  Power,
  PowerOff,
  Trash2,
  Settings,
  GripVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import { VisualConfigEditor, getFileTypeFromPath, supportsVisualMode } from "@/components/config/ConfigEditorUtils";
import { CodeEditor, getMonacoLanguage } from "@/components/ui/code-editor";
import { PlaygroundConsole } from "./PlaygroundConsole";
import type { RightPanelMode } from "@/types/playground";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

// Min and max width for resize
const MIN_WIDTH = 280;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 350;

export function PlaygroundContextPanel() {
  const { t } = useTranslation();

  const instance = usePlaygroundStore((s) => s.instance);
  const instanceId = usePlaygroundStore((s) => s.instanceId);
  const mods = usePlaygroundStore((s) => s.mods);
  const selectedNodeId = usePlaygroundStore((s) => s.selectedNodeId);
  const rightPanelMode = usePlaygroundStore((s) => s.rightPanelMode);
  const isRunning = usePlaygroundStore((s) => s.isRunning);
  const setRightPanelMode = usePlaygroundStore((s) => s.setRightPanelMode);
  const selectNode = usePlaygroundStore((s) => s.selectNode);
  const toggleMod = usePlaygroundStore((s) => s.toggleMod);
  const deleteMod = usePlaygroundStore((s) => s.deleteMod);

  // Panel width state
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const isResizing = useRef(false);

  // Config editor state
  const [configContent, setConfigContent] = useState<string>("");
  const [originalConfigContent, setOriginalConfigContent] = useState<string>("");
  const [selectedConfigPath, setSelectedConfigPath] = useState<string | null>(null);
  const [configFiles, setConfigFiles] = useState<{ path: string; name: string }[]>([]);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configEditorMode, setConfigEditorMode] = useState<"visual" | "text">("visual");

  // Get selected mod
  const selectedMod = useMemo(() => {
    if (!selectedNodeId || selectedNodeId === "instance") return null;
    return mods.find((m) => m.filename === selectedNodeId) || null;
  }, [selectedNodeId, mods]);

  // Load config files for selected mod and auto-open the first one
  const loadModConfigFiles = useCallback(async () => {
    if (!instanceId || !selectedMod) {
      setConfigFiles([]);
      setSelectedConfigPath(null);
      setConfigContent("");
      setOriginalConfigContent("");
      return;
    }

    try {
      const files = await invoke<{ path: string; name: string; file_type: string }[]>(
        "get_instance_config_files",
        { instanceId }
      );

      // Filter to files related to this mod
      const modNameLower = selectedMod.name.toLowerCase().replace(/\s+/g, "");
      const modFilenameLower = selectedMod.filename.replace(".jar", "").toLowerCase();

      const relevantFiles = files.filter((f) => {
        const pathLower = f.path.toLowerCase();
        return (
          pathLower.includes(modNameLower) ||
          pathLower.includes(modFilenameLower)
        );
      });

      setConfigFiles(relevantFiles.length > 0 ? relevantFiles : []);

      // Auto-load the first config file if available
      if (relevantFiles.length > 0) {
        const firstFile = relevantFiles[0];
        setIsLoadingConfig(true);
        try {
          const content = await invoke<string>("read_config_file", {
            instanceId,
            configPath: firstFile.path,
          });
          setConfigContent(content);
          setOriginalConfigContent(content);
          setSelectedConfigPath(firstFile.path);
        } catch (err) {
          console.error("[PlaygroundContextPanel] Failed to auto-load config:", err);
        } finally {
          setIsLoadingConfig(false);
        }
      } else {
        setSelectedConfigPath(null);
        setConfigContent("");
        setOriginalConfigContent("");
      }
    } catch (err) {
      console.error("[PlaygroundContextPanel] Failed to load config files:", err);
      setConfigFiles([]);
      setSelectedConfigPath(null);
      setConfigContent("");
      setOriginalConfigContent("");
    }
  }, [instanceId, selectedMod]);

  // Load config files when mod is selected
  useMemo(() => {
    loadModConfigFiles();
  }, [loadModConfigFiles]);

  // Load config content
  const loadConfigContent = useCallback(async (path: string) => {
    if (!instanceId) return;

    setIsLoadingConfig(true);
    try {
      const content = await invoke<string>("read_config_file", {
        instanceId,
        configPath: path,
      });
      setConfigContent(content);
      setOriginalConfigContent(content);
      setSelectedConfigPath(path);
    } catch (err) {
      console.error("[PlaygroundContextPanel] Failed to load config:", err);
      toast.error(t("config.loadError"));
    } finally {
      setIsLoadingConfig(false);
    }
  }, [instanceId, t]);

  // Save config
  const saveConfig = useCallback(async () => {
    if (!instanceId || !selectedConfigPath) return;

    setIsSavingConfig(true);
    try {
      await invoke("save_config_file", {
        instanceId,
        configPath: selectedConfigPath,
        content: configContent,
      });
      setOriginalConfigContent(configContent);
      toast.success(t("configEditor.configSaved"));
    } catch (err) {
      console.error("[PlaygroundContextPanel] Failed to save config:", err);
      toast.error(t("config.saveError"));
    } finally {
      setIsSavingConfig(false);
    }
  }, [instanceId, selectedConfigPath, configContent, t]);

  const hasConfigChanges = configContent !== originalConfigContent;
  const fileType = selectedConfigPath ? getFileTypeFromPath(selectedConfigPath) : "text";
  const canUseVisualMode = supportsVisualMode(fileType);

  const handleModeChange = (mode: string) => {
    setRightPanelMode(mode as RightPanelMode);
  };

  // Resize handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const startX = e.clientX;
    const startWidth = panelWidth;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = startX - e.clientX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [panelWidth]);

  if (!instance) {
    return (
      <div
        className="border-l bg-card/50 flex items-center justify-center"
        style={{ width: panelWidth }}
      >
        <p className="text-sm text-muted-foreground text-center p-4">
          {t("playground.selectInstanceToStart")}
        </p>
      </div>
    );
  }

  return (
    <div
      className="border-l bg-card/50 flex h-full relative"
      style={{ width: panelWidth }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/50 active:bg-primary z-10 flex items-center justify-center group"
        onMouseDown={handleMouseDown}
      >
        <div className="w-4 h-8 -ml-1.5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      {/* Panel content */}
      <div className="flex-1 flex flex-col h-full ml-1">
        <Tabs
          value={rightPanelMode}
          onValueChange={handleModeChange}
          className="flex flex-col h-full"
        >
          <TabsList className="w-full rounded-none border-b bg-transparent p-0 flex-shrink-0">
            <TabsTrigger
              value="console"
              className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
            >
              <Terminal className="h-4 w-4 mr-1.5" />
              {t("playground.console")}
            </TabsTrigger>
            <TabsTrigger
              value="details"
              className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
            >
              <Info className="h-4 w-4 mr-1.5" />
              {t("playground.details")}
            </TabsTrigger>
          </TabsList>

          {/* Console Tab */}
          <TabsContent value="console" className="flex-1 m-0 overflow-hidden">
            <PlaygroundConsole
              instanceId={instance.id}
              isRunning={isRunning}
              isServer={instance.is_server || instance.is_proxy}
            />
          </TabsContent>

          {/* Details Tab */}
          <TabsContent value="details" className="flex-1 m-0 overflow-hidden flex flex-col">
            {selectedMod ? (
              <>
                {/* Mod Header - Compact */}
                <div className="flex items-center gap-3 p-3 border-b flex-shrink-0">
                  {selectedMod.icon_url ? (
                    <img
                      src={selectedMod.icon_url}
                      alt={selectedMod.name}
                      className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      <Package className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm truncate">{selectedMod.name}</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">v{selectedMod.version}</span>
                      <Badge
                        variant={selectedMod.enabled ? "default" : "secondary"}
                        className="text-xs h-5"
                      >
                        {selectedMod.enabled ? t("playground.enabled") : t("playground.disabled")}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 flex-shrink-0"
                    onClick={() => selectNode(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                {/* Quick Actions - Compact */}
                <div className="flex gap-1.5 p-2 border-b flex-shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1 h-7 text-xs"
                    onClick={() => toggleMod(selectedMod.filename, !selectedMod.enabled)}
                  >
                    {selectedMod.enabled ? (
                      <><PowerOff className="h-3 w-3" />{t("playground.disable")}</>
                    ) : (
                      <><Power className="h-3 w-3" />{t("playground.enable")}</>
                    )}
                  </Button>
                  {selectedMod.project_id && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => window.open(`https://modrinth.com/mod/${selectedMod.project_id}`, "_blank")}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    onClick={() => deleteMod(selectedMod.filename)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>

                {/* Config Editor Section - Takes all remaining height */}
                {configFiles.length > 0 ? (
                  <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Config file selector */}
                    <div className="flex items-center gap-2 p-2 border-b flex-shrink-0 overflow-x-auto">
                      <Settings className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <div className="flex gap-1">
                        {configFiles.map((file) => (
                          <Button
                            key={file.path}
                            variant={selectedConfigPath === file.path ? "secondary" : "ghost"}
                            size="sm"
                            className="text-xs h-6 px-2"
                            onClick={() => loadConfigContent(file.path)}
                          >
                            {file.name || file.path.split("/").pop()}
                          </Button>
                        ))}
                      </div>
                    </div>

                    {/* Config editor - Takes remaining space */}
                    {selectedConfigPath ? (
                      <div className="flex-1 flex flex-col overflow-hidden">
                        {/* Editor header */}
                        <div className="flex items-center justify-between px-2 py-1.5 bg-muted/50 border-b flex-shrink-0">
                          <span className="text-xs text-muted-foreground truncate flex-1">
                            {selectedConfigPath}
                          </span>
                          <div className="flex items-center gap-1">
                            {canUseVisualMode && (
                              <div className="flex border rounded overflow-hidden">
                                <Button
                                  variant={configEditorMode === "visual" ? "secondary" : "ghost"}
                                  size="sm"
                                  className="h-5 w-5 p-0 rounded-none"
                                  onClick={() => setConfigEditorMode("visual")}
                                >
                                  <Settings className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant={configEditorMode === "text" ? "secondary" : "ghost"}
                                  size="sm"
                                  className="h-5 w-5 p-0 rounded-none"
                                  onClick={() => setConfigEditorMode("text")}
                                >
                                  <Terminal className="h-3 w-3" />
                                </Button>
                              </div>
                            )}
                            {hasConfigChanges && (
                              <Button
                                size="sm"
                                className="h-5 text-xs px-2"
                                onClick={saveConfig}
                                disabled={isSavingConfig}
                              >
                                {isSavingConfig ? "..." : t("common.save")}
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Editor content - Fills remaining space */}
                        <div
                          className="flex-1 overflow-hidden"
                          onWheelCapture={(e) => e.stopPropagation()}
                        >
                          {isLoadingConfig ? (
                            <div className="flex items-center justify-center h-full">
                              <div className="animate-pulse text-muted-foreground text-sm">Loading...</div>
                            </div>
                          ) : configEditorMode === "visual" && canUseVisualMode ? (
                            <VisualConfigEditor
                              content={configContent}
                              fileType={fileType}
                              onChange={setConfigContent}
                            />
                          ) : (
                            <CodeEditor
                              value={configContent}
                              onChange={setConfigContent}
                              language={getMonacoLanguage(fileType)}
                            />
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                        {t("playground.selectConfigToEdit")}
                      </div>
                    )}
                  </div>
                ) : (
                  /* No config files - show dependencies and info */
                  <ScrollArea className="flex-1">
                    <div className="p-4 space-y-4">
                      {/* Dependencies */}
                      {selectedMod.dependencies.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="text-sm font-medium">
                            {t("playground.dependencies")} ({selectedMod.dependencies.length})
                          </h4>
                          <div className="space-y-1">
                            {selectedMod.dependencies.map((dep) => {
                              const depMod = mods.find((m) => m.project_id === dep.project_id);
                              const isInstalled = !!depMod;
                              return (
                                <div
                                  key={dep.project_id}
                                  className={cn(
                                    "flex items-center justify-between p-2 rounded-md text-sm",
                                    isInstalled ? "bg-green-500/10" : "bg-red-500/10"
                                  )}
                                >
                                  <span className="truncate">{depMod?.name || dep.project_id}</span>
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "text-xs",
                                      dep.dependency_type === "required" ? "border-red-500/50" : "border-amber-500/50"
                                    )}
                                  >
                                    {dep.dependency_type}
                                  </Badge>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* File info */}
                      <div className="text-xs text-muted-foreground pt-2 border-t">
                        <span className="font-mono">{selectedMod.filename}</span>
                      </div>

                      {/* No config message */}
                      <div className="text-center text-muted-foreground text-sm py-4">
                        {t("playground.noConfigFiles")}
                      </div>
                    </div>
                  </ScrollArea>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <Info className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <p className="text-sm text-muted-foreground">
                  {t("playground.selectModToViewDetails")}
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
