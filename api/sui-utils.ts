import { getFullnodeUrl, SuiClient } from '@mysten/sui.js/client'

type Network = 'mainnet' | 'testnet';

export const getClient = (network: Network): SuiClient => {
  return new SuiClient({
    url: getFullnodeUrl(network),
  });

}
