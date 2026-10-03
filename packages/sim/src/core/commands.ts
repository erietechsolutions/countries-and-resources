import {
  closeBusiness,
  foundBusiness,
  investInBusiness,
  openLocation,
  raiseInvestment,
  sellBusiness,
  setPolicy,
  setStaff,
  upgradeLocation,
  withdrawFromBusiness,
  type PriceLevel,
  type WageLevel,
} from "../business/business";
import type { CredentialId } from "../education/courses";
import { repayDebt, takeLoan } from "../finance/finance";
import { cancelActivity, startActivity } from "../life/activities";
import { moveBackHome, rentUnit } from "../life/housing";
import type { ItemId } from "../life/items";
import { applyForVisa, moveTo, naturalize, type VisaType } from "../life/moving";
import { buyItem, dropCourse, enroll, sellItem } from "../life/shopping";
import type { UnitType } from "../life/types";
import { performSocialAction, type SocialAction } from "../social/social";
import { acceptOffer, leaveJob } from "../work/jobs";
import type { Sector } from "../work/occupations";
import type { GameContext } from "./game";

/**
 * Every action that changes the game goes through a command: the player's clicks, AI decisions
 * and (later) messages from multiplayer clients. Commands are plain serializable objects that
 * are validated before they are applied, so the same rules apply to everyone.
 */
export type Command =
  | { type: "debug.grantCash"; amountCents: number }
  | { type: "activity.start"; activityId: string; amount?: number; targetId?: string }
  | { type: "social.action"; personId: string; action: SocialAction }
  | { type: "business.found"; name: string; sector: Sector; capitalCents: number }
  | { type: "business.staff"; businessId: string; employees: number }
  | {
      type: "business.policy";
      businessId: string;
      wageLevel?: WageLevel;
      priceLevel?: PriceLevel;
      marketingCents?: number;
    }
  | { type: "business.invest"; businessId: string; amountCents: number }
  | { type: "business.withdraw"; businessId: string; amountCents: number }
  | { type: "business.openLocation"; businessId: string; cityId: number }
  | { type: "business.upgrade"; businessId: string; locationIndex: number }
  | { type: "business.raise"; businessId: string; sharePercent: number }
  | { type: "business.sell"; businessId: string }
  | { type: "business.close"; businessId: string }
  | { type: "move.to"; cityId: number; illegal?: boolean }
  | { type: "immigration.apply"; countryId: string; visa: VisaType }
  | { type: "immigration.naturalize" }
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
  "activity.start": (ctx, cmd) =>
    alive(ctx) ?? startActivity(ctx, cmd.activityId, cmd.amount, cmd.targetId),
  "social.action": (ctx, cmd) => alive(ctx) ?? performSocialAction(ctx, cmd.personId, cmd.action),
  "business.found": (ctx, cmd) =>
    alive(ctx) ?? foundBusiness(ctx, cmd.name, cmd.sector, cmd.capitalCents),
  "business.staff": (ctx, cmd) => setStaff(ctx, cmd.businessId, cmd.employees),
  "business.policy": (ctx, cmd) => setPolicy(ctx, cmd.businessId, cmd),
  "business.invest": (ctx, cmd) => investInBusiness(ctx, cmd.businessId, cmd.amountCents),
  "business.withdraw": (ctx, cmd) => withdrawFromBusiness(ctx, cmd.businessId, cmd.amountCents),
  "business.openLocation": (ctx, cmd) => openLocation(ctx, cmd.businessId, cmd.cityId),
  "business.upgrade": (ctx, cmd) => upgradeLocation(ctx, cmd.businessId, cmd.locationIndex),
  "business.raise": (ctx, cmd) => raiseInvestment(ctx, cmd.businessId, cmd.sharePercent),
  "business.sell": (ctx, cmd) => sellBusiness(ctx, cmd.businessId),
  "business.close": (ctx, cmd) => closeBusiness(ctx, cmd.businessId),
  "move.to": (ctx, cmd) => alive(ctx) ?? moveTo(ctx, cmd.cityId, cmd.illegal ?? false),
  "immigration.apply": (ctx, cmd) => alive(ctx) ?? applyForVisa(ctx, cmd.countryId, cmd.visa),
  "immigration.naturalize": (ctx) => alive(ctx) ?? naturalize(ctx),
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
