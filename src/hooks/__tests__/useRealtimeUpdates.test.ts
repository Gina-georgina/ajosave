/**
 * Tests for useRealtimeUpdates hook
 *
 * Mocks socket.io-client with a controllable fake socket so the hook's
 * connect / message / reconnect / cleanup / offline behavior can be
 * driven without a server.
 */
import { renderHook, act } from "@testing-library/react";
import { useRealtimeUpdates } from "@/hooks/useRealtimeUpdates";
import type { Socket } from "socket.io-client";

// ---------------------------------------------------------------------------
// Fake socket
// ---------------------------------------------------------------------------

type Handler = (...args: unknown[]) => void;

const handlers: Record<string, Handler> = {};
const emitted: Array<{ event: string; args: unknown[] }> = [];

const mockSocket = {
  on: jest.fn((event: string, cb: Handler) => {
    handlers[event] = cb;
    return mockSocket;
  }),
  emit: jest.fn((event: string, ...args: unknown[]) => {
    emitted.push({ event, args });
    return mockSocket;
  }),
  disconnect: jest.fn(),
};

const mockIo = jest.fn(() => mockSocket as unknown as Socket);

jest.mock("socket.io-client", () => ({
  io: (...args: unknown[]) => mockIo(...args),
}));

function fire(event: string, ...args: unknown[]): void {
  const handler = handlers[event];
  if (!handler) throw new Error(`No handler registered for ${event}`);
  handler(...args);
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(handlers)) delete handlers[key];
  emitted.length = 0;
});

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

describe("useRealtimeUpdates — connection", () => {
  it("opens a socket with the expected options", () => {
    renderHook(() => useRealtimeUpdates({}));
    expect(mockIo).toHaveBeenCalledWith({ path: "/api/socket", autoConnect: true });
  });

  it("is disconnected until the connect event fires", () => {
    const { result } = renderHook(() => useRealtimeUpdates({}));
    expect(result.current.isConnected).toBe(false);

    act(() => fire("connect"));
    expect(result.current.isConnected).toBe(true);
  });

  it("authenticates and subscribes to circle and user rooms on connect", () => {
    renderHook(() =>
      useRealtimeUpdates({ circleId: "circle-1", userId: "user-1" })
    );

    act(() => fire("connect"));

    expect(emitted).toEqual(
      expect.arrayContaining([
        { event: "authenticate", args: ["token"] },
        { event: "subscribe:circle", args: ["circle-1"] },
        { event: "subscribe:user", args: ["user-1"] },
      ])
    );
  });

  it("skips room subscriptions when circleId and userId are absent", () => {
    renderHook(() => useRealtimeUpdates({}));
    act(() => fire("connect"));

    const roomEvents = emitted.filter((e) =>
      e.event.startsWith("subscribe:")
    );
    expect(roomEvents).toHaveLength(0);
    expect(emitted).toContainEqual({ event: "authenticate", args: ["token"] });
  });

  it("exposes the socket instance", () => {
    const { result } = renderHook(() => useRealtimeUpdates({}));
    expect(result.current.socket).toBe(mockSocket);
  });
});

// ---------------------------------------------------------------------------
// Disconnect / offline / reconnect
// ---------------------------------------------------------------------------

describe("useRealtimeUpdates — disconnect and reconnect", () => {
  it("marks offline when the server disconnects", () => {
    const { result } = renderHook(() => useRealtimeUpdates({}));
    act(() => fire("connect"));
    expect(result.current.isConnected).toBe(true);

    act(() => fire("disconnect"));
    expect(result.current.isConnected).toBe(false);
  });

  it("reconnects cleanly after a disconnect", () => {
    const { result } = renderHook(() => useRealtimeUpdates({}));
    act(() => fire("connect"));
    act(() => fire("disconnect"));
    expect(result.current.isConnected).toBe(false);

    act(() => fire("connect"));
    expect(result.current.isConnected).toBe(true);
  });

  it("surfaces server errors and clears them on reconnect", () => {
    const { result } = renderHook(() => useRealtimeUpdates({}));

    act(() => fire("error", { message: "boom" }));
    expect(result.current.error).toBe("boom");

    act(() => fire("connect"));
    expect(result.current.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Event delivery
// ---------------------------------------------------------------------------

describe("useRealtimeUpdates — event delivery", () => {
  it("invokes the contribution:confirmed callback with the payload", () => {
    const onContributionConfirmed = jest.fn();
    renderHook(() => useRealtimeUpdates({ onContributionConfirmed }));

    const payload = { circleId: "c1", amount: "10", userId: "u1" };
    act(() => fire("contribution:confirmed", payload));

    expect(onContributionConfirmed).toHaveBeenCalledWith(payload);
  });

  it("invokes the payout:processed callback with the payload", () => {
    const onPayoutProcessed = jest.fn();
    renderHook(() => useRealtimeUpdates({ onPayoutProcessed }));

    const payload = { circleId: "c1", amount: "50", txHash: "abc" };
    act(() => fire("payout:processed", payload));

    expect(onPayoutProcessed).toHaveBeenCalledWith(payload);
  });

  it("invokes the circle:completed callback with the payload", () => {
    const onCircleCompleted = jest.fn();
    renderHook(() => useRealtimeUpdates({ onCircleCompleted }));

    const payload = { circleId: "c1" };
    act(() => fire("circle:completed", payload));

    expect(onCircleCompleted).toHaveBeenCalledWith(payload);
  });

  it("invokes the circle:started callback with the payload", () => {
    const onCircleStarted = jest.fn();
    renderHook(() => useRealtimeUpdates({ onCircleStarted }));

    const payload = { circleId: "c1", memberCount: 10 };
    act(() => fire("circle:started", payload));

    expect(onCircleStarted).toHaveBeenCalledWith(payload);
  });

  it("invokes the chat:message callback with the payload", () => {
    const onChatMessage = jest.fn();
    renderHook(() => useRealtimeUpdates({ onChatMessage }));

    const payload = { circleId: "c1", messageId: "m1", body: "hi" };
    act(() => fire("chat:message", payload));

    expect(onChatMessage).toHaveBeenCalledWith(payload);
  });

  it("does not register event callbacks that were not provided", () => {
    renderHook(() =>
      useRealtimeUpdates({ onContributionConfirmed: jest.fn() })
    );
    // Only the provided callback is registered; the others must be absent.
    expect(handlers["payout:processed"]).toBeUndefined();
    expect(handlers["circle:completed"]).toBeUndefined();
    expect(handlers["circle:started"]).toBeUndefined();
    expect(handlers["chat:message"]).toBeUndefined();
    expect(typeof handlers["contribution:confirmed"]).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Re-subscription and cleanup
// ---------------------------------------------------------------------------

describe("useRealtimeUpdates — re-subscription and cleanup", () => {
  it("reconnects with new subscriptions when circleId changes", () => {
    const { rerender } = renderHook(
      ({ circleId }: { circleId?: string }) => useRealtimeUpdates({ circleId }),
      { initialProps: { circleId: "circle-1" } }
    );

    act(() => fire("connect"));
    expect(emitted).toContainEqual({
      event: "subscribe:circle",
      args: ["circle-1"],
    });

    // Changing the dependency tears the old socket down and opens a new one.
    rerender({ circleId: "circle-2" });
    expect(mockSocket.disconnect).toHaveBeenCalledTimes(1);

    for (const key of Object.keys(handlers)) delete handlers[key];
    emitted.length = 0;
    act(() => fire("connect"));
    expect(emitted).toContainEqual({
      event: "subscribe:circle",
      args: ["circle-2"],
    });
    expect(mockIo).toHaveBeenCalledTimes(2);
  });

  it("unsubscribes and disconnects on unmount", () => {
    const { unmount } = renderHook(() =>
      useRealtimeUpdates({ circleId: "circle-1" })
    );

    unmount();

    expect(emitted).toContainEqual({
      event: "unsubscribe:circle",
      args: ["circle-1"],
    });
    expect(mockSocket.disconnect).toHaveBeenCalledTimes(1);
  });

  it("does not emit an unsubscribe when no circleId was set", () => {
    const { unmount } = renderHook(() => useRealtimeUpdates({}));
    unmount();

    const unsubscribes = emitted.filter((e) =>
      e.event.startsWith("unsubscribe:")
    );
    expect(unsubscribes).toHaveLength(0);
    expect(mockSocket.disconnect).toHaveBeenCalledTimes(1);
  });
});
