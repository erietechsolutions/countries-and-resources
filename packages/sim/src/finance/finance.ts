import type { Character } from "../character/character";
import { addDays, type GameTime } from "../core/calendar";
import type { GameContext } from "../core/game";
import type { System } from "../core/systems";
import type { Debt, DebtKind, LedgerCategory } from "../life/types";
import { formatMoney } from "../world/format";
import { occupationById } from "../work/occupations";

const MAX_LEDGER = 120;
const DAY = 24;

/** Changes the player's cash and records why. Positive = income, negative = spending. */
export function transact(
  ctx: GameContext,
  amountCents: number,
  category: LedgerCategory,
  description: string,
): void {
  const p = ctx.state.player;
  p.cashCents += amountCents;
  p.finance.ledger.push({ time: ctx.state.time, amountCents, category, description });
  if (p.finance.ledger.length > MAX_LEDGER)
    p.finance.ledger.splice(0, p.finance.ledger.length - MAX_LEDGER);
}

/** Expected monthly gross income from the current job. */
export function monthlyIncomeCents(player: Character): number {
  if (!player.job) return 0;
  const shift = occupationById(player.job.occupationId).shift;
  return Math.round(player.job.wageCents * shift.hours * shift.days.length * 4.33);
}

export function totalDebtCents(player: Character): number {
  return player.finance.debts.reduce((s, d) => s + d.balanceCents, 0);
}

function adjustCredit(player: Character, delta: number): void {
  const current = player.finance.creditScore ?? 620;
  player.finance.creditScore = Math.max(300, Math.min(850, Math.round(current + delta)));
}

function openDebt(
  ctx: GameContext,
  kind: DebtKind,
  label: string,
  balanceCents: number,
  extra: Partial<Debt> = {},
): Debt {
  const f = ctx.state.player.finance;
  const debt: Debt = {
    id: `d${f.nextDebtId++}`,
    kind,
    label,
    balanceCents,
    openedAt: ctx.state.time,
    dueAt: null,
    monthlyPaymentCents: 0,
    apr: 0,
    missedPayments: 0,
    rollovers: 0,
    ...extra,
  };
  f.debts.push(debt);
  // Opening a first credit account starts a credit history.
  if (f.creditScore === null && (kind === "personal" || kind === "payday")) f.creditScore = 620;
  return debt;
}

export function addMedicalDebt(ctx: GameContext, amountCents: number, label: string): void {
  if (amountCents <= 0) return;
  openDebt(ctx, "medical", label, amountCents);
}

// ---------------------------------------------------------------------------------------------
// Loans

export const PAYDAY_FEE = 0.15;
export const PAYDAY_DAYS = 14;

export interface LoanOffer {
  kind: "payday" | "personal";
  available: boolean;
  reason?: string;
  maxCents: number;
  /** Payday: flat fee rate per term. Personal: yearly interest rate. */
  rate: number;
  termMonths?: number;
}

export function loanOffers(ctx: GameContext): LoanOffer[] {
  const p = ctx.state.player;
  const income = monthlyIncomeCents(p);
  const hasPayday = p.finance.debts.some((d) => d.kind === "payday");
  const collections = p.finance.debts.some((d) => d.kind === "collections");
  const payday: LoanOffer = {
    kind: "payday",
    available: income > 0 && !hasPayday,
    reason:
      income === 0
        ? "Requires a job."
        : hasPayday
          ? "Repay your current payday loan first."
          : undefined,
    maxCents: Math.round((income * 0.5) / 100) * 100,
    rate: PAYDAY_FEE,
  };
  const score = p.finance.creditScore;
  const tenureDays = p.job ? (ctx.state.time - p.job.startedAt) / DAY : 0;
  let reason: string | undefined;
  if (!p.job) reason = "Requires a job.";
  else if (tenureDays < 90) reason = "Requires 3 months at your current job.";
  else if (score === null)
    reason = "Requires a credit history (repay a payday loan on time first).";
  else if (score < 580) reason = "Credit score too low (580 needed).";
  else if (collections) reason = "You have debts in collections.";
  const apr =
    score === null ? 0.3 : Math.max(0.07, Math.min(0.36, 0.3 - ((score - 580) / 270) * 0.23));
  const personal: LoanOffer = {
    kind: "personal",
    available: !reason,
    reason,
    maxCents: Math.round((income * 3) / 100) * 100,
    rate: Math.round(apr * 1000) / 1000,
    termMonths: 12,
  };
  return [payday, personal];
}

export function takeLoan(
  ctx: GameContext,
  kind: "payday" | "personal",
  amountCents: number,
): string | null {
  const offer = loanOffers(ctx).find((o) => o.kind === kind)!;
  if (!offer.available) return offer.reason ?? "Loan not available.";
  if (!Number.isInteger(amountCents) || amountCents <= 0) return "Choose an amount.";
  if (amountCents > offer.maxCents)
    return `The most you can borrow is ${formatMoney(offer.maxCents)}.`;
  if (kind === "payday") {
    openDebt(ctx, "payday", "Payday loan", Math.round(amountCents * (1 + PAYDAY_FEE)), {
      dueAt: addDays(ctx.state.time, PAYDAY_DAYS),
    });
  } else {
    const r = offer.rate / 12;
    const n = offer.termMonths ?? 12;
    const payment = Math.round((amountCents * r) / (1 - (1 + r) ** -n));
    openDebt(ctx, "personal", "Personal loan", amountCents, {
      apr: offer.rate,
      monthlyPaymentCents: payment,
    });
  }
  transact(ctx, amountCents, "loan", kind === "payday" ? "Payday loan" : "Personal loan");
  return null;
}

export function repayDebt(ctx: GameContext, debtId: string, amountCents: number): string | null {
  const p = ctx.state.player;
  const debt = p.finance.debts.find((d) => d.id === debtId);
  if (!debt) return "That debt no longer exists.";
  const amount = Math.min(amountCents, debt.balanceCents);
  if (!Number.isInteger(amount) || amount <= 0) return "Choose an amount.";
  if (amount > p.cashCents) return "You don't have enough cash.";
  transact(ctx, -amount, "debtPayment", `Payment: ${debt.label}`);
  debt.balanceCents -= amount;
  if (debt.balanceCents <= 0) closeDebt(ctx, debt, true);
  return null;
}

function closeDebt(ctx: GameContext, debt: Debt, paidInFull: boolean): void {
  const p = ctx.state.player;
  p.finance.debts = p.finance.debts.filter((d) => d !== debt);
  if (
    paidInFull &&
    (debt.kind === "payday" || debt.kind === "personal") &&
    debt.missedPayments === 0
  ) {
    adjustCredit(p, debt.kind === "personal" ? 25 : 12);
    ctx.alert("good", `${debt.label} paid off. Your credit score improved.`);
  }
}

function sendToCollections(ctx: GameContext, debt: Debt): void {
  debt.kind = "collections";
  debt.label = `Collections (${debt.label.toLowerCase()})`;
  debt.apr = 0.1;
  debt.dueAt = null;
  debt.monthlyPaymentCents = 0;
  adjustCredit(ctx.state.player, -80);
  ctx.alert("bad", `A debt was sent to collections. Your credit score dropped sharply.`);
}

/** Pays from cash if possible; returns whether the full amount was paid. */
function autoPay(ctx: GameContext, debt: Debt, amount: number): boolean {
  const p = ctx.state.player;
  if (p.cashCents < amount) return false;
  transact(ctx, -amount, "debtPayment", `Payment: ${debt.label}`);
  debt.balanceCents -= amount;
  return true;
}

export const financeSystem: System = {
  id: "finance",
  onDay(ctx) {
    const now: GameTime = ctx.state.time;
    for (const debt of [...ctx.state.player.finance.debts]) {
      if (debt.kind !== "payday" || debt.dueAt === null || debt.dueAt > now) continue;
      if (autoPay(ctx, debt, debt.balanceCents)) {
        closeDebt(ctx, debt, true);
      } else if (debt.rollovers >= 2) {
        debt.missedPayments++;
        sendToCollections(ctx, debt);
      } else {
        debt.rollovers++;
        debt.missedPayments++;
        debt.balanceCents = Math.round(debt.balanceCents * (1 + PAYDAY_FEE));
        debt.dueAt = addDays(now, PAYDAY_DAYS);
        adjustCredit(ctx.state.player, -20);
        ctx.alert(
          "bad",
          `You couldn't repay your payday loan. It rolled over with another ${PAYDAY_FEE * 100}% fee.`,
        );
      }
    }
  },
  onMonth(ctx) {
    const p = ctx.state.player;
    let anyMissed = false;
    for (const debt of [...p.finance.debts]) {
      if (debt.apr > 0) debt.balanceCents += Math.round((debt.balanceCents * debt.apr) / 12);
      if (debt.kind === "personal") {
        const due = Math.min(debt.monthlyPaymentCents, debt.balanceCents);
        if (autoPay(ctx, debt, due)) {
          if (debt.balanceCents <= 0) closeDebt(ctx, debt, true);
        } else {
          anyMissed = true;
          debt.missedPayments++;
          adjustCredit(p, -35);
          ctx.alert("bad", "You missed a loan payment. Your credit score dropped.");
          if (debt.missedPayments >= 3) sendToCollections(ctx, debt);
        }
      } else if (debt.kind === "medical") {
        // Unpaid medical bills go to collections after four months.
        if (ctx.state.time - debt.openedAt > 120 * DAY) sendToCollections(ctx, debt);
      }
    }
    const hasCredit = p.finance.debts.some((d) => d.kind === "personal" || d.kind === "payday");
    if (!anyMissed && hasCredit) adjustCredit(p, 4);
  },
};
