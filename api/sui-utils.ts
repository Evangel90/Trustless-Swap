import { SuiGraphQLClient } from '@mysten/sui/graphql';

type Network = 'mainnet' | 'testnet';

// Network-to-URL mapping for GraphQL endpoints
const GRAPHQL_URLS: Record<Network, string> = {
  mainnet: 'https://sui-mainnet.mystenlabs.com/graphql',
  testnet: 'https://graphql.testnet.sui.io/graphql',
};

export const getClient = (network: Network): SuiGraphQLClient => {
  return new SuiGraphQLClient({
    url: GRAPHQL_URLS[network],
    network,
  });
};