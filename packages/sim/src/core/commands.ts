import type { GameContext } from "./game";

/**
 * Every action that changes the game goes through a command: the player's clicks, AI decisions
 * and (later) messages from multiplayer clients. Commands are plain serializable objects that
 * are validated before they are applied, so the same rules apply to everyone.
 */
export type Command = { type: "debug.grantCash"; amountCents: number };

export type CommandType = Command["type"];
type CommandOf<T extends CommandType> = Extract<Command, { type: T }>;

export interface CommandHandler<T extends CommandType> {
  /** Returns a reason the command cannot be applied, or null if it is allowed. */
  validate(ctx: GameContext, command: CommandOf<T>): string | null;
  apply(ctx: GameContext, command: CommandOf<T>): void;
}

export type CommandHandlers = { [T in CommandType]: CommandHandler<T> };

export const commandHandlers: CommandHandlers = {
  "debug.grantCash": {
    validate: (_ctx, cmd) =>
      Number.isInteger(cmd.amountCents) ? null : "Amount must be a whole number of cents.",
    apply: (ctx, cmd) => {
      ctx.state.player.cashCents += cmd.amountCents;
    },
  },
};

export type CommandResult = { ok: true } | { ok: false; reason: string };
