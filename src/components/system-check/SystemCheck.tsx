import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import { Settings2, Coffee, Cloud, Check } from "lucide-react";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
import { useSystemCheckStore } from "@/stores/systemCheckStore";
import { DependencyCard } from "./DependencyCard";

interface SystemCheckProps {
  open: boolean;
  onComplete: () => void;
}

interface JavaInfo {
  version: string;
  path: string;
  is_bundled: boolean;
}

interface AgentInfo {
  provider: string;
  version: string | null;
  path: string;
  installed: boolean;
}

export function SystemCheck({ open, onComplete }: SystemCheckProps) {
  const { t } = useTranslation();
  const hasChecked = useRef(false);

  const {
    java,
    cloudflare,
    cloudflareSkipped,
    setJava,
    setCloudflare,
    setCloudflareSkipped,
    setHasCheckedThisSession,
    setIsChecking,
    isChecking,
  } = useSystemCheckStore();

  // Check dependencies on mount
  useEffect(() => {
    if (!open || hasChecked.current) return;
    hasChecked.current = true;
    checkDependencies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const checkDependencies = async () => {
    setIsChecking(true);
    setJava({ status: "checking" });
    setCloudflare({ status: "checking" });

    try {
      // Check Java
      const javaInfo = await invoke<JavaInfo | null>("check_java");
      if (javaInfo) {
        setJava({
          status: "installed",
          version: javaInfo.version,
          path: javaInfo.path,
        });
      } else {
        setJava({ status: "missing" });
      }

      // Check Cloudflare
      const cfInfo = await invoke<AgentInfo | null>("check_tunnel_agent", {
        provider: "cloudflare",
      });
      if (cfInfo && cfInfo.installed) {
        setCloudflare({
          status: "installed",
          version: cfInfo.version || undefined,
          path: cfInfo.path,
        });
      } else {
        setCloudflare({ status: "missing" });
      }
    } catch (error) {
      console.error("Error checking dependencies:", error);
      // If check fails, mark as missing to prompt install
      if (java.status === "checking") {
        setJava({ status: "missing" });
      }
      if (cloudflare.status === "checking") {
        setCloudflare({ status: "missing" });
      }
    } finally {
      setIsChecking(false);
    }
  };

  const installJava = async () => {
    setJava({ status: "installing" });

    try {
      await invoke("install_java_version", { majorVersion: 21 });

      // Re-check after installation
      const javaInfo = await invoke<JavaInfo | null>("check_java");
      if (javaInfo) {
        setJava({
          status: "installed",
          version: javaInfo.version,
          path: javaInfo.path,
        });
      } else {
        setJava({
          status: "error",
          error: t("systemCheck.java.installError"),
        });
      }
    } catch (error) {
      console.error("Error installing Java:", error);
      setJava({
        status: "error",
        error: String(error),
      });
    }
  };

  const installCloudflare = async () => {
    setCloudflare({ status: "installing" });

    try {
      await invoke("install_tunnel_agent", { provider: "cloudflare" });

      // Re-check after installation
      const cfInfo = await invoke<AgentInfo | null>("check_tunnel_agent", {
        provider: "cloudflare",
      });
      if (cfInfo && cfInfo.installed) {
        setCloudflare({
          status: "installed",
          version: cfInfo.version || undefined,
          path: cfInfo.path,
        });
      } else {
        setCloudflare({
          status: "error",
          error: t("systemCheck.cloudflare.installError"),
        });
      }
    } catch (error) {
      console.error("Error installing Cloudflare:", error);
      setCloudflare({
        status: "error",
        error: String(error),
      });
    }
  };

  const skipCloudflare = () => {
    setCloudflareSkipped(true);
  };

  const handleContinue = () => {
    setHasCheckedThisSession(true);
    onComplete();
  };

  // Determine if user can continue
  const canContinue =
    java.status === "installed" &&
    (cloudflare.status === "installed" || cloudflareSkipped);

  // Auto-complete if all is good and nothing is being installed
  useEffect(() => {
    if (!open || isChecking) return;

    const javaOk = java.status === "installed";
    const cfOk = cloudflare.status === "installed" || cloudflareSkipped;

    // If both are good, auto-complete after a brief moment
    if (javaOk && cfOk && java.status !== "checking" && cloudflare.status !== "checking") {
      const timer = setTimeout(() => {
        handleContinue();
      }, 500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isChecking, java.status, cloudflare.status, cloudflareSkipped]);

  if (!open) return null;

  // Show nothing while checking if everything might be installed
  const stillChecking = java.status === "pending" || java.status === "checking" ||
    cloudflare.status === "pending" || cloudflare.status === "checking";

  // Determine if modal should actually show (something is missing)
  const somethingMissing =
    java.status === "missing" ||
    java.status === "error" ||
    java.status === "installing" ||
    (cloudflare.status === "missing" && !cloudflareSkipped) ||
    cloudflare.status === "error" ||
    cloudflare.status === "installing";

  // If still checking, show loading state
  if (stillChecking) {
    return (
      <div className="fixed inset-0 z-60 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Settings2 className="h-8 w-8 text-primary animate-spin" />
          </div>
          <p className="text-muted-foreground">{t("systemCheck.checking")}</p>
        </motion.div>
      </div>
    );
  }

  // If nothing is missing (or cf is skipped), don't show modal
  if (!somethingMissing) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        key="system-check-modal"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-60 flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-secondary/5"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-lg mx-4 rounded-xl border bg-card p-6 shadow-2xl"
        >
          {/* Header */}
          <div className="flex flex-col items-center text-center mb-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-4">
              <Settings2 className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold">{t("systemCheck.title")}</h1>
            <p className="text-muted-foreground mt-1">
              {t("systemCheck.subtitle")}
            </p>
          </div>

          {/* Dependencies */}
          <div className="space-y-4 mb-6">
            {/* Java */}
            <DependencyCard
              name={t("systemCheck.java.name")}
              description={t("systemCheck.java.description")}
              icon={<Coffee className="h-6 w-6 text-amber-600" />}
              isRequired={true}
              status={java.status}
              version={java.version}
              error={java.error}
              onInstall={installJava}
            />

            {/* Cloudflare */}
            {!cloudflareSkipped && (
              <DependencyCard
                name={t("systemCheck.cloudflare.name")}
                description={t("systemCheck.cloudflare.description")}
                icon={<Cloud className="h-6 w-6 text-orange-500" />}
                isRequired={false}
                status={cloudflare.status}
                version={cloudflare.version}
                error={cloudflare.error}
                onInstall={installCloudflare}
                onSkip={skipCloudflare}
              />
            )}
          </div>

          {/* Footer */}
          <div className="flex flex-col items-center gap-2">
            {canContinue ? (
              <div className="flex items-center gap-2 text-green-500 mb-2">
                <Check className="h-5 w-5" />
                <span className="text-sm font-medium">
                  {t("systemCheck.allReady")}
                </span>
              </div>
            ) : java.status !== "installed" ? (
              <p className="text-sm text-muted-foreground mb-2">
                {t("systemCheck.javaRequired")}
              </p>
            ) : null}

            <Button
              size="lg"
              disabled={!canContinue}
              onClick={handleContinue}
              className="w-full"
            >
              {t("systemCheck.continue")}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
