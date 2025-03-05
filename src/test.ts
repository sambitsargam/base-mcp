import { Coinbase, TransferStatus } from "@coinbase/coinbase-sdk";
import { Wallet } from "@coinbase/coinbase-sdk";
import * as dotenv from "dotenv";

async function main() {
  dotenv.config();
  const apiKeyName = process.env.COINBASE_API_KEY_NAME;
  const privateKey = process.env.COINBASE_API_PRIVATE_KEY;
  const seedPhrase = process.env.SEED_PHRASE;

  if (!apiKeyName || !privateKey || !seedPhrase) {
    console.error(
      "Please set COINBASE_API_KEY_NAME, COINBASE_API_PRIVATE_KEY, and SEED_PHRASE environment variables",
    );
    process.exit(1);
  }

  Coinbase.configure({ apiKeyName, privateKey });
  // Initialize wallet with seed phrase
  const wallet = await Wallet.import({
    mnemonicPhrase: seedPhrase,
    networkId: "base-sepolia",
  });

  const all = await wallet.listAddresses();
  console.log(" all:", all);

  const address = await wallet.getDefaultAddress();
  console.log(" address:", address.getId());

  const transfer = await wallet.createTransfer({
    destination: "0x9E95f497a7663B70404496dB6481c890C4825fe1",
    amount: 0.0001,
    assetId: Coinbase.assets.Eth,
  });

  await transfer.wait();

  if (transfer.getStatus() === TransferStatus.COMPLETE) {
    console.log("Transfer completed");
    console.log(transfer.toString());
  } else {
    console.log("Transfer failed");
    console.log(transfer.toString());
  }
}

main().catch(console.error);
