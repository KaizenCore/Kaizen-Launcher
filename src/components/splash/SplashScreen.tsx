import { motion } from "framer-motion";
import { Progress } from "@/components/ui/progress";

interface SplashScreenProps {
  progress: number;
  message?: string;
}

export function SplashScreen({ progress, message }: SplashScreenProps) {
  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background"
    >
      {/* Logo */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="mb-8"
      >
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <img
              src="/kaizen.png"
              alt="Kaizen"
              className="h-24 w-24 object-contain"
            />
            <motion.div
              className="absolute inset-0 rounded-full bg-primary/20"
              animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0, 0.3] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold">Kaizen</h1>
            <p className="text-sm text-muted-foreground">Launcher</p>
          </div>
        </div>
      </motion.div>

      {/* Progress bar */}
      <div className="w-64 space-y-2">
        <Progress value={progress} className="h-1.5" />
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center text-sm text-muted-foreground"
        >
          {message || "Loading..."}
        </motion.p>
      </div>
    </motion.div>
  );
}
