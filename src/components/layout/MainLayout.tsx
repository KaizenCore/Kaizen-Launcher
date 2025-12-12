import { Outlet } from "react-router-dom"
import { TitleBar } from "./TitleBar"
import { Sidebar } from "./Sidebar"
import { InstallationNotification } from "@/components/notifications/InstallationNotification"

export function MainLayout() {
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Custom title bar */}
      <TitleBar />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar />

        {/* Page content - use flex and overflow-auto for scrollable content, pages can override with overflow-hidden if needed */}
        <main className="flex-1 flex flex-col p-6 overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* Global installation progress notification */}
      <InstallationNotification />
    </div>
  )
}
