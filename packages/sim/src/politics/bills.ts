import { addDays } from "../core/calendar";
import type { GameContext } from "../core/game";
import { personById } from "../social/people";
import type { Ideology } from "../world/types";
import {
  countryOfScope,
  enactPolicy,
  executiveFor,
  isDemocratic,
  lawDescription,
  legislatureFor,
  officeScope,
  playerOffices,
} from "./government";
import { alignment, parseScope, policiesForLevel, policyFor } from "./policies";
import type { Bill, HolderId } from "./types";

const VOTE_DAYS = 7;

function ideologyOf(
  ctx: GameContext,
  holder: HolderId,
  partyId: string | null,
  scope: string,
): Ideology {
  if (holder !== "player") {
    const person = personById(ctx, holder);
    if (person) return person.ideology;
  }
  const party = partyId
    ? countryOfScope(ctx, scope).parties.find((p) => p.id === partyId)
    : undefined;
  return party?.ideology ?? { economic: 0, social: 0, authority: 0, nationalism: 0 };
}

export function proposeBill(
  ctx: GameContext,
  officeId: string,
  policyId: string,
  direction: 1 | -1,
): string | null {
  const office = playerOffices(ctx).find((o) => o.id === officeId);
  if (!office) return "You don't hold that office.";
  if (direction !== 1 && direction !== -1) return "Choose raise or lower.";
  const scope = officeScope(office);
  const policy = policyFor(policyId, office.level);
  if (!policy) return "That policy isn't decided at this level.";
  const current = policy.get(ctx, scope);
  if ((direction > 0 && current >= policy.max) || (direction < 0 && current <= policy.min))
    return "It's already at the limit.";
  const pol = ctx.state.player.politics;
  if (pol.proposalsLeft <= 0) return "You've used your proposals for this month.";
  if (
    ctx.state.politics.bills.some(
      (b) =>
        b.scope === scope &&
        b.policyId === policyId &&
        (b.status === "voting" || b.status === "awaitingSignature"),
    )
  ) {
    return "A bill on that is already pending.";
  }
  pol.proposalsLeft--;
  const country = countryOfScope(ctx, scope);
  // Rulers of non-democracies can simply decree.
  if (office.kind === "headOfGovernment" && !isDemocratic(country.government)) {
    enactPolicy(ctx, scope, policy, direction, "player", ["player"]);
    ctx.alert("good", `By decree: ${lawDescription(ctx, scope, policyId, direction)}.`, "politics");
    return null;
  }
  createBill(ctx, scope, policyId, direction, "player");
  ctx.alert(
    "info",
    `You proposed: ${lawDescription(ctx, scope, policyId, direction)}. The vote is in ${VOTE_DAYS} days.`,
    "politics",
  );
  return null;
}

export function createBill(
  ctx: GameContext,
  scope: string,
  policyId: string,
  direction: 1 | -1,
  proposerId: HolderId,
): Bill | null {
  const body = legislatureFor(ctx, scope);
  if (!body) return null;
  const bill: Bill = {
    id: `l${ctx.state.politics.nextId++}`,
    officeId: body.id,
    policyId,
    direction,
    scope,
    proposerId,
    proposedAt: ctx.state.time,
    voteAt: addDays(ctx.state.time, VOTE_DAYS),
    status: "voting",
    votes: { yes: 0, no: 0 },
  };
  ctx.state.politics.bills.push(bill);
  return bill;
}

export function castVote(ctx: GameContext, billId: string, vote: "yes" | "no"): string | null {
  const bill = ctx.state.politics.bills.find((b) => b.id === billId);
  if (!bill || bill.status !== "voting") return "That bill isn't up for a vote.";
  const body = ctx.state.politics.offices.find((o) => o.id === bill.officeId);
  if (!body?.holders.includes("player")) return "You don't have a vote on this.";
  bill.playerVote = vote;
  return null;
}

export function signBill(ctx: GameContext, billId: string, sign: boolean): string | null {
  const bill = ctx.state.politics.bills.find((b) => b.id === billId);
  if (!bill || bill.status !== "awaitingSignature")
    return "That bill isn't waiting for a signature.";
  if (!executiveFor(ctx, bill.scope)?.holders.includes("player")) return "You can't sign this.";
  finalize(ctx, bill, sign);
  return null;
}

function finalize(ctx: GameContext, bill: Bill, signed: boolean): void {
  const { level } = parseScope(bill.scope);
  const policy = policyFor(bill.policyId, level)!;
  const desc = lawDescription(ctx, bill.scope, bill.policyId, bill.direction);
  if (!signed) {
    bill.status = "vetoed";
    if (isPlayerScope(ctx, bill.scope)) ctx.log("politics", `Vetoed: ${desc}.`);
    return;
  }
  bill.status = "enacted";
  const supporters: HolderId[] = [];
  if (
    bill.playerVote === "yes" ||
    bill.proposerId === "player" ||
    executiveFor(ctx, bill.scope)?.holders.includes("player")
  )
    supporters.push("player");
  enactPolicy(ctx, bill.scope, policy, bill.direction, bill.proposerId, supporters);
  if (isPlayerScope(ctx, bill.scope))
    ctx.alert(
      "info",
      `New law: ${desc.replace(/ \(now .*\)/, "")} (now ${policy.format(policy.get(ctx, bill.scope))}).`,
      "politics",
    );
}

function isPlayerScope(ctx: GameContext, scope: string): boolean {
  const c = ctx.geography.cities[ctx.state.player.cityId]!;
  return (
    scope === `city:${ctx.state.player.cityId}` ||
    scope === `region:${c.provinceId}` ||
    scope === `national:${c.countryId}`
  );
}

/** Counts votes on bills whose vote day has come, and handles signatures. */
export function resolveBills(ctx: GameContext): void {
  for (const bill of ctx.state.politics.bills) {
    if (bill.status !== "voting" || ctx.state.time < bill.voteAt) continue;
    const body = ctx.state.politics.offices.find((o) => o.id === bill.officeId);
    const { level } = parseScope(bill.scope);
    const policy = policyFor(bill.policyId, level);
    if (!body || !policy) {
      bill.status = "failed";
      continue;
    }
    const country = countryOfScope(ctx, bill.scope);
    const rubberStamp = !isDemocratic(country.government);
    let yes = 0;
    let no = 0;
    body.holders.forEach((h, i) => {
      if (h === "player") {
        if (bill.playerVote === "yes") yes++;
        else if (bill.playerVote === "no") no++;
        return;
      }
      const lean = alignment(
        ideologyOf(ctx, h, body.holderParties[i] ?? null, bill.scope),
        policy,
        bill.direction,
      );
      const sameParty = body.holderParties[i] && body.holderParties[i] === proposerParty(ctx, bill);
      const score =
        lean + (sameParty ? 0.35 : 0) + (rubberStamp ? 0.6 : 0) + ctx.rng.normal(0, 0.25);
      if (score > 0) yes++;
      else no++;
    });
    bill.votes = { yes, no };
    if (yes <= no) {
      bill.status = "failed";
      if (isPlayerScope(ctx, bill.scope))
        ctx.log(
          "politics",
          `Bill failed ${yes}–${no}: ${lawDescription(ctx, bill.scope, bill.policyId, bill.direction)}.`,
        );
      continue;
    }
    const exec = executiveFor(ctx, bill.scope);
    if (exec?.holders.includes("player")) {
      bill.status = "awaitingSignature";
      ctx.alert(
        "info",
        `A bill passed ${yes}–${no} and needs your signature: ${lawDescription(ctx, bill.scope, bill.policyId, bill.direction)}.`,
        "politics",
      );
      continue;
    }
    const execLean = exec
      ? alignment(
          ideologyOf(ctx, exec.holders[0]!, exec.holderParties[0] ?? null, bill.scope),
          policy,
          bill.direction,
        )
      : 1;
    const override = yes >= (yes + no) * (2 / 3);
    finalize(ctx, bill, execLean > -0.3 || override);
  }
  if (ctx.state.politics.bills.length > 80) {
    ctx.state.politics.bills = ctx.state.politics.bills
      .filter((b) => b.status === "voting" || b.status === "awaitingSignature")
      .concat(ctx.state.politics.bills.slice(-40));
  }
}

function proposerParty(ctx: GameContext, bill: Bill): string | null {
  if (bill.proposerId === "player") return ctx.state.player.politics.partyId;
  const body = ctx.state.politics.offices.find((o) => o.id === bill.officeId);
  const idx = body?.holders.indexOf(bill.proposerId) ?? -1;
  return idx >= 0 ? (body!.holderParties[idx] ?? null) : null;
}

/**
 * Governments pursue their own agendas: each month the majority in a council or legislature may
 * push the policy change its ideology wants most.
 */
export function npcProposals(ctx: GameContext): void {
  const c = ctx.geography.cities[ctx.state.player.cityId]!;
  const scopes = [
    `city:${ctx.state.player.cityId}`,
    `region:${c.provinceId}`,
    `national:${c.countryId}`,
  ];
  for (const scope of scopes) {
    if (!ctx.rng.chance(0.3)) continue;
    const body = legislatureFor(ctx, scope);
    if (!body) continue;
    // The biggest bloc sets the agenda.
    const counts = new Map<string, number>();
    body.holderParties.forEach((p) => p && counts.set(p, (counts.get(p) ?? 0) + 1));
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!top) continue;
    const country = countryOfScope(ctx, scope);
    const party = country.parties.find((p) => p.id === top[0]);
    if (!party) continue;
    const { level } = parseScope(scope);
    const options = policiesForLevel(level).flatMap((policy) =>
      ([1, -1] as const).map((dir) => ({
        policy,
        dir,
        score: alignment(party.ideology, policy, dir) + ctx.rng.normal(0, 0.2),
      })),
    );
    const pick = options
      .filter((o) => {
        const v = o.policy.get(ctx, scope);
        return o.dir > 0 ? v < o.policy.max : v > o.policy.min;
      })
      .filter(
        (o) =>
          !ctx.state.politics.bills.some(
            (b) =>
              b.scope === scope &&
              b.policyId === o.policy.id &&
              (b.status === "voting" || b.status === "awaitingSignature"),
          ),
      )
      .sort((a, b) => b.score - a.score)[0];
    if (!pick || pick.score < 0.15) continue;
    const proposer = body.holders[body.holderParties.indexOf(party.id)] ?? body.holders[0]!;
    if (proposer === "player") continue;
    createBill(ctx, scope, pick.policy.id, pick.dir, proposer);
  }
}
