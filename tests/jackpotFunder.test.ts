import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import {
  afterEach,
  assert,
  clearStore,
  describe,
  newMockEvent,
  test,
} from "matchstick-as";

import {
  BrbRatioUpdated,
  FundFromMarketSkipped,
  FundedFromMarket,
  SlippageBpsUpdated,
  SwapAssetBpsUpdated,
  TreasuryBrbSplitUpdated,
} from "../generated/BRBJackpotFunder/BRBJackpotFunder";
import {
  handleBrbRatioUpdated,
  handleFundFromMarketSkipped,
  handleFundedFromMarket,
  handleSlippageBpsUpdated,
  handleSwapAssetBpsUpdated,
  handleTreasuryBrbSplitUpdated,
} from "../src/mappings/jackpot-funder";
import { Market } from "../generated/schema";

const FUNDER_ADDRESS = "0x60ce672feaf39f35a3f6e5b3e099f46b90aee9fc";
const ASSET_ADDRESS = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const BANK_ADDRESS = "0x3861523245933a342debab87daa8298f3640c57c";
// bytes(uint32(0)) — the Market entity for marketId=0
const MARKET_ID_HEX = "0x00";
// bytes("config") — JackpotFunderConfig singleton key
const CONFIG_ID_HEX = "0x636f6e666967";

function preStageMarket(marketIdInt: i32 = 0): void {
  const id = Bytes.fromHexString(MARKET_ID_HEX);
  const market = new Market(id);
  market.marketId = BigInt.fromI32(marketIdInt);
  market.asset = Bytes.fromHexString(ASSET_ADDRESS);
  market.bank = Bytes.fromHexString(BANK_ADDRESS);
  market.assetSymbol = "USDC";
  market.assetDecimals = 6;
  market.shareName = "BRB USD Coin";
  market.shareSymbol = "brbUSDC";
  market.createdAt = BigInt.fromI32(1_000_000);
  market.totalAssets = BigInt.fromI32(0);
  market.totalShares = BigInt.fromI32(0);
  market.brbRatio = BigInt.fromI32(0);
  market.save();
}

function buildFundedFromMarket(): FundedFromMarket {
  const event = changetype<FundedFromMarket>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam("marketId", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0))),
  );
  event.parameters.push(
    new ethereum.EventParam("asset", ethereum.Value.fromAddress(Address.fromString(ASSET_ADDRESS))),
  );
  event.parameters.push(
    new ethereum.EventParam("assetSwapped", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1_000_000))),
  );
  event.parameters.push(
    new ethereum.EventParam("brbOut", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(950_000))),
  );
  event.parameters.push(
    new ethereum.EventParam("brbToTreasury", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(800_000))),
  );
  event.parameters.push(
    new ethereum.EventParam("brbBurned", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(150_000))),
  );
  event.address = Address.fromString(FUNDER_ADDRESS);
  event.block.timestamp = BigInt.fromI32(1_000_500);
  event.block.number = BigInt.fromI32(10_005);
  event.logIndex = BigInt.fromI32(0);
  return event;
}

describe("BRBJackpotFunder mappings", () => {
  afterEach(() => {
    clearStore();
  });

  test("FundedFromMarket creates a JackpotBuy with the swap breakdown", () => {
    preStageMarket();
    const event = buildFundedFromMarket();
    handleFundedFromMarket(event);

    assert.entityCount("JackpotBuy", 1);
    const expectedId = event.transaction.hash.concat(Bytes.fromHexString("0x00")).toHexString();
    assert.fieldEquals("JackpotBuy", expectedId, "market", MARKET_ID_HEX);
    assert.fieldEquals("JackpotBuy", expectedId, "asset", ASSET_ADDRESS);
    assert.fieldEquals("JackpotBuy", expectedId, "assetSwapped", "1000000");
    assert.fieldEquals("JackpotBuy", expectedId, "brbOut", "950000");
    assert.fieldEquals("JackpotBuy", expectedId, "brbToTreasury", "800000");
    assert.fieldEquals("JackpotBuy", expectedId, "brbBurned", "150000");
  });

  test("FundedFromMarket with unknown marketId does not create a JackpotBuy", () => {
    // No preStageMarket — the Market entity is absent.
    const event = buildFundedFromMarket();
    handleFundedFromMarket(event);
    assert.entityCount("JackpotBuy", 0);
  });

  test("FundFromMarketSkipped records the reason code", () => {
    preStageMarket();
    const event = changetype<FundFromMarketSkipped>(newMockEvent());
    event.parameters = new Array<ethereum.EventParam>();
    event.parameters.push(
      new ethereum.EventParam("marketId", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0))),
    );
    event.parameters.push(
      new ethereum.EventParam("asset", ethereum.Value.fromAddress(Address.fromString(ASSET_ADDRESS))),
    );
    event.parameters.push(
      new ethereum.EventParam("reason", ethereum.Value.fromI32(2)),
    );
    event.address = Address.fromString(FUNDER_ADDRESS);
    event.block.timestamp = BigInt.fromI32(1_000_600);
    event.logIndex = BigInt.fromI32(0);

    handleFundFromMarketSkipped(event);
    assert.entityCount("JackpotFundingSkip", 1);
    const expectedId = event.transaction.hash.concat(Bytes.fromHexString("0x00")).toHexString();
    assert.fieldEquals("JackpotFundingSkip", expectedId, "reason", "2");
    assert.fieldEquals("JackpotFundingSkip", expectedId, "market", MARKET_ID_HEX);
  });

  test("SwapAssetBpsUpdated lazy-inits and updates the singleton config", () => {
    const event = changetype<SwapAssetBpsUpdated>(newMockEvent());
    event.parameters = new Array<ethereum.EventParam>();
    event.parameters.push(
      new ethereum.EventParam("totalBps", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(300))),
    );
    event.address = Address.fromString(FUNDER_ADDRESS);
    event.block.timestamp = BigInt.fromI32(1_000_700);

    handleSwapAssetBpsUpdated(event);
    assert.entityCount("JackpotFunderConfig", 1);
    assert.fieldEquals("JackpotFunderConfig", CONFIG_ID_HEX, "swapAssetTotalBps", "300");
    assert.fieldEquals("JackpotFunderConfig", CONFIG_ID_HEX, "lastUpdatedAt", "1000700");
  });

  test("TreasuryBrbSplitUpdated updates numerator + denominator without resetting other fields", () => {
    const swapEvent = changetype<SwapAssetBpsUpdated>(newMockEvent());
    swapEvent.parameters = new Array<ethereum.EventParam>();
    swapEvent.parameters.push(
      new ethereum.EventParam("totalBps", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(300))),
    );
    swapEvent.block.timestamp = BigInt.fromI32(1_000_700);
    handleSwapAssetBpsUpdated(swapEvent);

    const event = changetype<TreasuryBrbSplitUpdated>(newMockEvent());
    event.parameters = new Array<ethereum.EventParam>();
    event.parameters.push(
      new ethereum.EventParam("numerator", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(25))),
    );
    event.parameters.push(
      new ethereum.EventParam("denominator", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(30))),
    );
    event.block.timestamp = BigInt.fromI32(1_000_800);
    handleTreasuryBrbSplitUpdated(event);

    assert.fieldEquals("JackpotFunderConfig", CONFIG_ID_HEX, "swapAssetTotalBps", "300");
    assert.fieldEquals("JackpotFunderConfig", CONFIG_ID_HEX, "treasuryBrbNumerator", "25");
    assert.fieldEquals("JackpotFunderConfig", CONFIG_ID_HEX, "treasuryBrbDenominator", "30");
    assert.fieldEquals("JackpotFunderConfig", CONFIG_ID_HEX, "lastUpdatedAt", "1000800");
  });

  test("SlippageBpsUpdated writes slippageBps on the config", () => {
    const event = changetype<SlippageBpsUpdated>(newMockEvent());
    event.parameters = new Array<ethereum.EventParam>();
    event.parameters.push(
      new ethereum.EventParam("slippageBps", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(50))),
    );
    event.block.timestamp = BigInt.fromI32(1_000_900);

    handleSlippageBpsUpdated(event);
    assert.fieldEquals("JackpotFunderConfig", CONFIG_ID_HEX, "slippageBps", "50");
  });

  test("BrbRatioUpdated writes ratioPerAssetUnit on Market.brbRatio", () => {
    preStageMarket();
    const event = changetype<BrbRatioUpdated>(newMockEvent());
    event.parameters = new Array<ethereum.EventParam>();
    event.parameters.push(
      new ethereum.EventParam("marketId", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0))),
    );
    event.parameters.push(
      new ethereum.EventParam("ratioPerAssetUnit", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(123_456))),
    );
    event.block.timestamp = BigInt.fromI32(1_001_000);

    handleBrbRatioUpdated(event);
    assert.fieldEquals("Market", MARKET_ID_HEX, "brbRatio", "123456");
  });
});
