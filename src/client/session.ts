// Session store (lld §5): owns mode, pair and the conversation history; transports are swapped under it.
import type { LanguageCode, Mode, TimingPoint, TurnText, TurnUpdate } from "../shared/contracts.ts";
import { isFinishedState, type Timings } from "./timing-and-audio-helpers.ts";

export interface Turn extends TurnUpdate {
  timings: Timings;
  vendors: Partial<Record<TimingPoint, string>>;
  error?: string;
}

export type TurnPatch = Partial<TurnUpdate> & { turnId: string };

export interface TransportEvents {
  turn(patch: TurnPatch): void;
  /** atMs is browser time (performance.now()) */
  timing(turnId: string, point: TimingPoint, atMs: number, vendor?: string): void;
  notice(message: string): void;
  /** turnId set when the error belongs to a turn; otherwise shown on the latest turn */
  error(message: string, turnId?: string): void;
}

export interface Transport {
  start(input: MediaStream, context: TurnText[], pair: [LanguageCode, LanguageCode]): Promise<void>;
  stop(): void;
  /** interpreted audio as a stream (eval recording); null until available */
  output(): MediaStream | null;
  setEchoGuard(on: boolean): void;
}

export type TransportFactory = (mode: Mode, events: TransportEvents) => Transport;

export const isTurnFinished = (turn: Turn) => isFinishedState(turn.state);

export class Session {
  mode: Mode = "realtime";
  pair: [LanguageCode, LanguageCode] = ["en", "es"];
  turns: Turn[] = [];
  live = false;
  echoGuard = true;
  private transport: Transport | null = null;
  private input: MediaStream | null = null;
  /** bumped on every start/stop, so events from a replaced transport are ignored */
  private generation = 0;

  constructor(
    private createTransport: TransportFactory,
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
    const generation = ++this.generation;
    const mode = this.mode;
    const scopedTurnId = (id: string) => `${generation}:${id}`;
    const isCurrentGeneration = () => generation === this.generation;
    const transport = this.createTransport(mode, {
      turn: (patch) =>
        isCurrentGeneration() && this.upsertTurn({ ...patch, turnId: scopedTurnId(patch.turnId) }, mode),
      timing: (id, point, atMs, vendor) => {
        if (!isCurrentGeneration()) return;
        const turn = this.upsertTurn({ turnId: scopedTurnId(id) }, mode);
        turn.timings[point] = atMs;
        if (vendor) turn.vendors[point] = vendor;
        this.onChange();
      },
      notice: (message) => isCurrentGeneration() && this.onChange(message),
      error: (message, id) => {
        if (!isCurrentGeneration()) return;
        const turn = id ? this.upsertTurn({ turnId: scopedTurnId(id) }, mode) : this.turns.at(-1);
        if (turn) turn.error = message;
        this.onChange(message, true);
      },
    });
    this.transport = transport;
    transport.setEchoGuard(this.echoGuard);
    this.onChange();
    try {
      await transport.start(input, this.context(), this.pair);
    } catch (e) {
      if (isCurrentGeneration()) this.stop();
      throw e;
    }
  }

  stop(): void {
    this.generation++;
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

  private upsertTurn(patch: TurnPatch, mode: Mode): Turn {
    let turn = this.turns.find((t) => t.turnId === patch.turnId);
    if (!turn) {
      turn = {
        seq: this.turns.length,
        mode,
        state: "hearing",
        from: this.pair[0],
        to: this.pair[1],
        timings: {},
        vendors: {},
        ...patch,
      } as Turn;
      this.turns.push(turn);
    } else {
      for (const [key, value] of Object.entries(patch))
        if (value !== undefined) (turn as unknown as Record<string, unknown>)[key] = value;
    }
    this.onChange();
    return turn;
  }
}
