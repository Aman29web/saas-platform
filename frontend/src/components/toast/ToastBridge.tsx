import { useEffect } from "react";
import { useToast } from "./toast-context";
import { registerToastNotifier } from "@/lib/toast-bridge";

/** Renders nothing — just wires useToast() into the module-level bridge. */
export function ToastBridge() {
  const { showToast } = useToast();

  useEffect(() => {
    registerToastNotifier(showToast);
    return () => registerToastNotifier(null);
  }, [showToast]);

  return null;
}
