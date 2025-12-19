import { memo, useState, useEffect, useCallback } from "react";
import { Handle, Position, NodeResizer, type NodeProps } from "@xyflow/react";
import { invoke } from "@tauri-apps/api/core";
import {
  Settings,
  X,
  Save,
  RotateCcw,
  FileText,
  Loader2,
  Code,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CodeEditor, getMonacoLanguage } from "@/components/ui/code-editor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import type { ConfigNodeData } from "@/types/playground";

// Import visual editor from config component
import { VisualConfigEditor, getFileTypeFromPath, supportsVisualMode } from "@/components/config/ConfigEditorUtils";

interface ConfigFileInfo {
  name: string;
  path: string;
  size_bytes: number;
  file_type: string;
}

type ConfigNodeProps = NodeProps & {
  data: ConfigNodeData;
};

function ConfigNodeComponent({ id, data, selected }: ConfigNodeProps) {
  const { t } = useTranslation();
  const { modFilename, modName, configPath } = data;

  const instanceId = usePlaygroundStore((s) => s.instanceId);
  const removeConfigNode = usePlaygroundStore((s) => s.removeConfigNode);

  const [configFiles, setConfigFiles] = useState<ConfigFileInfo[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<string | null>(configPath);
  const [content, setContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [editorMode, setEditorMode] = useState<"visual" | "text">("visual");

  // Get file type for selected config
  const fileType = selectedConfig ? getFileTypeFromPath(selectedConfig) : "text";
  const canUseVisualMode = supportsVisualMode(fileType);

  // Load config files list
  useEffect(() => {
    const loadConfigFiles = async () => {
      if (!instanceId) return;

      try {
        const files = await invoke<ConfigFileInfo[]>("get_instance_config_files", {
          instanceId,
        });

        // Filter to only show files related to this mod (by name similarity)
        const modNameLower = modName.toLowerCase().replace(/\s+/g, "");
        const relevantFiles = files.filter((f) => {
          const fileLower = f.path.toLowerCase();
          return (
            fileLower.includes(modNameLower) ||
            fileLower.includes(modFilename.replace(".jar", "").toLowerCase())
          );
        });

        // If no specific mod configs found, show all configs
        setConfigFiles(relevantFiles.length > 0 ? relevantFiles : files.slice(0, 30));
      } catch (err) {
        console.error("[ConfigNode] Failed to load config files:", err);
      }
    };

    loadConfigFiles();
  }, [instanceId, modName, modFilename]);

  // Load config content when selected
  useEffect(() => {
    const loadContent = async () => {
      if (!instanceId || !selectedConfig) {
        setContent("");
        setOriginalContent("");
        return;
      }

      setIsLoading(true);
      try {
        const configContent = await invoke<string>("read_config_file", {
          instanceId,
          configPath: selectedConfig,
        });
        setContent(configContent);
        setOriginalContent(configContent);
        setHasChanges(false);
      } catch (err) {
        console.error("[ConfigNode] Failed to load config:", err);
        toast.error("Failed to load config file");
      } finally {
        setIsLoading(false);
      }
    };

    loadContent();
  }, [instanceId, selectedConfig]);

  // Track changes
  useEffect(() => {
    setHasChanges(content !== originalContent);
  }, [content, originalContent]);

  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
  }, []);

  const handleSave = async () => {
    if (!instanceId || !selectedConfig) return;

    setIsSaving(true);
    try {
      await invoke("save_config_file", {
        instanceId,
        configPath: selectedConfig,
        content,
      });
      setOriginalContent(content);
      setHasChanges(false);
      toast.success(t("playground.configSaved"));
    } catch (err) {
      console.error("[ConfigNode] Failed to save config:", err);
      toast.error("Failed to save config file");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setContent(originalContent);
    setHasChanges(false);
  };

  const handleClose = () => {
    if (hasChanges) {
      if (!confirm(t("playground.unsavedChanges"))) return;
    }
    removeConfigNode(id);
  };

  return (
    <>
      {/* Resizer - must be outside the main div */}
      <NodeResizer
        minWidth={400}
        minHeight={350}
        isVisible={selected}
        lineClassName="!border-primary"
        handleClassName="!w-3 !h-3 !bg-primary !border-2 !border-background !rounded"
      />

      <div
        className={cn(
          "bg-card border-2 rounded-xl shadow-lg relative",
          "w-full h-full flex flex-col",
          selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
          hasChanges && "border-amber-500"
        )}
      >
        {/* Connection handle */}
        <Handle
          type="target"
          position={Position.Left}
          className="!bg-primary !w-3 !h-3 !border-2 !border-background"
        />

        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b bg-muted/30 rounded-t-xl">
          <div className="flex items-center gap-2 min-w-0">
            <Settings className="h-4 w-4 text-primary flex-shrink-0" />
            <span className="font-medium text-sm truncate">
              {modName}
            </span>
            {hasChanges && (
              <Badge variant="outline" className="text-xs text-amber-500 border-amber-500 flex-shrink-0">
                {t("configEditor.notSaved")}
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0"
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Config selector & mode toggle */}
        <div className="p-3 border-b flex items-center gap-2" onWheelCapture={(e) => e.stopPropagation()}>
          <Select
            value={selectedConfig || ""}
            onValueChange={setSelectedConfig}
          >
            <SelectTrigger className="flex-1 h-8 text-xs">
              <SelectValue placeholder={t("playground.selectConfig")} />
            </SelectTrigger>
            <SelectContent>
              {configFiles.map((file) => (
                <SelectItem key={file.path} value={file.path}>
                  <div className="flex items-center gap-2">
                    <FileText className="h-3 w-3 flex-shrink-0" />
                    <span className="truncate">{file.path}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {canUseVisualMode && selectedConfig && (
            <div className="flex items-center border rounded-md flex-shrink-0">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={editorMode === "visual" ? "secondary" : "ghost"}
                      size="sm"
                      className="h-8 w-8 p-0 rounded-r-none"
                      onClick={() => setEditorMode("visual")}
                    >
                      <Settings2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("configEditor.visualMode")}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={editorMode === "text" ? "secondary" : "ghost"}
                      size="sm"
                      className="h-8 w-8 p-0 rounded-l-none"
                      onClick={() => setEditorMode("text")}
                    >
                      <Code className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("configEditor.textMode")}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}
        </div>

        {/* Content editor - stop wheel propagation to prevent canvas zoom */}
        <div
          className="flex-1 overflow-hidden"
          onWheelCapture={(e) => e.stopPropagation()}
        >
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : selectedConfig ? (
            editorMode === "visual" && canUseVisualMode ? (
              <VisualConfigEditor
                content={content}
                fileType={fileType}
                onChange={handleContentChange}
              />
            ) : (
              <CodeEditor
                value={content}
                onChange={handleContentChange}
                language={getMonacoLanguage(fileType)}
              />
            )
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <FileText className="h-8 w-8 mb-2" />
              <p className="text-xs">{t("playground.selectConfigToEdit")}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        {selectedConfig && (
          <div className="flex items-center justify-between p-3 border-t bg-muted/30 rounded-b-xl">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              disabled={!hasChanges || isSaving}
              className="h-7 text-xs"
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              {t("playground.reset")}
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              className="h-7 text-xs"
            >
              {isSaving ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Save className="h-3 w-3 mr-1" />
              )}
              {t("playground.save")}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

export const ConfigNode = memo(ConfigNodeComponent);
