import { BigInt, Bytes } from '@graphprotocol/graph-ts';

// Helper function to convert a BigInt to a Bytes negates odd length hex strings
export const bigintToBytes = (bigint: BigInt): Bytes => {
  const hexString = bigint.toHexString();
  return Bytes.fromHexString(hexString.length % 2 == 0 ? hexString : '0x0' + hexString.slice(2));
};
