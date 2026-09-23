import { rnd } from './rng.js';

// There are no rounds any more: money is permanent. The casino keeps its
// rhythm with a rotating event, so there is always a reason to drive into town.
export const EVENTS = [
  { id: 'happy_hour',  name: 'HAPPY HOUR',   desc: 'Slot machines pay DOUBLE' },
  { id: 'hot_red',     name: 'SEEING RED',   desc: 'Roulette RED pays 3:1' },
  { id: 'loaded_dice', name: 'LOADED DICE',  desc: 'The dice pit drops its house edge' },
  { id: 'rocket_fuel', name: 'ROCKET FUEL',  desc: 'The Rocket cannot crash below 1.50x' },
  { id: 'photo_finish',name: 'PHOTO FINISH', desc: 'Winning race tickets pay +50%' },
  { id: 'lucky_21',    name: 'LUCKY 21',     desc: 'Blackjack pays 2:1' },
  { id: 'robot_rage',  name: 'ROBOT RAGE',   desc: 'Winning robot tickets pay +50%' },
];

const FIRST_EVENT_AFTER = 90;   // seconds after the server starts
const EVENT_EVERY = 240;        // one starts every four minutes...
const EVENT_LENGTH = 90;        // ...and runs for a minute and a half

export class CasinoEvents {
  constructor(room) {
    this.room = room;
    this.event = null;
    this.eventEndsAt = 0;
    this.nextEventAt = Date.now() + FIRST_EVENT_AFTER * 1000;
    this.recent = [];
  }

  tick(now) {
    if (this.event && now >= this.eventEndsAt) {
      this.event = null;
      this.room.broadcast('round', this.state());
    } else if (!this.event && now >= this.nextEventAt && this.room.players.size > 0) {
      this._setEvent(this._rollEvent(), EVENT_LENGTH);
      this.nextEventAt = now + EVENT_EVERY * 1000;
    }
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
    this.room.toastAll(`CASINO: ${ev.name} — ${ev.desc}`, 'event');
  }

  /** Kept for the games' payout hook; nothing boosts every payout any more. */
  payBoost() { return 1; }

  eventId() {
    return this.event ? this.event.id : null;
  }

  state() {
    return {
      phase: 'live',
      serverNow: Date.now(),
      event: this.event ? { ...this.event, endsAt: this.eventEndsAt } : null,
    };
  }
}
