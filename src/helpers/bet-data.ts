import { BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts"

export class DecodedBetData {
  types: Array<BigInt>
  numbers: Array<BigInt>
  amounts: Array<BigInt>

  constructor() {
    this.types = new Array<BigInt>(0)
    this.numbers = new Array<BigInt>(0)
    this.amounts = new Array<BigInt>(0)
  }
}

// The engine builds `betData` with `abi.encode(uint256[], uint256[], uint256[])` — three
// top-level parameters, so the payload opens directly with the three array offsets. graph-ts
// only decodes a parameter *list* of one type, and reading that list as a single dynamic tuple
// makes ethabi expect a leading offset word pointing at the tuple body. Without it the first
// array offset (0x60) is read as that pointer and the decode collapses, which is what left
// every historical bet stored as one synthetic STRAIGHT-on-0 leg and every round exposure
// bucket at zero. Prepending the 32-byte head word turns the flat payload into the standalone
// tuple encoding ethabi wants; the bytes after it are untouched.
const TUPLE_HEAD_OFFSET = Bytes.fromHexString(
  "0x0000000000000000000000000000000000000000000000000000000000000020"
)

export function decodeBetDataPayload(betData: Bytes): DecodedBetData {
  const out = new DecodedBetData()
  const wrapped = changetype<Bytes>(TUPLE_HEAD_OFFSET.concat(betData))
  const decoded = ethereum.decode("(uint256[],uint256[],uint256[])", wrapped)
  if (decoded == null) {
    return out
  }
  const tuple = decoded.toTuple()
  const types = tuple[0].toBigIntArray()
  const numbers = tuple[1].toBigIntArray()
  const amounts = tuple[2].toBigIntArray()
  const len = types.length
  if (len == 0 || numbers.length != len || amounts.length != len) {
    return out
  }
  for (let i = 0; i < len; i++) {
    out.types.push(types[i])
    out.numbers.push(numbers.length > i ? numbers[i] : BigInt.zero())
    out.amounts.push(amounts[i])
  }
  return out
}
