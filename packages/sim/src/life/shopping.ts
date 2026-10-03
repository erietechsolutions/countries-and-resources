import type { GameContext } from "../core/game";
import { cityCosts } from "../economy/costs";
import { courseById, type CredentialId } from "../education/courses";
import { transact } from "../finance/finance";
import { formatMoney } from "../world/format";
import { itemById, type ItemId } from "./items";

export function buyItem(ctx: GameContext, id: ItemId): string | null {
  const p = ctx.state.player;
  const item = itemById(id);
  if (p.inventory.items.includes(id)) return `You already have: ${item.name.toLowerCase()}.`;
  const price = cityCosts(ctx, p.cityId).itemCents(id);
  if (price > p.cashCents)
    return `Costs ${formatMoney(price)}. You have ${formatMoney(p.cashCents)}.`;
  transact(ctx, -price, "shopping", item.name);
  p.inventory.items.push(id);
  ctx.log("life", `Bought ${item.name.toLowerCase()} for ${formatMoney(price)}.`);
  return null;
}

export function sellItem(ctx: GameContext, id: ItemId): string | null {
  const p = ctx.state.player;
  if (!p.inventory.items.includes(id)) return "You don't have that.";
  const price = Math.round(cityCosts(ctx, p.cityId).itemCents(id) * 0.35);
  p.inventory.items = p.inventory.items.filter((i) => i !== id);
  transact(ctx, price, "other", `Sold ${itemById(id).name.toLowerCase()}`);
  return null;
}

export function courseBlocker(ctx: GameContext, id: CredentialId): string | null {
  const p = ctx.state.player;
  const course = courseById(id);
  if (!course) return "Unknown course.";
  if (p.credentials.includes(id)) return "You already have this.";
  if (p.education) return "You're already enrolled in a course.";
  for (const req of course.requires)
    if (!p.credentials.includes(req)) return "You don't meet the requirements.";
  const tuition = cityCosts(ctx, p.cityId).tuitionCents(id);
  if (tuition > p.cashCents) return `Tuition is ${formatMoney(tuition)}.`;
  return null;
}

export function enroll(ctx: GameContext, id: CredentialId): string | null {
  const blocked = courseBlocker(ctx, id);
  if (blocked) return blocked;
  const p = ctx.state.player;
  const course = courseById(id)!;
  const tuition = cityCosts(ctx, p.cityId).tuitionCents(id);
  transact(ctx, -tuition, "tuition", `Tuition: ${course.title}`);
  p.education = { courseId: id, progressHours: 0, enrolledAt: ctx.state.time };
  ctx.alert("good", `You enrolled in the ${course.title}. Study to make progress.`, "work");
  return null;
}

export function dropCourse(ctx: GameContext): string | null {
  const p = ctx.state.player;
  if (!p.education) return "You're not enrolled.";
  const course = courseById(p.education.courseId);
  p.education = null;
  ctx.alert(
    "info",
    `You dropped the ${course?.title ?? "course"}. Tuition is not refunded.`,
    "work",
  );
  return null;
}
