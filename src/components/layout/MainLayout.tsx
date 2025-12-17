import { Outlet } from "react-router-dom"
import { TitleBar } from "./TitleBar"
import { Sidebar } from "./Sidebar"
import { InstallationFooter } from "@/components/notifications/InstallationFooter"
import { useInstallationStore } from "@/stores/installationStore"

export function MainLayout() {
  const hasActiveInstallations = useInstallationStore(
    (state) => state.hasActiveInstallations
  )

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Custom title bar */}
      <TitleBar />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar />

        {/* Page content - pages manage their own scroll internally */}
        {/* Add bottom padding when installation footer is visible */}
        <main
          className="flex-1 flex flex-col p-6 overflow-hidden transition-[padding] duration-300"
          style={{ paddingBottom: hasActiveInstallations() ? "6rem" : "1.5rem" }}
        >
          <Outlet />
        </main>
      </div>

      {/* Global installation progress footer */}
      <InstallationFooter />
    </div>
  )
}
