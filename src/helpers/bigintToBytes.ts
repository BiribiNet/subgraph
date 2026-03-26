import { BigInt, Bytes } from '@graphprotocol/graph-ts';

// Helper function to convert a BigInt to Bytes (handles odd-length hex strings by prepending zero)
export const bigintToBytes = (bigint: BigInt): Bytes => {
  const hexString = bigint.toHexString();
  return Bytes.fromHexString(hexString.length % 2 == 0 ? hexString : '0x0' + hexString.slice(2));
};
