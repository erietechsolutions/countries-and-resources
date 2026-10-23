import {
  closeBusiness,
  foundBusiness,
  listOnStockMarket,
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
import {
  arm,
  disbandMilitia,
  foundMilitia,
  launchAttack,
  recruit,
  setOrders,
} from "../conflict/militia";
import { callReferendum, declareIndependence } from "../conflict/nation";
import type { MilitiaOrders, WarGoal, WarStance } from "../conflict/types";
import {
  breakAlliance,
  declareWar,
  improveRelations,
  proposeAlliance,
  proposeCeasefire,
  proposePeace,
  setMilitarySpending,
  setWarPlan,
} from "../conflict/war";
import { governmentAction, type GovernmentAction } from "../statecraft/statecraft";
import { chooseHeir } from "../life/aging";
import type { HoldingKind, PropertyKind } from "../wealth/types";
import {
  buyInvestment,
  buyMedia,
  buyProperty,
  donate,
  lobby,
  moveIntoProperty,
  moveOffshore,
  moveSavings,
  renovateProperty,
  sellInvestment,
  sellMedia,
  sellProperty,
  setMediaLine,
  setRentedOut,
} from "../wealth/wealth";
import type { CityId, CountryId, ProvinceId } from "../world/geography";
import type { GovernmentType } from "../world/types";
import { embezzle, joinGang, leaveGang, resolveCase, type CaseChoice } from "../crime/crime";
import { investigate, reconcile } from "../ai/rivals";
import type { CredentialId } from "../education/courses";
import { chooseEventOption } from "../events/storyEvents";
import { repayDebt, takeLoan } from "../finance/finance";
import { cancelActivity, startActivity } from "../life/activities";
import { setLifestyle, type Lifestyle } from "../life/lifestyle";
import { moveBackHome, rentUnit } from "../life/housing";
import type { ItemId } from "../life/items";
import { castVote, proposeBill, signBill } from "../politics/bills";
import { fileCandidacy, spendOnAds, withdrawCandidacy } from "../politics/elections";
import { foundParty, joinParty, leaveParty } from "../politics/party";
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
  | { type: "politics.join"; partyId: string }
  | { type: "politics.leave" }
  | { type: "politics.found"; name: string; preset: string }
  | { type: "politics.file"; electionId: string }
  | { type: "politics.withdraw" }
  | { type: "politics.ads"; amountCents: number }
  | { type: "politics.propose"; officeId: string; policyId: string; direction: 1 | -1 }
  | { type: "politics.vote"; billId: string; vote: "yes" | "no" }
  | { type: "politics.sign"; billId: string; sign: boolean }
  | { type: "legal.resolve"; choice: CaseChoice }
  | { type: "crime.joinGang" }
  | { type: "crime.leaveGang" }
  | { type: "crime.embezzle"; amountCents: number }
  | { type: "event.choose"; index: number }
  | { type: "rival.reconcile"; personId: string }
  | { type: "rival.investigate"; personId: string }
  | { type: "militia.found"; name: string }
  | { type: "militia.recruit"; count: number }
  | { type: "militia.arm"; amountCents: number }
  | { type: "militia.orders"; orders: MilitiaOrders }
  | { type: "militia.attack"; provinceId: ProvinceId; lead: boolean }
  | { type: "militia.disband" }
  | { type: "nation.declare"; name: string; government: GovernmentType }
  | { type: "nation.referendum"; name: string; government: GovernmentType }
  | { type: "diplomacy.improve"; countryId: CountryId }
  | { type: "diplomacy.ally"; countryId: CountryId }
  | { type: "diplomacy.breakAlliance"; countryId: CountryId }
  | { type: "war.declare"; countryId: CountryId; goal?: WarGoal }
  | { type: "war.plan"; warId: string; stance: WarStance; objective: ProvinceId | null }
  | { type: "war.ceasefire"; warId: string }
  | { type: "gov.action"; action: GovernmentAction }
  | { type: "war.peace"; warId: string }
  | { type: "military.spending"; level: number }
  | { type: "succession.choose"; personId: string }
  | { type: "savings.move"; amountCents: number }
  | { type: "offshore.move"; amountCents: number }
  | { type: "invest.buy"; kind: HoldingKind; target: string; amountCents: number }
  | { type: "invest.sell"; holdingId: string; fraction: number }
  | { type: "property.buy"; cityId: CityId; kind: PropertyKind; mortgage: boolean }
  | { type: "property.sell"; propertyId: string }
  | { type: "property.renovate"; propertyId: string }
  | { type: "property.rentOut"; propertyId: string; rentOut: boolean }
  | { type: "property.moveIn"; propertyId: string }
  | { type: "influence.donate"; partyId: string; amountCents: number }
  | { type: "influence.lobby"; policyId: string; direction: 1 | -1 }
  | { type: "media.buy" }
  | { type: "media.line"; outletId: string; partyId: string | null }
  | { type: "media.sell"; outletId: string }
  | { type: "business.ipo"; businessId: string }
  | { type: "activity.cancel" }
  | { type: "job.accept"; offerId: string }
  | { type: "job.decline"; offerId: string }
  | { type: "job.quit" }
  | { type: "job.setAutoWork"; enabled: boolean }
  | { type: "housing.rent"; unit: UnitType }
  | { type: "housing.moveBackHome" }
  | { type: "lifestyle.set"; lifestyle: Lifestyle }
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
  "move.to": (ctx, cmd) =>
    alive(ctx) ??
    (ctx.state.config.mode === "leader"
      ? "A leader governs from the capital."
      : moveTo(ctx, cmd.cityId, cmd.illegal ?? false)),
  "immigration.apply": (ctx, cmd) => alive(ctx) ?? applyForVisa(ctx, cmd.countryId, cmd.visa),
  "immigration.naturalize": (ctx) => alive(ctx) ?? naturalize(ctx),
  "politics.join": (ctx, cmd) => alive(ctx) ?? joinParty(ctx, cmd.partyId),
  "politics.leave": (ctx) => leaveParty(ctx),
  "politics.found": (ctx, cmd) => alive(ctx) ?? foundParty(ctx, cmd.name, cmd.preset),
  "politics.file": (ctx, cmd) => alive(ctx) ?? fileCandidacy(ctx, cmd.electionId),
  "politics.withdraw": (ctx) => withdrawCandidacy(ctx),
  "politics.ads": (ctx, cmd) => spendOnAds(ctx, cmd.amountCents),
  "politics.propose": (ctx, cmd) =>
    alive(ctx) ?? proposeBill(ctx, cmd.officeId, cmd.policyId, cmd.direction),
  "politics.vote": (ctx, cmd) => castVote(ctx, cmd.billId, cmd.vote),
  "politics.sign": (ctx, cmd) => signBill(ctx, cmd.billId, cmd.sign),
  "legal.resolve": (ctx, cmd) => resolveCase(ctx, cmd.choice),
  "crime.joinGang": (ctx) => alive(ctx) ?? joinGang(ctx),
  "crime.leaveGang": (ctx) => leaveGang(ctx),
  "crime.embezzle": (ctx, cmd) => alive(ctx) ?? embezzle(ctx, cmd.amountCents),
  "event.choose": (ctx, cmd) => chooseEventOption(ctx, cmd.index),
  "rival.reconcile": (ctx, cmd) => alive(ctx) ?? reconcile(ctx, cmd.personId),
  "rival.investigate": (ctx, cmd) => alive(ctx) ?? investigate(ctx, cmd.personId),
  "militia.found": (ctx, cmd) => alive(ctx) ?? foundMilitia(ctx, cmd.name),
  "militia.recruit": (ctx, cmd) => alive(ctx) ?? recruit(ctx, cmd.count),
  "militia.arm": (ctx, cmd) => alive(ctx) ?? arm(ctx, cmd.amountCents),
  "militia.orders": (ctx, cmd) => alive(ctx) ?? setOrders(ctx, cmd.orders),
  "militia.attack": (ctx, cmd) => alive(ctx) ?? launchAttack(ctx, cmd.provinceId, cmd.lead),
  "militia.disband": (ctx) => alive(ctx) ?? disbandMilitia(ctx),
  "nation.declare": (ctx, cmd) => alive(ctx) ?? declareIndependence(ctx, cmd.name, cmd.government),
  "nation.referendum": (ctx, cmd) => alive(ctx) ?? callReferendum(ctx, cmd.name, cmd.government),
  "diplomacy.improve": (ctx, cmd) => alive(ctx) ?? improveRelations(ctx, cmd.countryId),
  "diplomacy.ally": (ctx, cmd) => alive(ctx) ?? proposeAlliance(ctx, cmd.countryId),
  "diplomacy.breakAlliance": (ctx, cmd) => alive(ctx) ?? breakAlliance(ctx, cmd.countryId),
  "war.declare": (ctx, cmd) => alive(ctx) ?? declareWar(ctx, cmd.countryId, cmd.goal),
  "war.plan": (ctx, cmd) => alive(ctx) ?? setWarPlan(ctx, cmd.warId, cmd.stance, cmd.objective),
  "war.ceasefire": (ctx, cmd) => alive(ctx) ?? proposeCeasefire(ctx, cmd.warId),
  "gov.action": (ctx, cmd) => alive(ctx) ?? governmentAction(ctx, cmd.action),
  "war.peace": (ctx, cmd) => alive(ctx) ?? proposePeace(ctx, cmd.warId),
  "military.spending": (ctx, cmd) => alive(ctx) ?? setMilitarySpending(ctx, cmd.level),
  "succession.choose": (ctx, cmd) => chooseHeir(ctx, cmd.personId),
  "savings.move": (ctx, cmd) => alive(ctx) ?? moveSavings(ctx, cmd.amountCents),
  "offshore.move": (ctx, cmd) => alive(ctx) ?? moveOffshore(ctx, cmd.amountCents),
  "invest.buy": (ctx, cmd) =>
    alive(ctx) ?? buyInvestment(ctx, cmd.kind, cmd.target, cmd.amountCents),
  "invest.sell": (ctx, cmd) => alive(ctx) ?? sellInvestment(ctx, cmd.holdingId, cmd.fraction),
  "property.buy": (ctx, cmd) => alive(ctx) ?? buyProperty(ctx, cmd.cityId, cmd.kind, cmd.mortgage),
  "property.sell": (ctx, cmd) => alive(ctx) ?? sellProperty(ctx, cmd.propertyId),
  "property.renovate": (ctx, cmd) => alive(ctx) ?? renovateProperty(ctx, cmd.propertyId),
  "property.rentOut": (ctx, cmd) => alive(ctx) ?? setRentedOut(ctx, cmd.propertyId, cmd.rentOut),
  "property.moveIn": (ctx, cmd) => alive(ctx) ?? moveIntoProperty(ctx, cmd.propertyId),
  "influence.donate": (ctx, cmd) => alive(ctx) ?? donate(ctx, cmd.partyId, cmd.amountCents),
  "influence.lobby": (ctx, cmd) => alive(ctx) ?? lobby(ctx, cmd.policyId, cmd.direction),
  "media.buy": (ctx) => alive(ctx) ?? buyMedia(ctx),
  "media.line": (ctx, cmd) => alive(ctx) ?? setMediaLine(ctx, cmd.outletId, cmd.partyId),
  "media.sell": (ctx, cmd) => alive(ctx) ?? sellMedia(ctx, cmd.outletId),
  "business.ipo": (ctx, cmd) => alive(ctx) ?? listOnStockMarket(ctx, cmd.businessId),
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
  "lifestyle.set": (ctx, cmd) => alive(ctx) ?? setLifestyle(ctx, cmd.lifestyle),
  "shop.buy": (ctx, cmd) => alive(ctx) ?? buyItem(ctx, cmd.item),
  "shop.sell": (ctx, cmd) => alive(ctx) ?? sellItem(ctx, cmd.item),
  "education.enroll": (ctx, cmd) => alive(ctx) ?? enroll(ctx, cmd.course),
  "education.drop": (ctx) => dropCourse(ctx),
  "loan.take": (ctx, cmd) => alive(ctx) ?? takeLoan(ctx, cmd.kind, cmd.amountCents),
  "debt.repay": (ctx, cmd) => repayDebt(ctx, cmd.debtId, cmd.amountCents),
};

export type CommandResult = { ok: true } | { ok: false; reason: string };
