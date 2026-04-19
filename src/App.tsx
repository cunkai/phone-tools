import React, { Suspense, lazy } from "react";
import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import ErrorBoundary from "./components/ErrorBoundary";
import LoadingSpinner from "./components/LoadingSpinner";

const HomePage = lazy(() => import("./pages/HomePage"));
const InstallPage = lazy(() => import("./pages/InstallPage"));
const AppsPage = lazy(() => import("./pages/AppsPage"));
const ToolsPage = lazy(() => import("./pages/ToolsPage"));
const DeviceInfoPage = lazy(() => import("./pages/DeviceInfoPage"));
const DeviceControlPage = lazy(() => import("./pages/DeviceControlPage"));
const FpsMonitorPage = lazy(() => import("./pages/FpsMonitorPage"));
const TerminalPage = lazy(() => import("./pages/TerminalPage"));
const AutomationPage = lazy(() => import("./pages/AutomationPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-screen bg-dark-950">
            <LoadingSpinner size="lg" />
          </div>
        }
      >
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/install" element={<InstallPage />} />
            <Route path="/install/:filePath" element={<InstallPage />} />
            <Route path="/apps" element={<AppsPage />} />
            <Route path="/tools" element={<ToolsPage />} />
            <Route path="/monitor" element={<DeviceInfoPage />} />
            <Route path="/control" element={<DeviceControlPage />} />
            <Route path="/fps" element={<FpsMonitorPage />} />
            <Route path="/terminal" element={<TerminalPage />} />
            <Route path="/automation" element={<AutomationPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
};

export default App;
