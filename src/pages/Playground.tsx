import { FlaskConical } from "lucide-react";
import { useTranslation } from "@/i18n";
import { RequirePermission } from "@/components/permissions/RequirePermission";
import { PERMISSIONS } from "@/hooks/usePermission";

export function Playground() {
  const { t } = useTranslation();

  return (
    <RequirePermission permission={PERMISSIONS.BETA}>
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="p-4 rounded-full bg-muted mb-4">
          <FlaskConical className="h-12 w-12 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-bold mb-2">{t("playground.comingSoon")}</h1>
        <p className="text-muted-foreground text-center max-w-md">
          {t("playground.comingSoonDesc")}
        </p>
      </div>
    </RequirePermission>
  );
}

export default Playground;
