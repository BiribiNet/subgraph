import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts"

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

function isTransfer(log: ethereum.Log, token: Address, from: Address, to: Address): boolean {
  return log.address.equals(token) && log.topics.length == 3 && log.data.length == 32
    && log.topics[0].toHexString() == TRANSFER
    && log.topics[1].toHexString().slice(-40) == from.toHexString().slice(2)
    && log.topics[2].toHexString().slice(-40) == to.toHexString().slice(2)
}

function amount(log: ethereum.Log): BigInt {
  const decoded = ethereum.decode("uint256", log.data)
  assert(decoded !== null, "Invalid withdrawal transfer amount")
  return decoded!.toBigInt()
}

// Deployed BankVault4626 _processQueue emits [net transfer, optional fee transfer,
// share burn, WithdrawalProcessed]. Failed fee transfers emit no Transfer and stay
// in the vault. Match the exact burn and payment, never infer a flat fee or scan
// unrelated settlement transfers elsewhere in this transaction.
export function withdrawalFeeFromReceipt(
  event: ethereum.Event, owner: Address, receiver: Address, paid: BigInt,
  shares: BigInt, asset: Address, infra: Address
): BigInt {
  if (shares.equals(BigInt.zero())) return BigInt.zero()
  const receipt = event.receipt
  assert(receipt !== null, "Mainnet withdrawal requires its transaction receipt")
  const logs = receipt!.logs
  let index: i32 = -1
  for (let i = 0; i < logs.length; i++) {
    if (logs[i].logIndex.equals(event.logIndex)) { index = i; break }
  }
  assert(index >= 1, "Withdrawal event missing from receipt")
  const burn = logs[index - 1]
  assert(isTransfer(burn, event.address, owner, Address.zero()) && amount(burn).equals(shares), "Withdrawal share burn differs from receipt")
  if (index < 2) {
    assert(paid.equals(BigInt.zero()), "Withdrawal payment missing from receipt")
    return BigInt.zero()
  }
  const previous = logs[index - 2]
  if (isTransfer(previous, asset, event.address, infra)) {
    // Check the pair first: net and fee may be equal and receiver may be infra.
    if (paid.equals(BigInt.zero()) || (index >= 3
      && isTransfer(logs[index - 3], asset, event.address, receiver)
      && amount(logs[index - 3]).equals(paid))) return amount(previous)
  }
  assert(paid.equals(BigInt.zero()) || (isTransfer(previous, asset, event.address, receiver)
    && amount(previous).equals(paid)), "Withdrawal net payment differs from receipt")
  return BigInt.zero()
}
