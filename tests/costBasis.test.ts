import {
  assert,
  beforeEach,
  clearStore,
  describe,
  test,
} from 'matchstick-as';

import {
  DEFAULT_USER,
  createRoundForTests,
  emitDeposit,
  emitWithdrawalRequested,
  emitWithdrawalProcessed,
} from './helpers';

describe('Cost Basis Calculation Tests', () => {
  beforeEach(() => {
    clearStore();
    createRoundForTests(1, 1_000_000);
  });

  test('Single deposit: cumulative values match deposit', () => {
    emitDeposit(DEFAULT_USER, '10000000000000000000', '10000000000000000000', 1_000_000);

    assert.fieldEquals('User', DEFAULT_USER, 'cumulativeDepositValue', '10000000000000000000');
    assert.fieldEquals('User', DEFAULT_USER, 'cumulativeDepositShares', '10000000000000000000');
    assert.fieldEquals('User', DEFAULT_USER, 'totalStaked', '10000000000000000000');
  });

  test('Multiple deposits accumulate cost basis', () => {
    emitDeposit(DEFAULT_USER, '10000000000000000000', '10000000000000000000', 1_000_000);
    emitDeposit(DEFAULT_USER, '5000000000000000000', '5000000000000000000', 1_000_100);

    assert.fieldEquals('User', DEFAULT_USER, 'cumulativeDepositValue', '15000000000000000000');
    assert.fieldEquals('User', DEFAULT_USER, 'cumulativeDepositShares', '15000000000000000000');
    assert.fieldEquals('User', DEFAULT_USER, 'totalStaked', '15000000000000000000');
  });

  test('Withdrawal reduces cost basis proportionally', () => {
    emitDeposit(DEFAULT_USER, '10000000000000000000', '10000000000000000000', 1_000_000);
    emitWithdrawalRequested(DEFAULT_USER, 5000, DEFAULT_USER, 1_000_150, 1);
    emitWithdrawalProcessed(
      DEFAULT_USER,
      5000,
      DEFAULT_USER,
      '5000000000000000000',
      '5000000000000000000',
      1_000_200,
      2
    );

    assert.fieldEquals('User', DEFAULT_USER, 'cumulativeDepositValue', '5000000000000000000');
    assert.fieldEquals('User', DEFAULT_USER, 'cumulativeDepositShares', '5000000000000000000');
    assert.fieldEquals('User', DEFAULT_USER, 'totalUnstaked', '5000000000000000000');
  });
});
