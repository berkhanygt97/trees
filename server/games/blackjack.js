// Six-deck shoe, dealer stands on all 17s, blackjack pays 3:2.
// No splits (keeps the round moving); double is allowed on the first two cards.
import { shuffle } from '../rng.js';

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['S', 'H', 'D', 'C'];

function freshShoe() {
  const cards = [];
  for (let d = 0; d < 6; d++) {
    for (const s of SUITS) for (const r of RANKS) cards.push({ r, s });
  }
  return shuffle(cards);
}

export function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.r === 'A') { aces++; total += 11; }
    else if (c.r === 'K' || c.r === 'Q' || c.r === 'J' || c.r === '10') total += 10;
    else total += Number(c.r);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}

const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21;

export class Blackjack {
  constructor() {
    this.shoe = freshShoe();
    this.hands = new Map(); // playerId -> hand
  }

  draw() {
    if (this.shoe.length < 80) this.shoe = freshShoe();
    return this.shoe.pop();
  }

  stateFor(playerId) {
    const h = this.hands.get(playerId);
    if (!h) return { phase: 'idle' };
    return {
      phase: h.phase,
      bet: h.bet,
      player: h.player,
      playerTotal: handValue(h.player).total,
      dealer: h.phase === 'player' ? [h.dealer[0], { hidden: true }] : h.dealer,
      dealerTotal: h.phase === 'player' ? handValue([h.dealer[0]]).total : handValue(h.dealer).total,
      canDouble: h.phase === 'player' && h.player.length === 2,
      outcome: h.outcome || null,
      payout: h.payout || 0,
    };
  }

  /** Returns { ok, error?, settled? } — `settled` means chips move right away. */
  deal(playerId, bet) {
    const existing = this.hands.get(playerId);
    if (existing && existing.phase === 'player') return { ok: false, error: 'Finish your hand first' };

    const hand = {
      bet, phase: 'player',
      player: [this.draw(), this.draw()],
      dealer: [this.draw(), this.draw()],
      outcome: null, payout: 0,
    };
    this.hands.set(playerId, hand);

    if (isBlackjack(hand.player) || isBlackjack(hand.dealer)) {
      return { ok: true, settled: this._settle(hand) };
    }
    return { ok: true };
  }

  action(playerId, act, bjBonus = false) {
    const h = this.hands.get(playerId);
    if (!h || h.phase !== 'player') return { ok: false, error: 'No hand in play' };
    h.bjBonus = bjBonus;

    if (act === 'hit') {
      h.player.push(this.draw());
      if (handValue(h.player).total >= 21) return { ok: true, settled: this._settle(h) };
      return { ok: true };
    }
    if (act === 'double') {
      if (h.player.length !== 2) return { ok: false, error: 'Double only on your first two cards' };
      h.doubled = true;
      h.bet *= 2;
      h.player.push(this.draw());
      return { ok: true, settled: this._settle(h), extraStake: h.bet / 2 };
    }
    if (act === 'stand') return { ok: true, settled: this._settle(h) };
    return { ok: false, error: 'Unknown action' };
  }

  _settle(h) {
    const pv = handValue(h.player).total;

    if (pv <= 21) {
      while (handValue(h.dealer).total < 17) h.dealer.push(this.draw());
    }
    const dv = handValue(h.dealer).total;
    const pBJ = isBlackjack(h.player);
    const dBJ = isBlackjack(h.dealer);

    let outcome, payout;
    if (pBJ && dBJ) { outcome = 'push'; payout = h.bet; }
    else if (pBJ) { outcome = 'blackjack'; payout = Math.round(h.bet * (h.bjBonus ? 3 : 2.5)); }
    else if (dBJ) { outcome = 'dealer_blackjack'; payout = 0; }
    else if (pv > 21) { outcome = 'bust'; payout = 0; }
    else if (dv > 21) { outcome = 'dealer_bust'; payout = h.bet * 2; }
    else if (pv > dv) { outcome = 'win'; payout = h.bet * 2; }
    else if (pv < dv) { outcome = 'lose'; payout = 0; }
    else { outcome = 'push'; payout = h.bet; }

    h.phase = 'done';
    h.outcome = outcome;
    h.payout = payout;
    return { outcome, payout, bet: h.bet };
  }

  clear(playerId) { this.hands.delete(playerId); }

  /** Round over: any hand still mid-play is voided and the bet returned. */
  abort(refund) {
    for (const [playerId, hand] of this.hands) {
      if (hand.phase === 'player') refund(playerId, hand.bet);
    }
    this.hands.clear();
  }
}
