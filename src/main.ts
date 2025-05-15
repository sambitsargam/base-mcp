import {
  AgentKit,
  basenameActionProvider,
  cdpApiActionProvider,
  cdpWalletActionProvider,
  CdpWalletProvider,
  morphoActionProvider,
  walletActionProvider,
} from '@coinbase/agentkit';
import { getMcpTools } from '@coinbase/agentkit-model-context-protocol';
import { Coinbase } from '@coinbase/coinbase-sdk';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as dotenv from 'dotenv';
import { english, generateMnemonic } from 'viem/accounts';
import { base } from 'viem/chains';
import { Event, postMetric } from './analytics.js';
import { chainIdToCdpNetworkId, chainIdToChain } from './chains.js';
import { baseMcpContractActionProvider } from './tools/contracts/index.js';
import { baseMcpErc20ActionProvider } from './tools/erc20/index.js';
import { baseMcpMorphoActionProvider } from './tools/morpho/index.js';
import { baseMcpNftActionProvider } from './tools/nft/index.js';
import { baseMcpOnrampActionProvider } from './tools/onramp/index.js';
import { openRouterActionProvider } from './tools/open-router/index.js';
import {
  generateSessionId,
  getActionProvidersWithRequiredEnvVars,
} from './utils.js';
import { version } from './version.js';

// Cache for chain configuration
const chainCache = new Map();

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // ms

// Helper function for retry logic
async function withRetry(operation: () => Promise<any>, retries = MAX_RETRIES): Promise<any> {
  try {
    return await operation();
  } catch (error) {
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return withRetry(operation, retries - 1);
    }
    throw error;
  }
}

// Lazy loading helper
const lazyLoad = async <T>(provider: () => Promise<T>): Promise<T> => {
  try {
    return await provider();
  } catch (error) {
    console.error('Error lazy loading provider:', error);
    throw error;
  }
};

export async function main() {
  dotenv.config();
  const apiKeyName =
    process.env.COINBASE_API_KEY_ID || process.env.COINBASE_API_KEY_NAME;
  const privateKey =
    process.env.COINBASE_API_SECRET || process.env.COINBASE_API_PRIVATE_KEY;
  const seedPhrase = process.env.SEED_PHRASE;
  const fallbackPhrase = generateMnemonic(english, 256);
  const chainId = process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : base.id;

  if (!apiKeyName || !privateKey) {
    console.error(
      'Please set COINBASE_API_KEY_NAME and COINBASE_API_PRIVATE_KEY environment variables',
    );
    process.exit(1);
  }

  const sessionId = generateSessionId();
  postMetric(Event.Initialized, {}, sessionId);

  // Use cached chain configuration
  let chain = chainCache.get(chainId);
  if (!chain) {
    chain = chainIdToChain(chainId);
    if (!chain) {
      throw new Error(
        `Unsupported chainId: ${chainId}. Only Base and Base Sepolia are supported.`,
      );
    }
    chainCache.set(chainId, chain);
  }

  // Initialize wallet provider with retry mechanism
  const cdpWalletProvider = await withRetry(async () => 
    CdpWalletProvider.configureWithWallet({
      mnemonicPhrase: seedPhrase ?? fallbackPhrase,
      apiKeyName,
      apiKeyPrivateKey: privateKey,
      networkId: chainIdToCdpNetworkId[chainId],
    })
  );

  // Lazy load action providers
  const actionProviders = [
    await lazyLoad(() => basenameActionProvider()),
    await lazyLoad(() => morphoActionProvider()),
    await lazyLoad(() => walletActionProvider()),
    await lazyLoad(() => 
      cdpWalletActionProvider({
        apiKeyName,
        apiKeyPrivateKey: privateKey,
      })
    ),
    await lazyLoad(() =>
      cdpApiActionProvider({
        apiKeyName,
        apiKeyPrivateKey: privateKey,
      })
    ),
    ...await Promise.all(getActionProvidersWithRequiredEnvVars().map(provider => lazyLoad(() => provider))),
    await lazyLoad(() => baseMcpMorphoActionProvider()),
    await lazyLoad(() => baseMcpContractActionProvider()),
    await lazyLoad(() => baseMcpOnrampActionProvider()),
    await lazyLoad(() => baseMcpErc20ActionProvider()),
    await lazyLoad(() => baseMcpNftActionProvider()),
    await lazyLoad(() => openRouterActionProvider()),
  ];

  const agentKit = await withRetry(async () =>
    AgentKit.from({
      cdpApiKeyName: apiKeyName,
      cdpApiKeyPrivateKey: privateKey,
      walletProvider: cdpWalletProvider,
      actionProviders,
    })
  );

  const { tools, toolHandler } = await getMcpTools(agentKit);

  const server = new Server(
    {
      name: 'Base MCP Server',
      version,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  Coinbase.configure({
    apiKeyName,
    privateKey,
    source: 'Base MCP',
    sourceVersion: version,
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    console.error('Received ListToolsRequest');
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      postMetric(Event.ToolUsed, { toolName: request.params.name }, sessionId);

      if (!seedPhrase) {
        return {
          content: [
            {
              type: 'text',
              text: 'ERROR: Please set SEED_PHRASE environment variable to use wallet-related operations',
            },
          ],
        };
      }

      // Implement retry mechanism for tool execution
      return await withRetry(() => toolHandler(request.params.name, request.params.arguments));
    } catch (error) {
      console.error(`Tool execution error: ${error}`);
      throw new Error(`Tool ${request.params.name} failed: ${error}`);
    }
  });

  const transport = new StdioServerTransport();
  console.error('Connecting server to transport...');
  
  try {
    await withRetry(() => server.connect(transport));
    console.error('Base MCP Server running on stdio');
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}
