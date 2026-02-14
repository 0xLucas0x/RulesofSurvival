'use client';

import type { ReactNode } from 'react';
import { EthereumWalletConnectors } from '@dynamic-labs/ethereum';
import { DynamicContextProvider } from '@dynamic-labs/sdk-react-core';

type DynamicWalletProviderProps = {
  children: ReactNode;
};

const dynamicEnvironmentId = process.env.NEXT_PUBLIC_DYNAMIC_ENV_ID || 'MISSING_DYNAMIC_ENV_ID';
const hasDynamicEnv = dynamicEnvironmentId !== 'MISSING_DYNAMIC_ENV_ID';

export function DynamicWalletProvider({ children }: DynamicWalletProviderProps) {
  if (!hasDynamicEnv) {
    return <>{children}</>;
  }

  return (
    <DynamicContextProvider
      settings={{
        environmentId: dynamicEnvironmentId,
        walletConnectors: [EthereumWalletConnectors],
        initialAuthenticationMode: 'connect-only',
        socialProvidersFilter: () => [],
        useMetamaskSdk: false,
      }}
    >
      {children}
    </DynamicContextProvider>
  );
}
