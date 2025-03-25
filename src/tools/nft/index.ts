import { generateTool } from '../../utils.js';
import { listNftsHandler, transferNftHandler } from './handlers.js';
import { ListNftsSchema, TransferNftSchema } from './schemas.js';

// Re-export utility functions for use elsewhere in the codebase
export {
  fetchNftsFromAlchemy,
  formatNftData,
  detectNftStandard,
  transferNft,
} from './utils.js';

export const listNftsTool = generateTool({
  name: 'list_nfts',
  description: 'List NFTs owned by a specific address',
  inputSchema: ListNftsSchema,
  toolHandler: listNftsHandler,
});

export const transferNftTool = generateTool({
  name: 'transfer_nft',
  description: 'Transfer an NFT to another address',
  inputSchema: TransferNftSchema,
  toolHandler: transferNftHandler,
});
