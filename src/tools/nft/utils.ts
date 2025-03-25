import { PublicActions, WalletClient } from 'viem';
import { erc721Abi } from '../../lib/contracts/erc721.js';
import { erc1155Abi } from '../../lib/contracts/erc1155.js';

/**
 * Define a more specific type for NFT data
 */
type NftData = {
  contract?: { address?: string };
  tokenId?: string;
  id?: { tokenId?: string };
  title?: string;
  name?: string;
  description?: string;
  tokenType?: string;
  media?: Array<{ gateway?: string; raw?: string }>;
  image?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Format NFT data from Alchemy API into a more usable format
 * @param params Parameters for formatting NFT data
 * @param params.nftData The raw NFT data from Alchemy API
 * @returns Formatted NFT data
 */
export function formatNftData(params: {
  nftData: Record<string, unknown>;
}): Array<Record<string, unknown>> {
  const { nftData } = params;
  if (!nftData || !nftData.ownedNfts || !Array.isArray(nftData.ownedNfts)) {
    return [];
  }

  const ownedNfts = nftData.ownedNfts as Array<NftData>;
  return ownedNfts.map((nft) => {
    return {
      contractAddress: nft.contract?.address || '',
      tokenId: nft.tokenId || nft.id?.tokenId || '',
      title: nft.title || nft.name || 'Unnamed NFT',
      description: nft.description || '',
      tokenType: nft.tokenType || 'UNKNOWN',
      imageUrl:
        nft.media?.[0]?.gateway || nft.media?.[0]?.raw || nft.image || '',
      metadata: nft.metadata || {},
    };
  });
}

/**
 * Detect if a contract is ERC721 or ERC1155 by checking if it supports the respective interface ID
 * @param wallet Viem wallet client with public actions
 * @param contractAddress The contract address to check
 * @returns The detected NFT standard or "UNKNOWN"
 */
export async function detectNftStandard(
  wallet: PublicActions,
  contractAddress: string,
): Promise<'ERC721' | 'ERC1155' | 'UNKNOWN'> {
  try {
    // ERC721 interface ID: 0x80ac58cd
    const isErc721 = await wallet.readContract({
      address: contractAddress as `0x${string}`,
      abi: erc721Abi,
      functionName: 'supportsInterface',
      args: ['0x80ac58cd'],
    });

    if (isErc721) {
      return 'ERC721';
    }

    // ERC1155 interface ID: 0xd9b67a26
    const isErc1155 = await wallet.readContract({
      address: contractAddress as `0x${string}`,
      abi: erc1155Abi,
      functionName: 'supportsInterface',
      args: ['0xd9b67a26'],
    });

    if (isErc1155) {
      return 'ERC1155';
    }

    return 'UNKNOWN';
  } catch (error) {
    console.error(
      `Error detecting NFT standard for ${contractAddress}:`,
      error,
    );
    return 'UNKNOWN';
  }
}

/**
 * Helper function to fetch NFTs from Alchemy API
 * @param params Parameters for fetching NFTs
 * @param params.ownerAddress The address to fetch NFTs for
 * @param params.limit Maximum number of NFTs to fetch
 * @returns The NFT data from Alchemy API
 */
export async function fetchNftsFromAlchemy(params: {
  ownerAddress: string;
  limit?: number;
}): Promise<Record<string, unknown>> {
  const { ownerAddress, limit = 50 } = params;
  // Access environment variables safely
  const apiKey = typeof process !== 'undefined' ? process.env.ALCHEMY_API_KEY : undefined;

  if (!apiKey) {
    throw new Error('ALCHEMY_API_KEY is not set in environment variables');
  }

  try {
    const baseUrl = 'https://base-mainnet.g.alchemy.com/nft/v3';
    const url = `${baseUrl}/${apiKey}/getNFTsForOwner?owner=${ownerAddress}&withMetadata=true&pageSize=${limit}`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Alchemy API error (${response.status}): ${errorText}`);
      throw new Error(
        `Alchemy API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Error fetching NFTs from Alchemy:`, error);
    throw error;
  }
}

/**
 * Transfer an NFT from one address to another
 * @param params Parameters for the transfer
 * @returns Transaction hash
 */
export async function transferNft(params: {
  wallet: WalletClient & PublicActions;
  contractAddress: string;
  tokenId: string;
  toAddress: string;
  amount?: string;
}): Promise<`0x${string}`> {
  const { wallet, contractAddress, tokenId, toAddress, amount = '1' } = params;
  
  try {
    // Detect the NFT standard
    const nftStandard = await detectNftStandard(wallet, contractAddress);

    if (nftStandard === 'UNKNOWN') {
      throw new Error(
        `Contract at ${contractAddress} does not implement a supported NFT standard`
      );
    }

    // Get the wallet address
    const [fromAddress] = await wallet.getAddresses();

    // Convert addresses and values to the correct format
    const contractAddressHex = contractAddress as `0x${string}`;
    const toAddressHex = toAddress as `0x${string}`;
    const tokenIdBigInt = BigInt(tokenId);
    const amountBigInt = BigInt(amount);

    let hash: `0x${string}`;

    if (nftStandard === 'ERC721') {
      // Transfer ERC721 NFT
      hash = await wallet.writeContract({
        address: contractAddressHex,
        abi: erc721Abi,
        functionName: 'safeTransferFrom',
        args: [fromAddress, toAddressHex, tokenIdBigInt],
        chain: null,
        account: fromAddress,
      });
    } else {
      // Transfer ERC1155 NFT
      hash = await wallet.writeContract({
        address: contractAddressHex,
        abi: erc1155Abi,
        functionName: 'safeTransferFrom',
        args: [fromAddress, toAddressHex, tokenIdBigInt, amountBigInt, '0x'],
        chain: null,
        account: fromAddress,
      });
    }

    // Ensure the hash is in the correct format
    if (!hash.startsWith('0x')) {
      throw new Error(`Invalid transaction hash format: ${hash}`);
    }
    return hash;
  } catch (error) {
    console.error(
      `Error transferring NFT ${tokenId} from contract ${contractAddress}:`,
      error
    );
    throw new Error(
      `Failed to transfer NFT: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
