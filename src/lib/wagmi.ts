"use client";

import { http, createConfig } from "wagmi";
import { arbitrum, base, gnosis, mainnet, optimism } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const wagmiConfig = createConfig({
  chains: [gnosis, mainnet, arbitrum, optimism, base],
  connectors: [injected()],
  ssr: true,
  transports: {
    [arbitrum.id]: http(),
    [base.id]: http(),
    [gnosis.id]: http(),
    [mainnet.id]: http(),
    [optimism.id]: http(),
  },
});
