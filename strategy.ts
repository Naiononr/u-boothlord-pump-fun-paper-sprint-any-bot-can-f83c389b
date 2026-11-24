// "Launch Sniper + Momentum Ride" — a pump.fun paper-trading bot for the
// agent-fun/replay/v2 bonding-curve replay.
//
// The core observation is that a fresh pump.fun curve is a lottery ticket with a
// known price: every round trip pays a 1.25% curve fee plus a transaction fee, so
// buying at random bleeds the account dry. The only plausible edge is picking
// launches whose opening tape already looks like real demand — a handful of
// different wallets buying in, more SOL flowing in than out, the creator holding
// rather than dumping, and no single wallet unloading a bundle-sized sell — and
// then getting out quickly. Entries are small (0.1 SOL planned per coin, built up
// under the 1%-of-real-reserve reply cap) with at most one add, and only into a
// tape that is still strengthening. Exits are mechanical: a take-profit, a
// stop-loss, a trailing stop once the trade is working, a hard time limit, a
// creator sell, or a tape that has gone quiet or turned negative. A winner is
// allowed to run through a half-off partial take-profit and a trailing stop; a
// loser is cut before it can do real damage.
//
// The numbers below come from the builder's own sweeps on the dev calibration
// set: exits at tpBps/slBps 1500/1500 with maxHold 10 beat the first-guess exits,
// the entry window tightens to maxAge 3 with a narrow buyer window (2–8 distinct
// buyers, at least 2 trades), and an add needs both a real +2% price step from
// the last buy and positive recent flow, so size is only pressed when the trade
// is working. The exit machinery that v1 left switched off is live here: the
// partial take-profit sells half at +10% and then guards the remainder with a
// +2% floor, the trailing stop arms at the same +10% and exits on an 8% pullback
// from the peak, and the two quiet-tape exits fire — out after 8 slots with no
// trade, or when 10-slot net flow drops below -0.05 SOL. A position that stops
// moving is usually about to be sold into, so it leaves on our terms.
//
// RESUME PASS (2026-11-24, sweep 3/4/5 — hello, this batch of orders was run
// to close out the search the first builder left open): sweep 3, the
// late-momentum / completion-ride family (minAge 0/100/500, maxAge up to
// 100_000 slots, flow and real-SOL thresholds, trailing stop), peaked at
// +0.0013 SOL over just 8 trips — noise, not an edge, and below the 20-coin
// guardrail. Sweep 4, completion-proximity entries (minRealSol 20/40/60 SOL,
// long holds, TP up to 100%), peaked at +0.0138 SOL over 11 trips with the
// top 3 coins carrying 100% of the gain — again one lucky coin, and no coin
// in the dev window ever reached 40 SOL of real reserve, so the 40/60 SOL
// rows traded nothing at all. Sweep 5, a fee-aware sizing/exit grid on the
// sniper base (stake 0.05/0.10/0.20 SOL × TP 10/15/20% × SL 10/15% × hold
// 5/10/20 slots, 54 combos), found the least-bad guardrails-met config at
// stake 0.05 SOL, TP 20%, SL 15%, hold 10 slots: −0.458 SOL over 368 trips,
// drawdown 0.048. No positive-expectancy config exists anywhere in the five
// sweeps (156 combos on top of sweeps 1–2); per-trade expectancy is negative
// in every family because the ~2.8% round-trip fee eats the mostly-dying
// coins. So the final parameters below take the sweep-5 least-bad config —
// smaller stake, wider take-profit — rather than pretend a winning edge was
// found. The final grading window is unseen future data, and the point is a
// disciplined, fast-exiting version of the same idea.
//
// The bot is deterministic by construction: no clock, no randomness, no I/O;
// iteration is only over insertion-ordered maps fed by the batch stream.

import { BPS, type Batch, type Bot, type BotState, type OrderInput, type Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Youngest age (slots since create) at which a coin may be bought. */
  minAge: number;
  /** Oldest age at which a first buy may still be decided. */
  maxAge: number;
  /** Lamports to aim for per coin in total (each reply is still capped at 1% of real SOL). */
  stakeLamports: number;
  /** Smallest single buy worth paying the tx fee for. */
  minBuyLamports: number;
  /** Buys after the first one, each on a later batch, while the coin keeps qualifying. */
  maxAdds: number;
  /** An add needs the price at least this far (bps) above the previous buy's decision price. */
  addStepBps: number;
  /** An add waits this many slots after the previous buy was decided. */
  addDelay: number;
  /** Lamports per add (each still capped at 1% of real SOL). */
  addLamports: number;
  /** An add needs the recent net flow at least this (lamports). */
  addMinFlowLamports: number;
  /** Real SOL reserve window at decision time (lamports). */
  minRealSol: number;
  maxRealSol: number;
  /** Creator's own buys in the create slot: lamports window. */
  minDevBuy: number;
  maxDevBuy: number;
  /** Trades seen and distinct (non-creator) buyers seen before entry. */
  minTrades: number;
  minBuyers: number;
  /** Distinct non-creator buyers before entry, at most: a launch bundled by many wallets is a dump in waiting. */
  maxBuyers: number;
  /** Lamports sold by others / lamports bought, as bps, at most. */
  maxSellRatioBps: number;
  /** Largest single non-creator sell seen, as bps of the real SOL reserve before it, at most. */
  maxBigSellBps: number;
  /** Price now over the create price, as bps: window. */
  minRunupBps: number;
  maxRunupBps: number;
  /** The recent-flow window (slots) and what it must show. */
  flowWindow: number;
  minFlowLamports: number;
  minRecentBuyers: number;
  /** Creator sold before entry: skip the coin. */
  skipDevSold: boolean;
  /** Slippage allowed on buys (bps): a buy whose price jumps more than this in the latency is refused. */
  buySlippageBps: number;
  /** First take-profit: sell tp1PartBps of the position once it is worth tp1Bps over its cost. */
  tp1Bps: number;
  tp1PartBps: number;
  /** After the first take-profit, the rest stops out at this much under its cost (bps; negative = above). */
  slAfterTp1Bps: number;
  /** Exit when the position is worth this much over its cost (bps). */
  tpBps: number;
  /** Exit when it is worth this much under its cost (bps). */
  slBps: number;
  /** Trailing stop: once up at least trailArmBps, exit on a fall of trailBps from the best value. */
  trailArmBps: number;
  trailBps: number;
  /** Exit after holding this many slots. */
  maxHold: number;
  /** Exit when the creator sells while held. */
  exitOnDevSell: boolean;
  /** Exit when no trade has hit the coin for this many slots. */
  staleSlots: number;
  /** Exit when the recent net flow falls below minus this many lamports. */
  exitFlowLamports: number;
  /** Most entries per curve over the run (0 = unlimited). */
  maxEntries: number;
  /** Slots to wait after an exit before the same curve may be bought again. */
  cooldown: number;
}

export const DEFAULT_PARAMS: Params = {
  minAge: 0,
  maxAge: 3,
  stakeLamports: 50_000_000,
  minBuyLamports: 10_000_000,
  maxAdds: 1,
  addStepBps: 200,
  addDelay: 2,
  addLamports: 50_000_000,
  addMinFlowLamports: 10_000_000,
  minRealSol: 300_000_000,
  maxRealSol: 30_000_000_000,
  minDevBuy: 0,
  maxDevBuy: 2_500_000_000,
  minTrades: 2,
  minBuyers: 2,
  maxBuyers: 8,
  maxSellRatioBps: 10_000,
  maxBigSellBps: 10_000,
  minRunupBps: 0,
  maxRunupBps: 1_000_000,
  flowWindow: 10,
  minFlowLamports: 0,
  minRecentBuyers: 0,
  skipDevSold: true,
  buySlippageBps: 10_000,
  tp1Bps: 1_000,
  tp1PartBps: 5_000,
  slAfterTp1Bps: -200,
  tpBps: 2_000,
  slBps: 1_500,
  trailArmBps: 1_000,
  trailBps: 800,
  maxHold: 10,
  exitOnDevSell: true,
  staleSlots: 8,
  exitFlowLamports: 50_000_000,
  maxEntries: 1,
  cooldown: 150,
};

/** Curve fee charged on sells, in basis points (protocol + creator share). */
const CURVE_FEE_BPS = 125n;

/**
 * What `tokens` sold against reserves (vq, vt) actually pays out, after the
 * curve fee is taken off the top. Rounds the fee up, matching the harness.
 */
function sellProceeds(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const gross = (tokens * vq) / (vt + tokens);
  return gross - (gross * CURVE_FEE_BPS + BPS - 1n) / BPS;
}

/** One trade seen on a launch's tape. */
interface TapeTick {
  slot: number;
  buy: boolean;
  lamports: bigint;
  wallet: Pubkey;
}

/**
 * Everything remembered about one bonding curve, from its CreateEvent onward.
 * The tape is the whole edge: entry decisions read it, exit decisions read it.
 */
interface Launch {
  mint: Pubkey;
  /** Slot the curve was created in. */
  born: number;
  /** The creator wallet. */
  maker: Pubkey;
  /** Create-time reserves, the baseline the price run-up is measured against. */
  baseVq: bigint;
  baseVt: bigint;
  /** Creator buys inside the create slot (their seed, if any). */
  makerSeed: bigint;
  /** Trades seen since creation. */
  tradeCount: number;
  /** Distinct non-creator wallets that have bought. */
  crowd: Set<Pubkey>;
  /** Lamports bought in total (everyone). */
  inflow: bigint;
  /** Lamports sold by non-creators. */
  outflow: bigint;
  /** Worst single non-creator sell, as bps of the real SOL reserve before it. */
  worstDumpBps: bigint;
  /** True once the creator has sold anything. */
  makerDumped: boolean;
  /** Slot of the most recent trade on this curve. */
  lastSeen: number;
  /** Trades inside the recent-flow window; older ones are dropped as new ones arrive. */
  window: TapeTick[];
  /** Buys already sent (first buy + adds). */
  buysPlaced: number;
  /** Lamports already sent on buys. */
  lamportsPlaced: bigint;
  /** Decision price (vq/vt pair) of the most recent buy sent. */
  lastBuyVq: bigint;
  lastBuyVt: bigint;
  /** Slot the most recent buy was decided in. */
  lastBuySlot: number;
  /** Entries taken on this curve so far. */
  entriesTaken: number;
  /** Slot of the most recent exit from this curve. */
  exitedAt: number;
  /** Never buy it again (aged out, filtered out for good, or exited). */
  closed: boolean;
  /** Curve completed (graduated / dead): nothing more can happen here. */
  finished: boolean;
}

/** Bookkeeping for one open position, kept alongside the harness position. */
interface OpenPos {
  /** Slot the position was opened (first fill, or first seen held). */
  opened: number;
  /** Transaction fees paid on fills so far. */
  feesPaid: bigint;
  /** Best mark-to-market value seen since opening (net of one tx fee). */
  peak: bigint;
  /** Whether the creator had already sold when the position opened. */
  makerDumpedBefore: boolean;
  /** Whether the partial take-profit has already fired. */
  partialDone: boolean;
}

export function createStrategy(params: Params = DEFAULT_PARAMS): Bot {
  const P = params;
  const launches = new Map<Pubkey, Launch>();
  const open = new Map<Pubkey, OpenPos>();
  /** Mints with a sell order currently in flight. */
  const selling = new Set<Pubkey>();
  const stake = BigInt(P.stakeLamports);
  const minBuy = BigInt(P.minBuyLamports);

  // ---- tape ingestion -------------------------------------------------------

  /** Fold one batch of replay events into the per-launch tape state. */
  function ingest(batch: Batch): void {
    for (const ev of batch.events) {
      if (ev.event === 'CreateEvent') {
        launches.set(ev.mint, {
          mint: ev.mint,
          born: ev.slot,
          maker: ev.creator,
          baseVq: BigInt(ev.virtual_quote_reserves),
          baseVt: BigInt(ev.virtual_token_reserves),
          makerSeed: 0n,
          tradeCount: 0,
          crowd: new Set(),
          inflow: 0n,
          outflow: 0n,
          worstDumpBps: 0n,
          makerDumped: false,
          lastSeen: ev.slot,
          window: [],
          buysPlaced: 0,
          lamportsPlaced: 0n,
          lastBuyVq: 0n,
          lastBuyVt: 1n,
          lastBuySlot: 0,
          entriesTaken: 0,
          exitedAt: -1e12,
          closed: false,
          finished: false,
        });
      } else if (ev.event === 'TradeEvent') {
        const launch = launches.get(ev.mint);
        if (launch === undefined) continue;
        const amount = BigInt(ev.sol_amount);
        launch.tradeCount += 1;
        launch.lastSeen = ev.slot;
        launch.window.push({ slot: ev.slot, buy: ev.is_buy, lamports: amount, wallet: ev.user });
        const isMaker = ev.user === launch.maker;
        if (ev.is_buy) {
          launch.inflow += amount;
          if (isMaker && ev.slot === launch.born) launch.makerSeed += amount;
          else if (!isMaker) launch.crowd.add(ev.user);
        } else if (isMaker) {
          launch.makerDumped = true;
        } else {
          launch.outflow += amount;
          const reserveBefore = BigInt(ev.real_quote_reserves) + amount;
          if (reserveBefore > 0n) {
            const bps = (amount * BPS) / reserveBefore;
            if (bps > launch.worstDumpBps) launch.worstDumpBps = bps;
          }
        }
      } else {
        // Any other event type (completion) ends the curve for good.
        const launch = launches.get(ev.mint);
        if (launch !== undefined) {
          launch.finished = true;
          launch.closed = true;
        }
      }
    }
  }

  /**
   * Net lamports bought minus sold, and the distinct non-creator buyers, over
   * the last flowWindow slots. Prunes stale ticks in place as it goes.
   */
  function windowFlow(launch: Launch, slot: number): { net: bigint; buyers: number } {
    const cutoff = slot - P.flowWindow;
    let stale = 0;
    while (stale < launch.window.length && launch.window[stale]!.slot <= cutoff) stale++;
    if (stale > 0) launch.window.splice(0, stale);
    let net = 0n;
    const buyers = new Set<Pubkey>();
    for (const tick of launch.window) {
      if (tick.buy) {
        net += tick.lamports;
        if (tick.wallet !== launch.maker) buyers.add(tick.wallet);
      } else {
        net -= tick.lamports;
      }
    }
    return { net, buyers: buyers.size };
  }

  /** True when the harness still has a pending order of this side on a mint. */
  function hasPending(state: BotState, mint: Pubkey, side: 'buy' | 'sell'): boolean {
    for (const p of state.pending.values()) {
      if (p.order.mint === mint && p.order.side === side) return true;
    }
    return false;
  }

  // ---- fill settlement ------------------------------------------------------

  /**
   * Apply this batch's fills to the open-position bookkeeping, and drop stale
   * `selling` / `open` entries whose orders are no longer in flight.
   */
  function settle(state: BotState, batch: Batch, txFee: bigint): void {
    for (const fill of batch.fills) {
      // Client ids starting with '_' are our own exit sells (see below).
      if (fill.client_id.startsWith('_')) {
        open.delete(fill.mint);
        selling.delete(fill.mint);
        const launch = launches.get(fill.mint);
        if (launch !== undefined) launch.exitedAt = state.slot;
        continue;
      }
      const rec = open.get(fill.mint);
      if (fill.status !== 'rejected' && rec !== undefined) {
        rec.feesPaid += BigInt(fill.tx_fee_lamports);
      }
      if (fill.side === 'buy' && fill.status === 'filled' && rec === undefined) {
        open.set(fill.mint, {
          opened: fill.slot,
          feesPaid: BigInt(fill.tx_fee_lamports),
          peak: 0n,
          makerDumpedBefore: launches.get(fill.mint)?.makerDumped ?? false,
          partialDone: false,
        });
      }
    }
    for (const mint of [...selling]) {
      if (!hasPending(state, mint, 'sell')) selling.delete(mint);
    }
    for (const mint of [...open.keys()]) {
      if (!state.positions.has(mint) && !selling.has(mint) && !hasPending(state, mint, 'buy')) {
        open.delete(mint);
        const launch = launches.get(mint);
        if (launch !== undefined) launch.exitedAt = state.slot;
      }
    }
  }

  // ---- exits ----------------------------------------------------------------

  /**
   * The reason to exit a position right now, or null to keep holding. Price
   * exits (take-profit / stop / trailing) are checked first, then the time
   * limit, then the tape-based exits — a creator sell, a dry tape, or net flow
   * turning against us.
   */
  function exitReason(
    launch: Launch | undefined,
    rec: OpenPos,
    value: bigint,
    basis: bigint,
    slot: number,
  ): string | null {
    if (basis > 0n) {
      if (value * BPS >= basis * (BPS + BigInt(P.tpBps))) return 'take-profit';
      const stopBps = rec.partialDone ? BigInt(P.slAfterTp1Bps) : BigInt(P.slBps);
      if (value * BPS <= basis * (BPS - stopBps)) return 'stop-loss';
      const armed = rec.peak * BPS >= basis * (BPS + BigInt(P.trailArmBps));
      const pulledBack = value * BPS <= rec.peak * (BPS - BigInt(P.trailBps));
      if (armed && pulledBack) return 'trailing-stop';
    }
    if (slot - rec.opened >= P.maxHold) return 'max-hold';
    if (launch === undefined) return null;
    if (P.exitOnDevSell && launch.makerDumped && !rec.makerDumpedBefore) return 'creator-sell';
    if (slot - launch.lastSeen >= P.staleSlots) return 'stale-tape';
    if (windowFlow(launch, slot).net < -BigInt(P.exitFlowLamports)) return 'flow-exit';
    return null;
  }

  /**
   * Walk every held position and emit its exit orders. The partial
   * take-profit is handled inline here because it sells only part of the
   * position and resets the peak tracker instead of closing the trade.
   */
  function planExits(
    state: BotState,
    batch: Batch,
    orders: OrderInput[],
    cap: number,
    txFee: bigint,
  ): void {
    const marks = new Map<Pubkey, { vq: bigint; vt: bigint }>();
    for (const mark of batch.marks) {
      marks.set(mark.mint, { vq: BigInt(mark.virtual_quote_reserves), vt: BigInt(mark.virtual_token_reserves) });
    }
    for (const [mint, pos] of state.positions) {
      if (orders.length >= cap) break;
      if (selling.has(mint)) continue;
      const launch = launches.get(mint);
      let rec = open.get(mint);
      if (rec === undefined) {
        // Position appeared without a recorded fill (e.g. harness restated it);
        // adopt it with this batch's fee as its known cost.
        rec = { opened: state.slot, feesPaid: txFee, peak: 0n, makerDumpedBefore: launch?.makerDumped ?? false, partialDone: false };
        open.set(mint, rec);
      }
      let mark = marks.get(mint);
      if (mark === undefined) {
        const curve = state.curves.get(mint);
        if (curve === undefined) continue;
        mark = { vq: curve.virtual_quote_reserves, vt: curve.virtual_token_reserves };
      }
      const value = sellProceeds(pos.token_amount, mark.vq, mark.vt) - txFee;
      const basis = pos.cost_lamports + rec.feesPaid;
      if (value > rec.peak) rec.peak = value;

      // Partial take-profit: half off at +10%, the rest then guarded at +2%.
      if (basis > 0n && !rec.partialDone && P.tp1Bps < 1_000_000) {
        const target = basis * (BPS + BigInt(P.tp1Bps));
        if (value * BPS >= target) {
          const part = (pos.token_amount * BigInt(P.tp1PartBps)) / BPS;
          if (part > 0n && part < pos.token_amount) {
            orders.push({ side: 'sell', mint, token_amount: part, max_slippage_bps: 10_000 });
            selling.add(mint);
            rec.partialDone = true;
            rec.peak = 0n;
            continue;
          }
        }
      }

      const reason = exitReason(launch, rec, value, basis, state.slot);
      if (reason === null) continue;
      orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
      selling.add(mint);
      if (launch !== undefined) {
        launch.closed = true;
        launch.exitedAt = state.slot;
      }
    }
  }

  // ---- entries ---------------------------------------------------------------

  /**
   * The rug filter: reserve size, creator seed, tape shape, sell pressure and
   * run-up all have to look like a real launch rather than a bundle or a dump.
   * Returns false on the first failing check.
   */
  function passesRugFilter(launch: Launch, vq: bigint, vt: bigint, realSol: bigint): boolean {
    if (realSol < BigInt(P.minRealSol) || realSol > BigInt(P.maxRealSol)) return false;
    if (launch.makerSeed < BigInt(P.minDevBuy) || launch.makerSeed > BigInt(P.maxDevBuy)) return false;
    if (launch.tradeCount < P.minTrades) return false;
    if (launch.crowd.size < P.minBuyers || launch.crowd.size > P.maxBuyers) return false;
    if (launch.inflow > 0n && launch.outflow * BPS > launch.inflow * BigInt(P.maxSellRatioBps)) return false;
    if (launch.worstDumpBps > BigInt(P.maxBigSellBps)) return false;
    const runup = (vq * launch.baseVt * BPS) / (vt * launch.baseVq);
    if (runup > BigInt(P.maxRunupBps) || runup < BigInt(P.minRunupBps)) return false;
    return true;
  }

  /**
   * The recent-flow filter: the last few slots must still show net inflow and
   * enough distinct recent buyers.
   */
  function passesFlowFilter(launch: Launch, slot: number): boolean {
    const recent = windowFlow(launch, slot);
    if (recent.net < BigInt(P.minFlowLamports)) return false;
    if (recent.buyers < P.minRecentBuyers) return false;
    return true;
  }

  /**
   * Decide one add on an already-entered launch. Adds only press a working
   * trade: the price must have stepped up from the last buy, the tape must
   * still be flowing in, and the usual size/cash limits apply.
   */
  function tryAdd(
    state: BotState,
    launch: Launch,
    vq: bigint,
    vt: bigint,
    free: bigint,
    txFee: bigint,
  ): { order: OrderInput | null; spent: bigint } {
    if (launch.buysPlaced > P.maxAdds) return { order: null, spent: 0n };
    if (!state.positions.has(launch.mint) || selling.has(launch.mint)) return { order: null, spent: 0n };
    if (hasPending(state, launch.mint, 'buy')) return { order: null, spent: 0n };
    if (state.slot - launch.lastBuySlot < P.addDelay) return { order: null, spent: 0n };
    // Price now must be at least addStepBps above the last buy's decision price.
    const steppedUp = vq * launch.lastBuyVt * BPS >= launch.lastBuyVq * vt * BigInt(10_000 + P.addStepBps);
    if (!steppedUp) return { order: null, spent: 0n };
    if (windowFlow(launch, state.slot).net < BigInt(P.addMinFlowLamports)) return { order: null, spent: 0n };
    // The inflow must come from at least one real (non-creator) buyer in the
    // window — a lone creator wash should never justify pressing size.
    if (windowFlow(launch, state.slot).buyers < 1) return { order: null, spent: 0n };
    const cap = state.maxBuyLamports(launch.mint);
    const want = BigInt(P.addLamports);
    const amount = want < cap ? want : cap;
    // Never let an add push total spend on the coin past the planned stake.
    const room = stake - launch.lamportsPlaced;
    const sized = amount < room ? amount : room;
    if (sized < minBuy || free < sized + txFee) return { order: null, spent: 0n };
    return {
      order: { side: 'buy', mint: launch.mint, quote_lamports: sized, max_slippage_bps: P.buySlippageBps },
      spent: sized,
    };
  }

  /**
   * Walk every launch we track and emit first buys and adds. First buys go
   * through the full filter stack; adds go through tryAdd. The per-batch order
   * cap and the open-position cap are respected throughout.
   */
  function planEntries(
    state: BotState,
    orders: OrderInput[],
    cap: number,
    txFee: bigint,
  ): void {
    let free = state.freeCashLamports() - txFee * BigInt(orders.length);
    let openCount = state.committedPositionCount();
    for (const launch of launches.values()) {
      if (orders.length >= cap) break;
      if (launch.closed || launch.finished) continue;
      const age = state.slot - launch.born;
      const isAdd = launch.buysPlaced > 0;
      if (!isAdd) {
        if (age > P.maxAge) {
          launch.closed = true;
          continue;
        }
        if (age < P.minAge) continue;
        if (P.maxEntries > 0 && launch.entriesTaken >= P.maxEntries) continue;
        if (state.slot - launch.exitedAt < P.cooldown) continue;
      }
      if (openCount >= state.hello.caps.max_open_positions && !isAdd) continue;
      const curve = state.curves.get(launch.mint);
      if (curve === undefined || curve.complete) continue;
      if (launch.makerDumped && (P.skipDevSold || isAdd)) {
        if (!isAdd) launch.closed = true;
        continue;
      }
      const vq = curve.virtual_quote_reserves;
      const vt = curve.virtual_token_reserves;
      if (isAdd) {
        const add = tryAdd(state, launch, vq, vt, free, txFee);
        if (add.order === null) continue;
        orders.push(add.order);
        free -= add.spent + txFee;
        launch.buysPlaced += 1;
        launch.lamportsPlaced += add.spent;
        launch.lastBuyVq = vq;
        launch.lastBuyVt = vt;
        launch.lastBuySlot = state.slot;
        continue;
      }
      if (!passesRugFilter(launch, vq, vt, curve.real_quote_reserves)) continue;
      if (!passesFlowFilter(launch, state.slot)) continue;
      const room = stake - launch.lamportsPlaced;
      if (room < minBuy) continue;
      const maxBuy = state.maxBuyLamports(launch.mint);
      const amount = room < maxBuy ? room : maxBuy;
      if (amount < minBuy) continue;
      if (free < amount + txFee) continue;
      orders.push({ side: 'buy', mint: launch.mint, quote_lamports: amount, max_slippage_bps: P.buySlippageBps });
      free -= amount + txFee;
      launch.buysPlaced += 1;
      launch.lamportsPlaced += amount;
      launch.lastBuyVq = vq;
      launch.lastBuyVt = vt;
      launch.lastBuySlot = state.slot;
      launch.entriesTaken += 1;
      openCount += 1;
    }
  }

  return {
    onBatch(state, batch) {
      ingest(batch);
      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const txFee = state.txFeeLamports();
      settle(state, batch, txFee);
      planExits(state, batch, orders, cap, txFee);
      planEntries(state, orders, cap, txFee);
      return orders;
    },
  };
}
