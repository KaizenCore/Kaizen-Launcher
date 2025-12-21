import { Info, GitBranch, Settings, Server } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "@/i18n";
import { usePlaygroundStore, type DetailsTab } from "@/stores/playgroundStore";
import { ModDetailsTab } from "./ModDetailsTab";
import { DependencyTreeView } from "./DependencyTreeView";
import { ModConfigEditor } from "./ModConfigEditor";
import { InstanceInfoTab } from "./InstanceInfoTab";

export function PlaygroundDetailsPanel() {
  const { t } = useTranslation();

  const selectedModFilename = usePlaygroundStore((s) => s.selectedModFilename);
  const mods = usePlaygroundStore((s) => s.mods);
  const activeDetailsTab = usePlaygroundStore((s) => s.activeDetailsTab);
  const setActiveDetailsTab = usePlaygroundStore((s) => s.setActiveDetailsTab);

  const selectedMod = selectedModFilename
    ? mods.find((m) => m.filename === selectedModFilename)
    : null;

  return (
    <div className="flex flex-col h-full">
      <Tabs
        value={activeDetailsTab}
        onValueChange={(value) => setActiveDetailsTab(value as DetailsTab)}
        className="flex flex-col h-full"
      >
        <TabsList className="w-full justify-start rounded-none border-b bg-transparent h-10 px-2">
          <TabsTrigger
            value="details"
            className="gap-1.5 text-xs data-[state=active]:bg-accent rounded-sm px-3"
          >
            <Info className="h-3.5 w-3.5" />
            {t("playground.details")}
          </TabsTrigger>
          <TabsTrigger
            value="dependencies"
            className="gap-1.5 text-xs data-[state=active]:bg-accent rounded-sm px-3"
          >
            <GitBranch className="h-3.5 w-3.5" />
            {t("playground.dependencies")}
          </TabsTrigger>
          <TabsTrigger
            value="config"
            className="gap-1.5 text-xs data-[state=active]:bg-accent rounded-sm px-3"
          >
            <Settings className="h-3.5 w-3.5" />
            Config
          </TabsTrigger>
          <TabsTrigger
            value="instance"
            className="gap-1.5 text-xs data-[state=active]:bg-accent rounded-sm px-3"
          >
            <Server className="h-3.5 w-3.5" />
            Instance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="flex-1 mt-0 overflow-hidden">
          {selectedMod ? (
            <ModDetailsTab mod={selectedMod} />
          ) : (
            <EmptyState message="Select a mod to view details" />
          )}
        </TabsContent>

        <TabsContent value="dependencies" className="flex-1 mt-0 overflow-hidden">
          {selectedMod ? (
            <DependencyTreeView mod={selectedMod} />
          ) : (
            <EmptyState message="Select a mod to view dependencies" />
          )}
        </TabsContent>

        <TabsContent value="config" className="flex-1 mt-0 overflow-hidden">
          {selectedMod ? (
            <ModConfigEditor mod={selectedMod} />
          ) : (
            <EmptyState message="Select a mod to edit config" />
          )}
        </TabsContent>

        <TabsContent value="instance" className="flex-1 mt-0 overflow-hidden">
          <InstanceInfoTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-4 text-center">
      {message}
    </div>
  );
}

export default PlaygroundDetailsPanel;
