import { SuiGrpcClient } from '@mysten/sui/grpc';

type Network = 'mainnet' | 'testnet' | 'devnet' | 'localnet';

// Network-to-URL mapping for gRPC endpoints
const GRPC_URLS: Record<Network, string> = {
  mainnet: 'https://fullnode.mainnet.sui.io:443',
  testnet: 'https://fullnode.testnet.sui.io:443',
  devnet: 'https://fullnode.devnet.sui.io:443',
  localnet: 'http://127.0.0.1:9000',
};

export const getClient = (network: Network): SuiGrpcClient => {
  return new SuiGrpcClient({
    network,
    baseUrl: GRPC_URLS[network],
  });
};