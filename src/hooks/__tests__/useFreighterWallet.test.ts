/**
 * Tests for useFreighterWallet hook
 *
 * Mocks the @stellar/freighter-api module (the extension bridge) and
 * exercises connect / disconnect / reconnect / not-installed / mismatch
 * paths through renderHook.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { useFreighterWallet } from "@/hooks/useFreighterWallet";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockIsConnected = jest.fn();
const mockRequestAccess = jest.fn();
const mockGetNetwork = jest.fn();

jest.mock("@stellar/freighter-api", () => ({
  isConnected: () => mockIsConnected(),
  requestAccess: () => mockRequestAccess(),
  getNetwork: () => mockGetNetwork(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAddress(prefix: string): string {
  // Valid Stellar public key shape: starts with 'G', 56 chars total.
  return (prefix + "X".repeat(56)).slice(0, 56);
}

const VALID_ADDRESS = makeAddress("GA");

beforeEach(() => {
  jest.clearAllMocks();
  mockIsConnected.mockResolvedValue({ isConnected: true });
  mockRequestAccess.mockResolvedValue({ address: VALID_ADDRESS, error: "" });
  mockGetNetwork.mockResolvedValue({ network: "PUBLIC", error: "" });
});

// ---------------------------------------------------------------------------
// Extension detection
// ---------------------------------------------------------------------------

describe("useFreighterWallet — extension detection", () => {
  it("starts in not_installed until detection resolves", () => {
    mockIsConnected.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useFreighterWallet());
    expect(result.current.connectionState).toBe("not_installed");
  });

  it("detects the extension and settles in disconnected", async () => {
    const { result } = renderHook(() => useFreighterWallet());
    await waitFor(() =>
      expect(result.current.connectionState).toBe("disconnected")
    );
  });

  it("stays not_installed when the extension is absent", async () => {
    mockIsConnected.mockResolvedValue({ isConnected: false });
    const { result } = renderHook(() => useFreighterWallet());
    await waitFor(() =>
      expect(result.current.connectionState).toBe("not_installed")
    );
  });

  it("falls back to not_installed when isConnected() throws", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockIsConnected.mockRejectedValue(new Error("extension missing"));
    const { result } = renderHook(() => useFreighterWallet());
    await waitFor(() =>
      expect(result.current.connectionState).toBe("not_installed")
    );
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// connect()
// ---------------------------------------------------------------------------

describe("useFreighterWallet — connect", () => {
  it("connects successfully with a valid key on PUBLIC", async () => {
    const { result } = renderHook(() => useFreighterWallet());
    await waitFor(() =>
      expect(result.current.connectionState).toBe("disconnected")
    );

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.connectionState).toBe("connected");
    expect(result.current.publicKey).toBe(VALID_ADDRESS);
    expect(result.current.error).toBeNull();
    expect(mockRequestAccess).toHaveBeenCalledTimes(1);
    expect(mockGetNetwork).toHaveBeenCalledTimes(1);
  });

  it("passes through connecting state while awaiting approval", async () => {
    let resolveAccess!: (v: { address: string; error: string }) => void;
    mockRequestAccess.mockReturnValue(
      new Promise((res) => {
        resolveAccess = res;
      })
    );

    const { result } = renderHook(() => useFreighterWallet());
    await waitFor(() =>
      expect(result.current.connectionState).toBe("disconnected")
    );

    act(() => {
      void result.current.connect();
    });
    expect(result.current.connectionState).toBe("connecting");

    await act(async () => {
      resolveAccess({ address: VALID_ADDRESS, error: "" });
      await Promise.resolve();
    });
    expect(result.current.connectionState).toBe("connected");
  });

  it("handles a rejected connection request", async () => {
    mockRequestAccess.mockResolvedValue({
      address: "",
      error: "User rejected the request",
    });
    const { result } = renderHook(() => useFreighterWallet());
    await waitFor(() =>
      expect(result.current.connectionState).toBe("disconnected")
    );

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.connectionState).toBe("disconnected");
    expect(result.current.error).toMatch(/rejected/i);
    expect(result.current.publicKey).toBeNull();
  });

  it("handles a locked wallet", async () => {
    mockRequestAccess.mockResolvedValue({
      address: "",
      error: "Freighter is locked",
    });
    const { result } = renderHook(() => useFreighterWallet());
    await waitFor(() =>
      expect(result.current.connectionState).toBe("disconnected")
    );

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.error).toMatch(/locked/i);
    expect(result.current.connectionState).toBe("disconnected");
  });

  it("maps unknown requestAccess errors to a generic message", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockRequestAccess.mockResolvedValue({
      address: "",
      error: "something exotic happened",
    });
    const { result } = renderHook(() => useFreighterWallet());
    await waitFor(() =>
      expect(result.current.connectionState).toBe("disconnected")
    );

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.error).toMatch(/unexpected/i);
    expect(result.current.connectionState).toBe("disconnected");
    spy.mockRestore();
  });

  it("rejects an address that is not a valid Stellar public key", async () => {
    mockRequestAccess.mockResolvedValue({ address: "GSHORT", error: "" });
    const { result } = renderHook(() => useFreighterWallet());
    await waitFor(() =>
      expect(result.current.connectionState).toBe("disconnected")
    );

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.error).toMatch(/not a valid Stellar public key/i);
    expect(result.current.connectionState).toBe("disconnected");
    expect(result.current.publicKey).toBeNull();
  });

  it("rejects an address that does not start with G", async () => {
    mockRequestAccess.mockResolvedValue({
      address: "B" + "X".repeat(55),
      error: "",
    });
    const { result } = renderHook(() => useFreighterWallet());
    await waitFor(() =>
      expect(result.current.connectionState).toBe("disconnected")
    );

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.error).toMatch(/not a valid Stellar public key/i);
  });

  it("reports a network mismatch when Freighter is not on PUBLIC", async () => {
    mockGetNetwork.mockResolvedValue({ network: "TESTENET", error: "" });
    const { result } = renderHook(() => useFreighterWallet());
    await waitFor(() =>
      expect(result.current.connectionState).toBe("disconnected")
    );

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.connectionState).toBe("disconnected");
    expect(result.current.error).toMatch(/TESTENET/);
    expect(result.current.error).toMatch(/Pubnet/);
    expect(result.current.publicKey).toBeNull();
  });

  it("reports unknown network when getNetwork errors without a name", async () => {
    mockGetNetwork.mockResolvedValue({ network: "", error: "boom" });
    const { result } = renderHook(() => useFreighterWallet());
    await waitFor(() =>
      expect(result.current.connectionState).toBe("disconnected")
    );

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.error).toMatch(/unknown/);
    expect(result.current.connectionState).toBe("disconnected");
  });

  it("handles requestAccess throwing unexpectedly", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockRequestAccess.mockRejectedValue(new Error("bridge crashed"));
    const { result } = renderHook(() => useFreighterWallet());
    await waitFor(() =>
      expect(result.current.connectionState).toBe("disconnected")
    );

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.connectionState).toBe("disconnected");
    expect(result.current.error).toMatch(/unexpected/i);
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// disconnect() and reconnect
// ---------------------------------------------------------------------------

describe("useFreighterWallet — disconnect and reconnect", () => {
  it("disconnect clears the public key and error", async () => {
    const { result } = renderHook(() => useFreighterWallet());
    await waitFor(() =>
      expect(result.current.connectionState).toBe("disconnected")
    );

    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.connectionState).toBe("connected");

    act(() => {
      result.current.disconnect();
    });

    expect(result.current.connectionState).toBe("disconnected");
    expect(result.current.publicKey).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("reconnects after a disconnect", async () => {
    const { result } = renderHook(() => useFreighterWallet());
    await waitFor(() =>
      expect(result.current.connectionState).toBe("disconnected")
    );

    await act(async () => {
      await result.current.connect();
    });
    act(() => {
      result.current.disconnect();
    });

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.connectionState).toBe("connected");
    expect(result.current.publicKey).toBe(VALID_ADDRESS);
    expect(mockRequestAccess).toHaveBeenCalledTimes(2);
  });

  it("clears a previous error on a successful reconnect", async () => {
    mockRequestAccess.mockResolvedValueOnce({
      address: "",
      error: "User rejected the request",
    });
    const { result } = renderHook(() => useFreighterWallet());
    await waitFor(() =>
      expect(result.current.connectionState).toBe("disconnected")
    );

    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.error).toBeTruthy();

    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.connectionState).toBe("connected");
  });
});
