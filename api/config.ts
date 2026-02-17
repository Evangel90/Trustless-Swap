import dotenv from 'dotenv';
dotenv.config();

export const CONFIG = {
  // Replace with your deployed package ID
  SWAP_CONTRACT: {
    packageId: process.env.PACKAGE_ID,
  },

  // Which network to connect to: 'mainnet' | 'testnet' | 'devnet' | 'localnet'
  NETWORK: 'testnet' as const,

  // How long to wait between polls when there are no new events (ms)
  POLLING_INTERVAL_MS: 3000,
};