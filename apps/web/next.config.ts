import type { NextConfig } from 'next';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const configDirectory =
  typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(configDirectory, '../..');
const rootEnvironment = resolve(projectRoot, '.env');
if (existsSync(rootEnvironment)) process.loadEnvFile(rootEnvironment);
process.env.AFTERHOURS_PROJECT_ROOT ??= projectRoot;

const config: NextConfig = {
  transpilePackages: ['@afterhours/core'],
  serverExternalPackages: [
    'pg',
    'pg-boss',
    'playwright',
    '@whiskeysockets/baileys',
    'stripe',
    'pdfjs-dist',
  ],
  webpack(webpackConfig, { isServer }) {
    // The shared Node ESM package uses .js imports for its TypeScript sources.
    webpackConfig.resolve.extensionAlias = {
      ...webpackConfig.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    if (isServer) {
      // Keep the Node-only project-directory fallback out of asset resolution.
      webpackConfig.module.rules.push({
        test: /[\\/]packages[\\/]core[\\/]src[\\/]env\.ts$/,
        parser: { url: false },
      });
    }
    return webpackConfig;
  },
  poweredByHeader: false,
};

export default config;
