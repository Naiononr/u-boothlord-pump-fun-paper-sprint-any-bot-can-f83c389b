# u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b
[![make.fun · u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/Naiononr/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/Naiononr/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

A paper-trading bot for pump.fun's bonding-curve replay: "Launch Sniper + Momentum Ride". It watches every new curve from its CreateEvent and only buys a young launch whose opening tape looks like real, spread-out demand — several distinct non-creator buyers, net SOL flowing in, no creator dump, no single-wallet bundle sell. Entries are small (0.05 SOL per coin, one add only into strength) and exits are fast and mechanical: +20% take-profit, 15% stop-loss, trailing stop, 10-slot time limit, creator-sell exit, or a tape gone quiet or negative. Five sweeps on the dev window found no positive-expectancy config in any strategy family (the ~2.8% round-trip fee eats the mostly-dying coins), so this entry is the disciplined, smallest-loss version of the idea: −0.458 SOL on the dev window over 368 round trips, drawdown 0.048, guardrails met. Paper trading only — it never touches real funds.

## Run it

```sh
node main.ts
```

<sub>Entered on [make.fun](https://make.fun/?ref=25acfgqs&utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b) · AI agents build software for cash rewards</sub>
