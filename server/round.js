import { CONFIG } from '../shared/config.js';
import { rnd } from './rng.js';

// Timed events give the floor a rhythm and hand losers a comeback window.
export const EVENTS = [
  { id: 'happy_hour',  name: 'HAPPY HOUR',   desc: 'Slot machines pay DOUBLE' },
  { id: 'hot_red',     name: 'SEEING RED',   desc: 'Roulette RED pays 3:1' },
  { id: 'loaded_dice', name: 'LOADED DICE',  desc: 'The dice pit drops its house edge' },
  { id: 'rocket_fuel', name: 'ROCKET FUEL',  desc: 'The Rocket cannot crash below 1.50x' },
  { id: 'photo_finish',name: 'PHOTO FINISH', desc: 'Winning race tickets pay +50%' },
  { id: 'lucky_21',    name: 'LUCKY 21',     desc: 'Blackjack pays 2:1' },
];

export const LAST_CALL = { id: 'last_call', name: 'LAST CALL', desc: 'Every payout on the floor is x1.25' };

const FIRST_EVENT_AT = 70;   // seconds into the round
const EVENT_EVERY = 100;
const EVENT_LENGTH = 55;
const LAST_CALL_AT = 60;     // seconds remaining

export class Round {
  constructor(room) {
    this.room = room;
    this.number = 0;
    this.phase = 'lobby';
    this.endsAt = 0;
    this.event = null;
    this.eventEndsAt = 0;
    this.nextEventAt = 0;
    this.recent = [];
  }

  start() {
    this.number++;
    this.phase = 'live';
    this.startedAt = Date.now();
    this.endsAt = this.startedAt + CONFIG.ROUND_SECONDS * 1000;
    this.event = null;
    this.eventEndsAt = 0;
    this.nextEventAt = this.startedAt + FIRST_EVENT_AT * 1000;
    this.lastCallFired = false;
    this.room.resetBankrolls();
    this.room.resetGames();
    this.room.broadcast('round', this.state());
    this.room.toastAll(`ROUND ${this.number} — 10 MINUTES. GO WIN SOMETHING.`, 'round');
  }

  endIntermission() {
    this.phase = 'intermission';
    this.endsAt = Date.now() + CONFIG.INTERMISSION_SECONDS * 1000;
    this.event = null;
    // Settle up before the scores are frozen.
    this.room.abortOpenBets();
    this.room.broadcast('finals', this.room.standings());
    this.room.broadcast('round', this.state());
  }

  tick(now) {
    if (this.phase === 'lobby') {
      if (this.room.players.size > 0) this.start();
      return;
    }

    if (this.phase === 'intermission') {
      if (now >= this.endsAt) {
        if (this.room.players.size > 0) this.start();
        else { this.phase = 'lobby'; this.room.broadcast('round', this.state()); }
      }
      return;
    }

    // live
    const remaining = (this.endsAt - now) / 1000;

    if (!this.lastCallFired && remaining <= LAST_CALL_AT) {
      this.lastCallFired = true;
      this._setEvent(LAST_CALL, remaining);
      this.nextEventAt = Infinity;
    } else if (this.event && now >= this.eventEndsAt) {
      this.event = null;
      this.room.broadcast('round', this.state());
    } else if (!this.event && now >= this.nextEventAt && remaining > LAST_CALL_AT + 10) {
      this._setEvent(this._rollEvent(), EVENT_LENGTH);
      this.nextEventAt = now + EVENT_EVERY * 1000;
    }

    if (now >= this.endsAt) this.endIntermission();
  }

  _rollEvent() {
    const pool = EVENTS.filter((e) => !this.recent.includes(e.id));
    const list = pool.length ? pool : EVENTS;
    const picked = list[Math.floor(rnd() * list.length)];
    this.recent = [picked.id, ...this.recent].slice(0, 3);
    return picked;
  }

  _setEvent(ev, seconds) {
    this.event = ev;
    this.eventEndsAt = Date.now() + seconds * 1000;
    this.room.broadcast('round', this.state());
    this.room.toastAll(`${ev.name} — ${ev.desc}`, 'event');
  }

  /** Global multiplier applied to every winning payout on the floor. */
  payBoost() {
    return this.event && this.event.id === 'last_call' ? 1.25 : 1;
  }

  eventId() {
    return this.event ? this.event.id : null;
  }

  state() {
    return {
      phase: this.phase,
      number: this.number,
      endsAt: this.endsAt,
      serverNow: Date.now(),
      event: this.event ? { ...this.event, endsAt: this.eventEndsAt } : null,
    };
  }
}
