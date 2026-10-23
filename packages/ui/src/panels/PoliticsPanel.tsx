import { useState } from "react";
import {
  activityBlocker,
  activityById,
  budgetOf,
  electionFor,
  filingBlocker,
  formatDate,
  formatMoney,
  formatPercent,
  foundingPartyCost,
  IDEOLOGY_PRESETS,
  lawDescription,
  officeScope,
  officesFor,
  personById,
  playerCountry,
  playerOffices,
  playerParty,
  policiesForLevel,
  pollShare,
  RANK_STANDING,
  RANK_TITLES,
  CAMPAIGN_HOURS,
  FILING_SUPPORT,
  flyerMinimum,
  homeLocalities,
  localSupport,
  RALLY_SUPPORT,
  TOWN_HALL_SUPPORT,
  type Ideology,
  type Office,
  type Party,
} from "@cr/sim";
import { Meter } from "../components/Meter";
import { useGameUi } from "../game/GameContext";
import { hex } from "../map/mapModes";

const toCents = (t: string) => Math.round(Number(t.replace(/[^0-9.]/g, "")) * 100) || 0;

export function describeIdeology(i: Ideology): string {
  const parts: string[] = [];
  parts.push(
    i.economic < -0.5
      ? "Left"
      : i.economic < -0.15
        ? "Center-left"
        : i.economic > 0.5
          ? "Right"
          : i.economic > 0.15
            ? "Center-right"
            : "Centrist",
  );
  if (i.social < -0.4) parts.push("progressive");
  if (i.social > 0.4) parts.push("traditional");
  if (i.authority > 0.5) parts.push("authoritarian");
  if (i.authority < -0.5) parts.push("libertarian");
  if (i.nationalism > 0.5) parts.push("nationalist");
  return parts.join(", ");
}

function ActivityButton({ id, label }: { id: string; label: string }) {
  const { game, act } = useGameUi();
  const def = activityById(id)!;
  const blocked = activityBlocker(game, def);
  return (
    <button
      className="btn small"
      disabled={!!blocked}
      title={blocked ?? def.description}
      onClick={() => act({ type: "activity.start", activityId: id })}
    >
      {label} ({def.hours(game)}h)
    </button>
  );
}

/** Local support for the player's party, and the ways to grow it. */
function GrassrootsSection() {
  const { game, act } = useGameUi();
  const party = playerParty(game);
  const [amount, setAmount] = useState("");
  if (!party) return null;
  const { city, region } = homeLocalities(game);
  const here = localSupport(game, city, party);
  const regional = localSupport(game, region, party);
  const cityName = game.geography.cities[city.id]!.name;
  const regionName = game.geography.provinces[region.id]!.name;
  const meter = (label: string, v: number) => (
    <Meter
      label={label}
      value={Math.min(10, v * 100)}
      max={10}
      display={formatPercent(v, 1)}
      tone={v >= FILING_SUPPORT.city ? "accent" : "neutral"}
      compact
    />
  );
  return (
    <>
      <h4>Grassroots</h4>
      {meter(`Support in ${cityName}`, here)}
      {meter(`Support in ${regionName}`, regional)}
      <p className="muted small">
        Rallies draw crowds from {formatPercent(RALLY_SUPPORT, 0)} local support and town halls from{" "}
        {formatPercent(TOWN_HALL_SUPPORT, 0)}. Your party can field candidates for city offices at{" "}
        {formatPercent(FILING_SUPPORT.city, 0)} support in the city, regional offices at{" "}
        {formatPercent(FILING_SUPPORT.region, 0)} in the region, and national offices at{" "}
        {formatPercent(FILING_SUPPORT.national, 0)} nationally (now{" "}
        {formatPercent(party.popularity, 1)}). Support fades without work.
      </p>
      <div className="row wrap">
        <ActivityButton id="partyWork" label="Volunteer for the party" />
        <ActivityButton id="partyRally" label="Hold a rally" />
        <ActivityButton id="townHall" label="Host a town hall" />
      </div>
      <div className="row wrap">
        <input
          className="input small-input"
          placeholder="$"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-label="Campaign budget"
        />
        <button
          className="btn small"
          onClick={() => act({ type: "party.promote", amountCents: toCents(amount) })}
        >
          Flyers and ads (from {formatMoney(flyerMinimum(game), true)}, weekly)
        </button>
      </div>
    </>
  );
}

function PartyCard() {
  const { game, act } = useGameUi();
  const p = game.state.player;
  const country = playerCountry(game);
  const party = playerParty(game);
  const [name, setName] = useState("");
  const [preset, setPreset] = useState("centrist");
  const citizen = p.citizenship.includes(country.id);
  if (party) {
    const next = Math.min(5, p.politics.rank + 1);
    return (
      <section className="card">
        <h4 className="no-margin">Your party</h4>
        <div className="row">
          <span className="swatch" style={{ background: hex(party.color) }} />
          <strong>{party.name}</strong>
          <span className="tag">{RANK_TITLES[p.politics.rank]}</span>
        </div>
        <p className="muted small">
          {describeIdeology(party.ideology)} · {formatPercent(party.popularity, 1)} support
          nationally{!party.legal && " · banned"}
        </p>
        {p.politics.rank < 5 && (
          <Meter
            label={`Standing (next: ${RANK_TITLES[next]})`}
            value={p.politics.standing}
            max={RANK_STANDING[next]}
            display={`${Math.round(p.politics.standing)}/${RANK_STANDING[next]}`}
            tone="accent"
            compact
          />
        )}
        <GrassrootsSection />
        <div className="row">
          <button className="btn small" onClick={() => act({ type: "politics.leave" })}>
            Leave party
          </button>
        </div>
      </section>
    );
  }
  return (
    <section className="card">
      <h4 className="no-margin">Political parties</h4>
      {!citizen && (
        <p className="warn-text small">
          Only citizens of {game.geography.countries.find((c) => c.id === country.id)?.name} can
          join parties or run for office here.
        </p>
      )}
      <ul className="offer-list">
        {[...country.parties]
          .sort((a, b) => b.popularity - a.popularity)
          .map((party: Party) => (
            <li key={party.id}>
              <div>
                <span className="swatch small" style={{ background: hex(party.color) }} />{" "}
                <strong>{party.name}</strong>
                <div className="muted small">
                  {describeIdeology(party.ideology)} · {formatPercent(party.popularity, 1)}
                  {!party.legal && " · banned"}
                </div>
              </div>
              <button
                className="btn small"
                disabled={!citizen}
                onClick={() => act({ type: "politics.join", partyId: party.id })}
              >
                Join
              </button>
            </li>
          ))}
      </ul>
      <h4>Found your own party ({formatMoney(foundingPartyCost(game), true)})</h4>
      <div className="row">
        <input
          className="input"
          placeholder="Party name"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
        <select className="input" value={preset} onChange={(e) => setPreset(e.target.value)}>
          {IDEOLOGY_PRESETS.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </select>
        <button
          className="btn small"
          disabled={!citizen}
          onClick={() => act({ type: "politics.found", name, preset })}
        >
          Found
        </button>
      </div>
    </section>
  );
}

function OfficeCard({ office }: { office: Office }) {
  const { game, act } = useGameUi();
  const scope = officeScope(office);
  const policies = policiesForLevel(office.level);
  const [policyId, setPolicyId] = useState(policies[0]!.id);
  const policy = policies.find((x) => x.id === policyId)!;
  const pol = game.state.player.politics;
  return (
    <section className="card highlight">
      <h3>{office.title}</h3>
      <p className="muted small">
        Salary {formatMoney(office.salaryCents, true)}/month ·{" "}
        {office.nextElection ? `next election ${formatDate(office.nextElection)}` : "appointed"} ·
        approval {pol.approval}%
      </p>
      <h4>Propose a law ({pol.proposalsLeft} left this month)</h4>
      <div className="row">
        <select className="input" value={policyId} onChange={(e) => setPolicyId(e.target.value)}>
          {policies.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}: {x.format(x.get(game, scope))}
            </option>
          ))}
        </select>
        <button
          className="btn small"
          onClick={() =>
            act({ type: "politics.propose", officeId: office.id, policyId, direction: 1 })
          }
        >
          Raise
        </button>
        <button
          className="btn small"
          onClick={() =>
            act({ type: "politics.propose", officeId: office.id, policyId, direction: -1 })
          }
        >
          Lower
        </button>
      </div>
      <p className="muted small">{policy.description}</p>
    </section>
  );
}

function BillsCard() {
  const { game, act } = useGameUi();
  const mine = new Set(playerOffices(game).map((o) => o.id));
  const executiveScopes = new Set(
    playerOffices(game)
      .filter((o) => o.seats === 1)
      .map(officeScope),
  );
  const bills = game.state.politics.bills.filter(
    (b) =>
      (b.status === "voting" && mine.has(b.officeId)) ||
      (b.status === "awaitingSignature" && executiveScopes.has(b.scope)),
  );
  if (bills.length === 0) return null;
  return (
    <section className="card">
      <h4 className="no-margin">Bills needing your decision</h4>
      <ul className="offer-list">
        {bills.map((b) => (
          <li key={b.id}>
            <div>
              <strong>{lawDescription(game, b.scope, b.policyId, b.direction)}</strong>
              <div className="muted small">
                {b.status === "voting"
                  ? `Vote on ${formatDate(b.voteAt)}${b.playerVote ? ` · you voted ${b.playerVote}` : ""}`
                  : `Passed ${b.votes.yes}–${b.votes.no}: sign or veto`}
              </div>
            </div>
            <div className="row">
              {b.status === "voting" ? (
                <>
                  <button
                    className="btn small"
                    onClick={() => act({ type: "politics.vote", billId: b.id, vote: "yes" })}
                  >
                    Yes
                  </button>
                  <button
                    className="btn small"
                    onClick={() => act({ type: "politics.vote", billId: b.id, vote: "no" })}
                  >
                    No
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn small primary"
                    onClick={() => act({ type: "politics.sign", billId: b.id, sign: true })}
                  >
                    Sign
                  </button>
                  <button
                    className="btn small danger"
                    onClick={() => act({ type: "politics.sign", billId: b.id, sign: false })}
                  >
                    Veto
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ElectionsCard() {
  const { game, act } = useGameUi();
  const p = game.state.player;
  const [ads, setAds] = useState("");
  const offices = officesFor(game, p.cityId);
  const upcoming = offices
    .map((o) => ({ o, e: electionFor(game, o) }))
    .filter((x) => x.e)
    .sort((a, b) => a.e!.date - b.e!.date);
  const candidacy = p.politics.candidacy;
  const running =
    candidacy && game.state.politics.elections.find((e) => e.id === candidacy.electionId);
  return (
    <section className="card">
      <h4 className="no-margin">Elections</h4>
      {running && candidacy && (
        <div className="campaign">
          <p>
            <strong>
              You're running for {offices.find((o) => o.id === running.officeId)?.title}
            </strong>{" "}
            · election day {formatDate(running.date)}
          </p>
          <Meter
            label="Your support (poll)"
            value={pollShare(game, running) * 100}
            display={formatPercent(pollShare(game, running), 0)}
            tone="accent"
            compact
          />
          {(() => {
            const level = game.state.politics.offices.find((o) => o.id === running.officeId)?.level;
            const needed = level ? CAMPAIGN_HOURS[level] : 0;
            return (
              <Meter
                label={`Campaign hours (at least ${needed} or you're off the ballot)`}
                value={Math.min(needed, candidacy.effort)}
                max={Math.max(1, needed)}
                display={`${Math.floor(candidacy.effort)}/${needed}`}
                tone={candidacy.effort >= needed ? "accent" : "auto"}
                compact
              />
            );
          })()}
          <p className="muted small">
            Funds {formatMoney(candidacy.fundsCents, true)} · ads bought{" "}
            {formatMoney(candidacy.spentCents, true)}
          </p>
          <div className="row">
            <ActivityButton id="campaign" label="Campaign" />
            <ActivityButton id="fundraise" label="Fundraise" />
          </div>
          <div className="row">
            <input
              className="input small-input"
              placeholder="$"
              value={ads}
              onChange={(e) => setAds(e.target.value)}
            />
            <button
              className="btn small"
              onClick={() => act({ type: "politics.ads", amountCents: toCents(ads) })}
            >
              Buy ads
            </button>
            <button className="btn small danger" onClick={() => act({ type: "politics.withdraw" })}>
              Withdraw
            </button>
          </div>
        </div>
      )}
      {upcoming.length === 0 ? (
        <p className="muted small">
          No elections are open right now. Filing opens about four months before election day.
        </p>
      ) : (
        <ul className="offer-list">
          {upcoming.map(({ o, e }) => {
            const blocked = filingBlocker(game, e!);
            const filingOpen = game.time <= e!.filingCloses;
            return (
              <li key={e!.id}>
                <div>
                  <strong>{o.title}</strong>
                  <div className="muted small">
                    {formatDate(e!.date)} · {o.seats > 1 ? `${o.seats} seats` : "1 seat"} ·{" "}
                    {filingOpen
                      ? `filing until ${formatDate(e!.filingCloses)}`
                      : "campaign underway"}
                  </div>
                  {filingOpen && blocked && <div className="muted small">{blocked}</div>}
                </div>
                {filingOpen && (
                  <button
                    className="btn small"
                    disabled={!!blocked}
                    onClick={() => act({ type: "politics.file", electionId: e!.id })}
                  >
                    Run
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function GovernmentCard() {
  const { game } = useGameUi();
  const p = game.state.player;
  const country = playerCountry(game);
  const offices = officesFor(game, p.cityId);
  const holderName = (o: Office, i = 0) => {
    const h = o.holders[i];
    if (h === "player") return "You";
    const person = h ? personById(game, h) : undefined;
    return person ? `${person.firstName} ${person.lastName}` : "Vacant";
  };
  const partyName = (id: string | null | undefined) =>
    country.parties.find((x) => x.id === id)?.shortName ?? "Ind.";
  const legislature = offices.find((o) => o.kind === "legislator");
  const seats = new Map<string, number>();
  legislature?.holderParties.forEach((id) => id && seats.set(id, (seats.get(id) ?? 0) + 1));
  const budget = budgetOf(country);
  const scope = `national:${country.id}`;
  const recentLaws = game.state.politics.laws.slice(-6).reverse();
  return (
    <section className="card">
      <h4 className="no-margin">Who governs</h4>
      <ul className="gov-list">
        {offices
          .filter((o) => o.seats === 1)
          .map((o) => (
            <li key={o.id}>
              <span>{o.title}</span>
              <strong>
                {holderName(o)}{" "}
                <span className="muted small">({partyName(o.holderParties[0])})</span>
              </strong>
            </li>
          ))}
      </ul>
      {legislature && (
        <>
          <h4>National legislature</h4>
          <div className="seat-bar">
            {[...seats.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([id, n]) => {
                const party = country.parties.find((x) => x.id === id);
                return (
                  <i
                    key={id}
                    title={`${party?.name}: ${n} seats`}
                    style={{
                      width: `${(n / legislature.seats) * 100}%`,
                      background: hex(party?.color ?? 0x888888),
                    }}
                  />
                );
              })}
          </div>
          <p className="muted small">
            {[...seats.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([id, n]) => `${partyName(id)} ${n}`)
              .join(" · ")}
          </p>
        </>
      )}
      <h4>National policy</h4>
      <ul className="gov-list">
        {policiesForLevel("national").map((x) => (
          <li key={x.id}>
            <span>{x.label}</span>
            <strong>{x.format(x.get(game, scope))}</strong>
          </li>
        ))}
      </ul>
      <h4>Budget (monthly)</h4>
      <p className="small">
        Revenue {formatMoney(budget.revenueCents, true)} · spending{" "}
        {formatMoney(budget.spendingCents, true)} · debt {formatMoney(budget.debtCents, true)}
      </p>
      {recentLaws.length > 0 && (
        <>
          <h4>Recent laws</h4>
          <ul className="gov-list">
            {recentLaws.map((l, i) => (
              <li key={i}>
                <span className="muted small">{formatDate(l.time)}</span>
                <span className="small">
                  {l.direction > 0 ? "Raised" : "Lowered"}{" "}
                  {l.policyId.replace(/([A-Z])/g, " $1").toLowerCase()} ({l.scope.split(":")[0]})
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function PoliticsPanel() {
  const { game } = useGameUi();
  const offices = playerOffices(game);
  return (
    <div className="panel-stack">
      {offices.map((o) => (
        <OfficeCard key={o.id} office={o} />
      ))}
      <BillsCard />
      <ElectionsCard />
      <PartyCard />
      <GovernmentCard />
    </div>
  );
}
