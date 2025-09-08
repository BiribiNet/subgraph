import { Bytes, ethereum } from "@graphprotocol/graph-ts";

export function decodeWrapper(input: Bytes, types: string): ethereum.Value | null {
    return ethereum.decode(
      types,
      input
    );
}