import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

vi.mock("@/lib/api-client", () => ({
  apiClient: { get: vi.fn().mockRejectedValue(new Error("network error")) },
}));

describe("App", () => {
  it("renders the scaffold heading and surfaces an API error", async () => {
    render(<App />);
    expect(screen.getByText("SaaS Platform")).toBeInTheDocument();
    expect(await screen.findByText("API unreachable")).toBeInTheDocument();
  });
});
