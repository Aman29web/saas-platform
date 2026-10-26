import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

vi.mock("@/lib/error-tracking", () => ({ reportError: vi.fn() }));

function Bomb(): never {
  throw new Error("boom");
}

describe("ErrorBoundary", () => {
  it("renders children normally when nothing throws", () => {
    render(
      <ErrorBoundary>
        <div>all good</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("all good")).toBeInTheDocument();
  });

  it("renders a fallback UI instead of crashing when a child throws", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it("'Try again' resets the boundary so a subsequent clean render recovers", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let shouldThrow = true;
    function MaybeThrows() {
      if (shouldThrow) throw new Error("boom");
      return <div>recovered</div>;
    }

    const { rerender } = render(
      <ErrorBoundary>
        <MaybeThrows />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByText("Try again"));
    rerender(
      <ErrorBoundary>
        <MaybeThrows />
      </ErrorBoundary>,
    );
    expect(screen.getByText("recovered")).toBeInTheDocument();
    consoleSpy.mockRestore();
  });
});
