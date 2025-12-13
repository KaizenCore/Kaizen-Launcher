import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getVersion } from "@tauri-apps/api/app";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Boxes,
  Sparkles,
  Zap,
  Share2,
  Search,
  Tag,
  Cloud,
  ArrowRight,
  Heart,
  PartyPopper,
} from "lucide-react";
import { useUpdateStore } from "@/stores/updateStore";
import { useTranslation } from "@/i18n";

export function MajorUpdateDialog() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [appVersion, setAppVersion] = useState("");

  const { shouldShowMajorUpdateDialog, setLastSeenMajorVersion } = useUpdateStore();

  useEffect(() => {
    const checkVersion = async () => {
      try {
        const version = await getVersion();
        setAppVersion(version);

        // Check if we should show the dialog
        if (shouldShowMajorUpdateDialog(version)) {
          // Small delay to let the app render first
          setTimeout(() => setIsOpen(true), 500);
        }
      } catch (err) {
        console.error("[MajorUpdateDialog] Failed to get version:", err);
      }
    };

    checkVersion();
  }, [shouldShowMajorUpdateDialog]);

  const handleClose = () => {
    setIsOpen(false);
    setLastSeenMajorVersion(appVersion);
  };

  const handleViewChangelog = () => {
    setIsOpen(false);
    setLastSeenMajorVersion(appVersion);
    navigate("/changelog");
  };

  const handleTrySchematics = () => {
    setIsOpen(false);
    setLastSeenMajorVersion(appVersion);
    navigate("/schematics");
  };

  const features = [
    {
      icon: <Boxes className="h-5 w-5 text-purple-500" />,
      title: t("majorUpdate.feature1Title"),
      description: t("majorUpdate.feature1Desc"),
    },
    {
      icon: <Share2 className="h-5 w-5 text-blue-500" />,
      title: t("majorUpdate.feature2Title"),
      description: t("majorUpdate.feature2Desc"),
    },
    {
      icon: <Search className="h-5 w-5 text-green-500" />,
      title: t("majorUpdate.feature3Title"),
      description: t("majorUpdate.feature3Desc"),
    },
    {
      icon: <Tag className="h-5 w-5 text-amber-500" />,
      title: t("majorUpdate.feature4Title"),
      description: t("majorUpdate.feature4Desc"),
    },
    {
      icon: <Cloud className="h-5 w-5 text-cyan-500" />,
      title: t("majorUpdate.feature5Title"),
      description: t("majorUpdate.feature5Desc"),
    },
    {
      icon: <Zap className="h-5 w-5 text-orange-500" />,
      title: t("majorUpdate.feature6Title"),
      description: t("majorUpdate.feature6Desc"),
    },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="text-center pb-2">
          <div className="flex justify-center mb-4">
            <div className="relative">
              <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-primary/20 via-purple-500/20 to-pink-500/20 flex items-center justify-center">
                <PartyPopper className="h-10 w-10 text-primary" />
              </div>
              <div className="absolute -top-1 -right-1">
                <Badge className="bg-gradient-to-r from-primary to-purple-500 text-white border-0">
                  v{appVersion}
                </Badge>
              </div>
            </div>
          </div>

          <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-primary via-purple-500 to-pink-500 bg-clip-text text-transparent">
            {t("majorUpdate.title")}
          </DialogTitle>

          <DialogDescription className="text-base">
            {t("majorUpdate.subtitle")}
          </DialogDescription>
        </DialogHeader>

        {/* Message from the team */}
        <div className="bg-muted/50 rounded-lg p-4 border border-border/50 my-4">
          <div className="flex items-start gap-3">
            <Heart className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("majorUpdate.teamMessage")}</p>
              <p className="text-xs text-muted-foreground italic">
                — {t("majorUpdate.teamSignature")}
              </p>
            </div>
          </div>
        </div>

        <Separator />

        {/* New Features */}
        <div className="py-4">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">{t("majorUpdate.newFeatures")}</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {features.map((feature, index) => (
              <div
                key={index}
                className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-background flex items-center justify-center border">
                  {feature.icon}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{feature.title}</p>
                  <p className="text-xs text-muted-foreground">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <Separator />

        {/* v0.5.x recap */}
        <div className="py-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground font-medium">
              {t("majorUpdate.v05Recap")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="text-xs">Skin Manager</Badge>
            <Badge variant="secondary" className="text-xs">Mod Browser</Badge>
            <Badge variant="secondary" className="text-xs">Dev Tools</Badge>
            <Badge variant="secondary" className="text-xs">Cloud Backups</Badge>
            <Badge variant="secondary" className="text-xs">Discord RPC</Badge>
            <Badge variant="secondary" className="text-xs">P2P Sharing</Badge>
            <Badge variant="secondary" className="text-xs">4K Support</Badge>
            <Badge variant="secondary" className="text-xs">i18n (4 languages)</Badge>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleViewChangelog}
          >
            {t("majorUpdate.viewChangelog")}
          </Button>
          <Button
            className="flex-1 bg-gradient-to-r from-primary to-purple-500 hover:from-primary/90 hover:to-purple-500/90"
            onClick={handleTrySchematics}
          >
            {t("majorUpdate.trySchematics")}
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>

        <p className="text-xs text-center text-muted-foreground pt-2">
          {t("majorUpdate.thankYou")}
        </p>
      </DialogContent>
    </Dialog>
  );
}
