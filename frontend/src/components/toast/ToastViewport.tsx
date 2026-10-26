import { useToast, type ToastVariant } from "./toast-context";

const variantClasses: Record<ToastVariant, string> = {
  info: "bg-slate-900 text-white",
  success: "bg-green-600 text-white",
  error: "bg-red-600 text-white",
};

export function ToastViewport() {
  const { toasts, dismissToast } = useToast();

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`${variantClasses[toast.variant]} flex items-center gap-3 rounded-md px-4 py-3 text-sm shadow-lg`}
        >
          <span>{toast.message}</span>
          <button onClick={() => dismissToast(toast.id)} aria-label="Dismiss" className="opacity-70 hover:opacity-100">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
