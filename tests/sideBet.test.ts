import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";
import {
  assert,
  beforeEach,
  clearStore,
  createMockedFunction,
  describe,
  newMockEvent,
  test,
} from "matchstick-as";

import { MarketRegistered } from "../generated/RouletteEngine/Game";
import {
  ConfigAdded,
  SideBetPlaced,
  SideBetSettled,
} from "../generated/SideBet/SideBet";
import { handleMarketRegistered } from "../src/mappings/roulette";
import {
  handleConfigAdded,
  handleSideBetPlaced,
  handleSideBetSettled,
} from "../src/mappings/side-bet";
import { bigintToBytes } from "../src/helpers/bigintToBytes";

const ENGINE = Address.fromString("0x15dc1be843c63317e87865e1df14afa782fae171");
const SIDEBET = Address.fromString("0x1ccc659dcee5af5c42263d1c9a9768d13025a020");
const ASSET = Address.fromString("0xaaaa000000000000000000000000000000000001");
const BANK = Address.fromString("0xbbbb000000000000000000000000000000000001");
const PLAYER = Address.fromString("0xcccc000000000000000000000000000000000001");

const CONFIG_ID = BigInt.fromI32(1);
const BET_ID = BigInt.fromI32(1);
const configKey = bigintToBytes(CONFIG_ID).toHexString();
const betKey = bigintToBytes(BET_ID).toHexString();

function seedMarket(): void {
  createMockedFunction(ASSET, "symbol", "symbol():(string)").returns([
    ethereum.Value.fromString("USDC"),
  ]);
  createMockedFunction(ASSET, "decimals", "decimals():(uint8)").returns([
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(6)),
  ]);
  createMockedFunction(BANK, "name", "name():(string)").returns([
    ethereum.Value.fromString("Biribi USDC Vault"),
  ]);
  createMockedFunction(BANK, "symbol", "symbol():(string)").returns([
    ethereum.Value.fromString("bvUSDC"),
  ]);

  const event = changetype<MarketRegistered>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(new ethereum.EventParam("marketId", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))));
  event.parameters.push(new ethereum.EventParam("asset", ethereum.Value.fromAddress(ASSET)));
  event.parameters.push(new ethereum.EventParam("bank", ethereum.Value.fromAddress(BANK)));
  event.address = ENGINE;
  event.logIndex = BigInt.fromI32(0);
  event.block.timestamp = BigInt.fromI32(1_000_000);
  event.block.number = BigInt.fromI32(10_000);
  handleMarketRegistered(event);
}

// Mock getConfig(configId) → SideBetConfig struct: NUMBER_HIT on number 7, 5-spin window, 2x multiplier.
function mockGetConfig(): void {
  const tuple: Array<ethereum.Value> = [
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)), // marketId (uint32)
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)), // betType NUMBER_HIT (uint8)
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0)), // color RED (uint8)
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(7)), // targetNumber (uint8)
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0)), // targetCount (uint16)
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0)), // redRatioBps (uint16)
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(5)), // windowSpins (uint16)
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(20_000)), // multiplierBps (uint32)
    ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000000")), // minStake (uint256)
    ethereum.Value.fromUnsignedBigInt(BigInt.fromString("1000000000")), // maxStake (uint256)
  ];
  createMockedFunction(
    SIDEBET,
    "getConfig",
    "getConfig(uint256):((uint32,uint8,uint8,uint8,uint16,uint16,uint16,uint32,uint256,uint256))"
  )
    .withArgs([ethereum.Value.fromUnsignedBigInt(CONFIG_ID)])
    .returns([ethereum.Value.fromTuple(changetype<ethereum.Tuple>(tuple))]);
}

function emitConfigAdded(): void {
  const event = changetype<ConfigAdded>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(new ethereum.EventParam("configId", ethereum.Value.fromUnsignedBigInt(CONFIG_ID)));
  event.parameters.push(new ethereum.EventParam("marketId", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))));
  event.parameters.push(new ethereum.EventParam("betType", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))));
  event.address = SIDEBET;
  event.logIndex = BigInt.fromI32(1);
  event.block.timestamp = BigInt.fromI32(1_000_100);
  event.block.number = BigInt.fromI32(10_001);
  handleConfigAdded(event);
}

function emitSideBetPlaced(): void {
  const event = changetype<SideBetPlaced>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(new ethereum.EventParam("betId", ethereum.Value.fromUnsignedBigInt(BET_ID)));
  event.parameters.push(new ethereum.EventParam("player", ethereum.Value.fromAddress(PLAYER)));
  event.parameters.push(new ethereum.EventParam("configId", ethereum.Value.fromUnsignedBigInt(CONFIG_ID)));
  event.parameters.push(new ethereum.EventParam("marketId", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))));
  event.parameters.push(new ethereum.EventParam("stake", ethereum.Value.fromUnsignedBigInt(BigInt.fromString("5000000"))));
  event.parameters.push(new ethereum.EventParam("payout", ethereum.Value.fromUnsignedBigInt(BigInt.fromString("100000000"))));
  event.parameters.push(new ethereum.EventParam("startGlobalRound", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(10))));
  event.parameters.push(new ethereum.EventParam("windowSpins", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(5))));
  event.address = SIDEBET;
  event.logIndex = BigInt.fromI32(2);
  event.block.timestamp = BigInt.fromI32(1_000_200);
  event.block.number = BigInt.fromI32(10_002);
  handleSideBetPlaced(event);
}

function emitSideBetSettled(outcome: i32, payout: string): void {
  const event = changetype<SideBetSettled>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(new ethereum.EventParam("betId", ethereum.Value.fromUnsignedBigInt(BET_ID)));
  event.parameters.push(new ethereum.EventParam("player", ethereum.Value.fromAddress(PLAYER)));
  event.parameters.push(new ethereum.EventParam("outcome", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(outcome))));
  event.parameters.push(new ethereum.EventParam("payout", ethereum.Value.fromUnsignedBigInt(BigInt.fromString(payout))));
  event.address = SIDEBET;
  event.logIndex = BigInt.fromI32(3);
  event.block.timestamp = BigInt.fromI32(1_000_300);
  event.block.number = BigInt.fromI32(10_003);
  handleSideBetSettled(event);
}

describe("SideBet tests", () => {
  beforeEach(() => {
    clearStore();
  });

  test("ConfigAdded creates a SideBetConfig enriched from getConfig", () => {
    seedMarket();
    mockGetConfig();
    emitConfigAdded();

    assert.entityCount("SideBetConfig", 1);
    assert.fieldEquals("SideBetConfig", configKey, "betType", "NUMBER_HIT");
    assert.fieldEquals("SideBetConfig", configKey, "marketId", "1");
    assert.fieldEquals("SideBetConfig", configKey, "targetNumber", "7");
    assert.fieldEquals("SideBetConfig", configKey, "windowSpins", "5");
    assert.fieldEquals("SideBetConfig", configKey, "multiplierBps", "20000");
    assert.fieldEquals("SideBetConfig", configKey, "minStake", "1000000");
    assert.fieldEquals("SideBetConfig", configKey, "active", "true");
  });

  test("SideBetPlaced creates an ACTIVE SideBet copying config display fields", () => {
    seedMarket();
    mockGetConfig();
    emitConfigAdded();
    emitSideBetPlaced();

    assert.entityCount("SideBet", 1);
    assert.fieldEquals("SideBet", betKey, "status", "ACTIVE");
    assert.fieldEquals("SideBet", betKey, "stake", "5000000");
    assert.fieldEquals("SideBet", betKey, "potentialPayout", "100000000");
    assert.fieldEquals("SideBet", betKey, "betType", "NUMBER_HIT");
    assert.fieldEquals("SideBet", betKey, "windowSpins", "5");
    assert.fieldEquals("SideBet", betKey, "player", PLAYER.toHexString());
    assert.fieldEquals("SideBet", betKey, "market", "1");
    assert.fieldEquals("SideBet", betKey, "config", configKey);
  });

  test("SideBetSettled marks the bet WON and records a settlement", () => {
    seedMarket();
    mockGetConfig();
    emitConfigAdded();
    emitSideBetPlaced();
    emitSideBetSettled(1, "100000000");

    assert.fieldEquals("SideBet", betKey, "status", "WON");
    assert.fieldEquals("SideBet", betKey, "actualPayout", "100000000");
    assert.fieldEquals("SideBet", betKey, "resolvedAt", "1000300");
    assert.fieldEquals("SideBet", betKey, "spinsResolved", "5");
    assert.entityCount("SideBetSettlement", 1);
  });
});
