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

export function decodeBetDataPayload(betData: Bytes): DecodedBetData {
  const out = new DecodedBetData()
  const decoded = ethereum.decode("(uint256[],uint256[],uint256[])", betData)
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
