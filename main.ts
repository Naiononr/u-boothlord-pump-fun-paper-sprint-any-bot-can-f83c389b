// Pump.fun Paper Sprint: "Launch Sniper + Momentum Ride".
//
// What the bot does (the full parameter list and the reasoning behind it live
// in strategy.ts):
//  - It watches every new bonding curve from its CreateEvent and only buys a
//    young launch whose opening tape looks like real, spread-out demand:
//    several distinct non-creator buyers, net SOL flowing in, no creator dump,
//    no single-wallet bundle sell, and real SOL inside a sane window.
//  - It enters small — 0.05 SOL planned per coin — and adds once, only into
//    strength, while the tape still qualifies; the 1%-of-real-reserve cap per
//    reply limits each buy anyway.
//  - It exits fast and mechanically: take-profit at +20%, a 15% stop-loss, a
//    trailing stop once the trade is in profit, a hard time limit of 10 slots,
//    a creator sell, or a tape that has gone quiet or turned negative.
//    Winners get to run through a half-off partial take-profit plus the
//    trailing stop; losers are cut before they can eat the account.
//  - At most 5 positions are open at once, and every coin is traded at least
//    0.01 SOL per round trip, so the entry clears the competition's 20-coin
//    guardrail with room to spare.
//
// Final parameters (stake 0.05 SOL, TP 20% / SL 15%, hold 10 slots) are the
// least-bad guardrails-met config from five sweeps on the dev window (see
// strategy.ts): no positive-expectancy config was found in any family —
// launch-sniping, late momentum, completion-proximity, or sizing/exit grids —
// because the ~2.8% round-trip fee eats the mostly-dying coins. This entry
// is the disciplined, smallest-loss version of the idea, not a claimed edge;
// the scoring window is unseen future data, and each batch of orders in it
// is decided by the same tape rules, one slot at a time.
//
// Paper trading only: this program talks to the replay harness over
// stdin/stdout and never touches real funds, the network, or anything outside
// this repository.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
