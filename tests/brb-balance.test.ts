import {
  assert,
  beforeEach,
  clearStore,
  describe,
  test,
} from 'matchstick-as';

import {
  DEFAULT_USER,
  TEST_BANK,
  emitBrbTransfer,
  setupTestMarket,
} from './helpers';
import { ZERO_ADDRESS } from '../src/helpers/constant';

const TEN_BRB = '10000000000000000000';
const HALF_BRB = '500000000000000000';

describe('BRB wallet balance tracking', () => {
  beforeEach(() => {
    clearStore();
    setupTestMarket();
  });

  test('with auto-fund: donation to bank debits sender balance correctly', () => {
    emitBrbTransfer(DEFAULT_USER, TEST_BANK.toHexString(), HALF_BRB, 1_000_000);

    // 1000 BRB mint (auto) - 0.5 BRB to bank
    assert.fieldEquals('User', DEFAULT_USER, 'brbBalance', '999500000000000000000');
  });

  test('without prior inbound transfer: outbound clamps balance to zero (incomplete index)', () => {
    emitBrbTransfer(DEFAULT_USER, TEST_BANK.toHexString(), HALF_BRB, 1_000_000, 0, false);

    assert.fieldEquals('User', DEFAULT_USER, 'brbBalance', '0');
  });

  test('explicit mint then transfer: same as auto-fund path', () => {
    emitBrbTransfer(ZERO_ADDRESS, DEFAULT_USER, TEN_BRB, 1_000_000, 0, false);
    emitBrbTransfer(DEFAULT_USER, TEST_BANK.toHexString(), HALF_BRB, 1_000_100, 1, false);

    assert.fieldEquals('User', DEFAULT_USER, 'brbBalance', '9500000000000000000');
  });

  test('bank address is not tracked as a User wallet balance', () => {
    emitBrbTransfer(DEFAULT_USER, TEST_BANK.toHexString(), HALF_BRB, 1_000_000);

    assert.entityCount('User', 1);
    assert.fieldEquals('User', DEFAULT_USER, 'brbBalance', '999500000000000000000');
  });

  test('bank to user payout credits recipient wallet only', () => {
    emitBrbTransfer(TEST_BANK.toHexString(), DEFAULT_USER, TEN_BRB, 1_000_000, 0, false);

    assert.fieldEquals('User', DEFAULT_USER, 'brbBalance', TEN_BRB);
    assert.entityCount('User', 1);
  });
});
