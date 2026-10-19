// Session store (lld §5): owns mode, pair and the conversation history; transports are swapped under it.
import type { Lang, Mode, TimingPoint, TurnText, TurnUpdate } from "../shared/contracts.ts";
import { isTerminalState, type Timings } from "./lib.ts";

export interface Turn extends TurnUpdate {
  timings: Timings;
  vendors: Partial<Record<TimingPoint, string>>;
  error?: string;
}

export type TurnPatch = Partial<TurnUpdate> & { turnId: string };

export interface TransportEvents {
  turn(u: TurnPatch): void;
  /** t is browser time (performance.now()) */
  timing(turnId: string, point: TimingPoint, t: number, vendor?: string): void;
  notice(msg: string): void;
  /** turnId set when the error belongs to a turn; otherwise shown on the latest turn */
  error(msg: string, turnId?: string): void;
}

export interface Transport {
  start(input: MediaStream, context: TurnText[], pair: [Lang, Lang]): Promise<void>;
  stop(): void;
  /** interpreted audio as a stream (eval recording); null until available */
  output(): MediaStream | null;
  setEchoGuard(on: boolean): void;
}

export type TransportFactory = (mode: Mode, events: TransportEvents) => Transport;

export const isTerminal = (t: Turn) => isTerminalState(t.state);

export class Session {
  mode: Mode = "realtime";
  pair: [Lang, Lang] = ["en", "es"];
  turns: Turn[] = [];
  live = false;
  echoGuard = true;
  private transport: Transport | null = null;
  private input: MediaStream | null = null;
  private gen = 0;

  constructor(
    private make: TransportFactory,
    private onChange: (notice?: string, isError?: boolean) => void,
  ) {}

  /** last 5 interpreted turns, oldest first (INV-6, FR-029) */
  context(): TurnText[] {
    return this.turns
      .filter((t) => t.srcText && t.tgtText)
      .slice(-5)
      .map((t) => ({ srcText: t.srcText!, tgtText: t.tgtText!, from: t.from, to: t.to }));
  }

  output(): MediaStream | null {
    return this.transport?.output() ?? null;
  }

  async start(input: MediaStream): Promise<void> {
    this.input = input;
    this.live = true;
    const gen = ++this.gen;
    const mode = this.mode;
    const key = (id: string) => `${gen}:${id}`;
    const current = () => gen === this.gen;
    const t = this.make(mode, {
      turn: (u) => current() && this.upsert({ ...u, turnId: key(u.turnId) }, mode),
      timing: (id, point, at, vendor) => {
        if (!current()) return;
        const turn = this.upsert({ turnId: key(id) }, mode);
        turn.timings[point] = at;
        if (vendor) turn.vendors[point] = vendor;
        this.onChange();
      },
      notice: (msg) => current() && this.onChange(msg),
      error: (msg, id) => {
        if (!current()) return;
        const turn = id ? this.upsert({ turnId: key(id) }, mode) : this.turns.at(-1);
        if (turn) turn.error = msg;
        this.onChange(msg, true);
      },
    });
    this.transport = t;
    t.setEchoGuard(this.echoGuard);
    this.onChange();
    try {
      await t.start(input, this.context(), this.pair);
    } catch (e) {
      if (current()) this.stop();
      throw e;
    }
  }

  stop(): void {
    this.gen++;
    this.transport?.stop();
    this.transport = null;
    this.live = false;
    this.onChange();
  }

  /** Mode is switchable before and during a session; mid-session the new transport gets the last 5 turns. */
  async setMode(mode: Mode): Promise<void> {
    if (mode === this.mode) return;
    this.mode = mode;
    if (!this.live || !this.input) return this.onChange();
    const input = this.input;
    this.stop();
    await this.start(input);
  }

  setEchoGuard(on: boolean): void {
    this.echoGuard = on;
    this.transport?.setEchoGuard(on);
  }

  private upsert(u: TurnPatch, mode: Mode): Turn {
    let turn = this.turns.find((t) => t.turnId === u.turnId);
    if (!turn) {
      turn = {
        seq: this.turns.length,
        mode,
        state: "hearing",
        from: this.pair[0],
        to: this.pair[1],
        timings: {},
        vendors: {},
        ...u,
      } as Turn;
      this.turns.push(turn);
    } else {
      for (const [k, v] of Object.entries(u))
        if (v !== undefined) (turn as unknown as Record<string, unknown>)[k] = v;
    }
    this.onChange();
    return turn;
  }
}
