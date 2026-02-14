import type { NextConfig } from 'next';
import path from 'path';

const sharedResolveAlias = {
  '@react-native-async-storage/async-storage': './lib/shims/async-storage.ts',
  'pino-pretty': './lib/shims/pino-pretty.ts',
};

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
  turbopack: {
    resolveAlias: sharedResolveAlias,
  },
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      ...sharedResolveAlias,
    };
    return config;
  },
};

export default nextConfig;
