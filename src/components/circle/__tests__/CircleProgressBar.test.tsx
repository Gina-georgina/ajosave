import { render, screen } from "@testing-library/react";
import { CircleProgressBar } from "../CircleProgressBar";

describe("CircleProgressBar", () => {
  it("renders the progress bar region", () => {
    render(
      <CircleProgressBar currentCycle={3} totalCycles={8} status="active" />
    );
    expect(
      screen.getByRole("progressbar", { name: /rotation progress/i })
    ).toBeInTheDocument();
  });

  it("reports correct aria-valuenow for mid-rotation", () => {
    // cycle 3 of 8 → 2 completed → 25%
    render(
      <CircleProgressBar currentCycle={3} totalCycles={8} status="active" />
    );
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "25");
  });

  it("reports 100% when status is completed", () => {
    render(
      <CircleProgressBar currentCycle={8} totalCycles={8} status="completed" />
    );
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "100");
  });

  it("reports 0% when circle has not started (cycle 0)", () => {
    render(
      <CircleProgressBar currentCycle={0} totalCycles={5} status="open" />
    );
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "0");
  });

  it("renders correct fill width via inline style", () => {
    render(
      <CircleProgressBar currentCycle={3} totalCycles={8} status="active" />
    );
    const fill = screen.getByTestId("cpb-fill");
    expect(fill).toHaveStyle({ width: "25%" });
  });

  it("renders 100% fill width when completed", () => {
    render(
      <CircleProgressBar currentCycle={5} totalCycles={5} status="completed" />
    );
    const fill = screen.getByTestId("cpb-fill");
    expect(fill).toHaveStyle({ width: "100%" });
  });

  it("shows cycle text label", () => {
    render(
      <CircleProgressBar currentCycle={2} totalCycles={6} status="active" />
    );
    const matches = screen.getAllByText(/cycle 2 of 6/i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("shows 'All cycles completed' text when done", () => {
    render(
      <CircleProgressBar currentCycle={4} totalCycles={4} status="completed" />
    );
    const matches = screen.getAllByText(/all cycles completed/i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("shows 'Not started' for cycle 0", () => {
    render(
      <CircleProgressBar currentCycle={0} totalCycles={4} status="open" />
    );
    const matches = screen.getAllByText(/not started/i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("renders step dots for reasonable cycle counts", () => {
    render(
      <CircleProgressBar currentCycle={2} totalCycles={5} status="active" />
    );
    // 5 step dots should be rendered (aria-hidden)
    const stepsRow = document.querySelector(
      '[class*="stepsRow"]'
    ) as HTMLElement | null;
    expect(stepsRow).toBeTruthy();
    const dots = document.querySelectorAll('[class*="stepDot"]');
    expect(dots.length).toBe(5);
  });

  it("returns null when totalCycles is 0", () => {
    const { container } = render(
      <CircleProgressBar currentCycle={0} totalCycles={0} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("matches snapshot", () => {
    const { container } = render(
      <CircleProgressBar currentCycle={3} totalCycles={8} status="active" />
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});
