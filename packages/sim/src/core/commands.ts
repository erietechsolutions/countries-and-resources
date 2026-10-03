import type { CredentialId } from "../education/courses";
import { repayDebt, takeLoan } from "../finance/finance";
import { cancelActivity, startActivity } from "../life/activities";
import { moveBackHome, rentUnit } from "../life/housing";
import type { ItemId } from "../life/items";
import { buyItem, dropCourse, enroll, sellItem } from "../life/shopping";
import type { UnitType } from "../life/types";
import { acceptOffer, leaveJob } from "../work/jobs";
import type { GameContext } from "./game";

/**
 * Every action that changes the game goes through a command: the player's clicks, AI decisions
 * and (later) messages from multiplayer clients. Commands are plain serializable objects that
 * are validated before they are applied, so the same rules apply to everyone.
 */
export type Command =
  | { type: "debug.grantCash"; amountCents: number }
  | { type: "activity.start"; activityId: string; amount?: number }
  | { type: "activity.cancel" }
  | { type: "job.accept"; offerId: string }
  | { type: "job.decline"; offerId: string }
  | { type: "job.quit" }
  | { type: "job.setAutoWork"; enabled: boolean }
  | { type: "housing.rent"; unit: UnitType }
  | { type: "housing.moveBackHome" }
  | { type: "shop.buy"; item: ItemId }
  | { type: "shop.sell"; item: ItemId }
  | { type: "education.enroll"; course: CredentialId }
  | { type: "education.drop" }
  | { type: "loan.take"; kind: "payday" | "personal"; amountCents: number }
  | { type: "debt.repay"; debtId: string; amountCents: number };

export type CommandType = Command["type"];
type CommandOf<T extends CommandType> = Extract<Command, { type: T }>;

/**
 * Applies a command, returning a reason it was refused (or null on success). Validation and
 * application happen together so a refused command never leaves partial changes behind.
 */
export type CommandHandler<T extends CommandType> = (
  ctx: GameContext,
  command: CommandOf<T>,
) => string | null;

export type CommandHandlers = { [T in CommandType]: CommandHandler<T> };

const alive = (ctx: GameContext) =>
  ctx.state.player.alive ? null : "Your character is no longer alive.";

export const commandHandlers: CommandHandlers = {
  "debug.grantCash": (ctx, cmd) => {
    if (!Number.isInteger(cmd.amountCents)) return "Amount must be a whole number of cents.";
    ctx.state.player.cashCents += cmd.amountCents;
    return null;
  },
  "activity.start": (ctx, cmd) => alive(ctx) ?? startActivity(ctx, cmd.activityId, cmd.amount),
  "activity.cancel": (ctx) => cancelActivity(ctx),
  "job.accept": (ctx, cmd) => alive(ctx) ?? acceptOffer(ctx, cmd.offerId),
  "job.decline": (ctx, cmd) => {
    const p = ctx.state.player;
    if (!p.jobOffers.some((o) => o.id === cmd.offerId)) return "That offer no longer exists.";
    p.jobOffers = p.jobOffers.filter((o) => o.id !== cmd.offerId);
    return null;
  },
  "job.quit": (ctx) => {
    if (!ctx.state.player.job) return "You don't have a job.";
    leaveJob(ctx, "You quit your job.");
    return null;
  },
  "job.setAutoWork": (ctx, cmd) => {
    ctx.state.player.prefs.autoWork = cmd.enabled;
    return null;
  },
  "housing.rent": (ctx, cmd) => alive(ctx) ?? rentUnit(ctx, cmd.unit),
  "housing.moveBackHome": (ctx) => alive(ctx) ?? moveBackHome(ctx),
  "shop.buy": (ctx, cmd) => alive(ctx) ?? buyItem(ctx, cmd.item),
  "shop.sell": (ctx, cmd) => alive(ctx) ?? sellItem(ctx, cmd.item),
  "education.enroll": (ctx, cmd) => alive(ctx) ?? enroll(ctx, cmd.course),
  "education.drop": (ctx) => dropCourse(ctx),
  "loan.take": (ctx, cmd) => alive(ctx) ?? takeLoan(ctx, cmd.kind, cmd.amountCents),
  "debt.repay": (ctx, cmd) => repayDebt(ctx, cmd.debtId, cmd.amountCents),
};

export type CommandResult = { ok: true } | { ok: false; reason: string };
