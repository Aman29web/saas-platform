import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/toast/toast-context";
import { ToastViewport } from "./components/toast/ToastViewport";
import { ToastBridge } from "./components/toast/ToastBridge";
import { reportError } from "./lib/error-tracking";
import { queryClient } from "./lib/query-client";
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
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
        <ToastViewport />
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
