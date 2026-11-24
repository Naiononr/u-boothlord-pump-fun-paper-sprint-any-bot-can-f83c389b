// Pump.fun Paper Sprint: "Launch Sniper + Momentum Ride".
//
// Strategy (see strategy.ts for the full parameter list and comments):
//  - Watch every new bonding curve from its CreateEvent. Buy only young launches whose
//    opening tape shows real, dispersed buying: several distinct non-creator buyers, net
//    inflow, no creator dump, no single-wallet bundle, real SOL in a sane window.
//  - Enter small and add once into strength while the tape still qualifies (the 1% of
//    real-reserve cap per reply limits each buy anyway).
//  - Exit fast: take-profit, tight stop-loss, a trailing stop once in profit, a time
//    limit, a creator sell, or a dry tape. Winners run via a partial take-profit plus
//    trailing stop; losers are cut before they can eat the account.
//  - At most 5 open positions; every coin is traded at least 0.01 SOL per round trip so
//    the entry clears the competition's 20-coin guardrail with room to spare.
//
// Paper trading only: this program talks to the replay harness on stdin/stdout and
// never touches real funds, the network, or anything outside this repository.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
