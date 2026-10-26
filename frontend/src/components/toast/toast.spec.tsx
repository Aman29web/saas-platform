import { describe, expect, it } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { ToastProvider } from "./toast-context";
import { ToastViewport } from "./ToastViewport";
import { ToastBridge } from "./ToastBridge";
import { notifyToast } from "@/lib/toast-bridge";

function renderWithProvider() {
  return render(
    <ToastProvider>
      <ToastBridge />
      <ToastViewport />
    </ToastProvider>,
  );
}

describe("toast system", () => {
  it("notifyToast (the module-level bridge the api client uses) surfaces a toast without needing React context at the call site", async () => {
    renderWithProvider();

    act(() => notifyToast("Something failed", "error"));

    await waitFor(() => expect(screen.getByText("Something failed")).toBeInTheDocument());
  });

  it("dismissing a toast removes it", async () => {
    renderWithProvider();
    act(() => notifyToast("dismiss me"));

    await waitFor(() => expect(screen.getByText("dismiss me")).toBeInTheDocument());
    act(() => screen.getByLabelText("Dismiss").click());

    await waitFor(() => expect(screen.queryByText("dismiss me")).not.toBeInTheDocument());
  });
});
