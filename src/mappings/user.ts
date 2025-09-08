import { Bytes } from '@graphprotocol/graph-ts';

import { User } from '../../generated/schema';
import { ZERO } from '../helpers/number';

export function getOrCreateUser(userAddress: Bytes): User {
  let userEntity = User.load(userAddress);
  if (userEntity == null) {
    userEntity = new User(userAddress);
    userEntity.totalRouletteBets = ZERO;
    userEntity.totalRouletteWins = ZERO;
    userEntity.brbBalance = ZERO;
  }
  return userEntity;
}
