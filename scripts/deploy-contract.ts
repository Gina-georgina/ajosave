#!/usr/bin/env ts-node
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const network = process.env.STELLAR_NETWORK ?? "testnet";
const rpcUrl =
  network === "mainnet" ? "https://soroban-rpc.stellar.org" : "https://soroban-testnet.stellar.org";
const passphrase =
  network === "mainnet"
    ? "Public Global Stellar Network ; September 2015"
    : "Test SDF Network ; September 2015";

const wasmPath = path.resolve(
  __dirname,
  "../contracts/target/wasm32-unknown-unknown/release/stellar_ajo.wasm"
);

if (!fs.existsSync(wasmPath)) {
  console.error("WASM not found. Run `npm run contract:build` first.");
  process.exit(1);
}

console.log(`Deploying Ajo contract to ${network}…`);

const result = execSync(
  `stellar contract deploy \
    --wasm ${wasmPath} \
    --source ${process.env.STELLAR_SERVER_SECRET_KEY} \
    --rpc-url ${rpcUrl} \
    --network-passphrase "${passphrase}"`,
  { encoding: "utf-8" }
);

const contractId = result.trim();
console.log(`✅ Contract deployed: ${contractId}`);
console.log(`Add to .env: STELLAR_AJO_CONTRACT_ID=${contractId}`);
