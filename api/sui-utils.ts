import { SuiGraphQLClient } from '@mysten/sui/graphql';

type Network = 'mainnet' | 'testnet' | 'devnet' | 'localnet';

// Network-to-URL mapping for GraphQL endpoints
const GRAPHQL_URLS: Record<Network, string> = {
  mainnet: 'https://sui-mainnet.mystenlabs.com/graphql',
  testnet: 'https://sui-testnet.mystenlabs.com/graphql',
  devnet: 'https://sui-devnet.mystenlabs.com/graphql',
  localnet: 'http://127.0.0.1:9125/graphql',
};

export const getClient = (network: Network): SuiGraphQLClient => {
  return new SuiGraphQLClient({
    url: GRAPHQL_URLS[network],
    network,
  });
};