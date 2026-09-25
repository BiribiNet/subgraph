import { assert, describe, test } from 'matchstick-as';
import { sideBetTypeFromI32 } from '../src/helpers/side-bet';
describe('Append-only challenge enum',()=>{
 test('preserves the legacy indices and maps all six extensions',()=>{
  const values=['COLOR_COUNT','NUMBER_HIT','CONSECUTIVE_STREAK','RED_RATIO','LIGHTNING_DOUBLE','PERFECT_ALTERNATION','DOZEN_HIT','COLUMN_HIT','JACKPOT_IN_WINDOW','DOZEN_PASSPORT','BOOMERANG','MIRROR_PAIR','WHEEL_NEIGHBORS','DISTINCT_COLLECTION','COLOR_DUEL'];
  for(let i=0;i<values.length;i++)assert.stringEquals(sideBetTypeFromI32(i),values[i]);
 });
});
