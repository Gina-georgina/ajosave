import { mintCertificate, getCertificatesByUser } from "@/server/services/certificate.service";
import * as db from "@/lib/db";

jest.mock("@/lib/db", () => ({ query: jest.fn() }));
jest.mock("@/lib/logger", () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));
jest.mock("@stellar/stellar-sdk", () => ({
  contract: { Client: { from: jest.fn() }, basicNodeSigner: jest.fn(() => ({})) },
  Keypair: { fromSecret: jest.fn(() => ({ publicKey: () => "GADMIN" })) },
  Networks: { PUBLIC: "Public Global Stellar Network ; September 2015", TESTNET: "Test SDF Network ; September 2015" },
}));
jest.mock("@/server/config", () => ({
  serverConfig: {
    stellar: {
      network: "testnet",
      certificateContractId: "CTEST123",
      serverSecretKey: "STEST",
      sorobanRpcUrl: "https://soroban-testnet.stellar.org",
    },
  },
}));

const mockQuery = db.query as jest.MockedFunction<typeof db.query>;

const PARAMS = {
  memberStellarKey: "GMEMBER123",
  circleId: "aaaabbbb-cccc-dddd-eeee-ffffaaaabbbb",
  circleName: "Test Circle",
  cyclesCompleted: 3,
  totalSavedUsdc: "300.0000000",
};

beforeEach(() => jest.clearAllMocks());

describe("mintCertificate", () => {
  it("persists to DB after successful on-chain mint", async () => {
    const mockSend = jest.fn().mockResolvedValue({ hash: "TX123" });
    const mockAssembled = { send: mockSend };
    const mockClient = { mint: jest.fn().mockResolvedValue(mockAssembled) };
    const { contract } = require("@stellar/stellar-sdk");
    contract.Client.from.mockResolvedValue(mockClient);
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as any);

    await mintCertificate(PARAMS);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO certificates"),
      expect.arrayContaining([PARAMS.circleId, PARAMS.circleName, PARAMS.memberStellarKey, 3, "300.0000000", "TX123"])
    );
  });

  it("still persists to DB even if on-chain mint throws", async () => {
    const { contract } = require("@stellar/stellar-sdk");
    contract.Client.from.mockResolvedValue({ mint: jest.fn().mockRejectedValue(new Error("RPC down")) });
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as any);

    await mintCertificate(PARAMS);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO certificates"),
      expect.arrayContaining([PARAMS.circleId, PARAMS.memberStellarKey])
    );
  });

  it("skips everything when no contract ID configured", async () => {
    const { contract } = require("@stellar/stellar-sdk");
    const mockFrom = jest.fn();
    contract.Client.from = mockFrom;

    // Temporarily clear the contract ID via the config mock
    const config = require("@/server/config");
    const original = config.serverConfig.stellar.certificateContractId;
    Object.defineProperty(config.serverConfig.stellar, "certificateContractId", { value: "", configurable: true });

    await mintCertificate(PARAMS);

    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();

    Object.defineProperty(config.serverConfig.stellar, "certificateContractId", { value: original, configurable: true });
  });
});

describe("getCertificatesByUser", () => {
  it("returns mapped certificates for a stellar key", async () => {
    mockQuery.mockResolvedValue({
      rows: [{
        circle_id: "cid1", circle_name: "My Circle", member_stellar_key: "GMEMBER",
        token_id: "a".repeat(64),
        cycles_completed: 4, total_saved_usdc: "400.0000000", tx_hash: "TXABC", issued_at: new Date("2025-01-01"),
      }],
      rowCount: 1,
    } as any);

    const result = await getCertificatesByUser("GMEMBER");

    expect(result).toEqual([{
      circleId: "cid1", circleName: "My Circle", memberAddress: "GMEMBER",
      tokenId: "a".repeat(64),
      cyclesCompleted: 4, totalSavedUsdc: "400.0000000", txHash: "TXABC",
      verificationUrl: "https://stellar.expert/explorer/testnet/tx/TXABC",
      issuedAt: new Date("2025-01-01"),
    }]);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE member_stellar_key = $1"),
      ["GMEMBER"]
    );
  });

  it("returns empty array when no certificates found", async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as any);
    const result = await getCertificatesByUser("GNONE");
    expect(result).toEqual([]);
  });
});
