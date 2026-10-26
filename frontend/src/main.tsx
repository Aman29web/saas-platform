import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/toast/toast-context";
import { ToastViewport } from "./components/toast/ToastViewport";
import { ToastBridge } from "./components/toast/ToastBridge";
import { reportError } from "./lib/error-tracking";
import "./index.css";

window.addEventListener("error", (event) => reportError(event.error));
window.addEventListener("unhandledrejection", (event) => reportError(event.reason));

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <ToastBridge />
        <App />
        <ToastViewport />
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
