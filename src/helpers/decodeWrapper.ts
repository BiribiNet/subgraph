import { ByteArray, Bytes, ethereum } from "@graphprotocol/graph-ts";

export function decodeWrapper(input: Bytes, types: string): ethereum.Value | null {
    // prepend a "tuple" prefix (function params are arrays, not tuples)
    const tuplePrefix = ByteArray.fromHexString(
      '0x0000000000000000000000000000000000000000000000000000000000000020'
    );
  
    const inputAsTuple = new Uint8Array(
      tuplePrefix.length + input.length
    );
  
    //concat prefix & original input
    inputAsTuple.set(tuplePrefix, 0);
    inputAsTuple.set(input, tuplePrefix.length);
  
    const tupleInputBytes = Bytes.fromUint8Array(inputAsTuple);
    return ethereum.decode(
      types,
      tupleInputBytes
    );
}