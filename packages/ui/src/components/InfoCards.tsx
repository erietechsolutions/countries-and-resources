import {
  BIOME_LABELS,
  GOVERNMENT_LABELS,
  HEALTHCARE_LABELS,
  PHASE_LABELS,
  RESOURCE_LABELS,
  formatCompact,
  formatMoney,
  formatPercent,
  type CityId,
  type CountryId,
  type ProvinceId,
  type WorldGeography,
  type WorldState,
} from "@cr/sim";
import { hex } from "../map/mapModes";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat" title={hint}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

function StabilityBar({ value }: { value: number }) {
  const color = value < 30 ? "var(--bad)" : value < 60 ? "var(--warn)" : "var(--good)";
  return (
    <div className="bar" aria-label={`Stability ${value} out of 100`}>
      <i style={{ width: `${value}%`, background: color }} />
    </div>
  );
}

export function CountryCard({
  geo,
  world,
  countryId,
}: {
  geo: WorldGeography;
  world: WorldState;
  countryId: CountryId;
}) {
  const gc = geo.countries.find((c) => c.id === countryId);
  const c = world.countries[countryId];
  if (!gc || !c) return null;
  if (!gc.habitable) {
    return (
      <section className="card">
        <h3>{gc.name}</h3>
        <p className="muted">Uninhabited territory. Nobody lives here permanently.</p>
      </section>
    );
  }
  const capital = gc.capitalCityId !== null ? geo.cities[gc.capitalCityId] : undefined;
  const ruling = c.parties.find((p) => p.id === c.rulingPartyId);
  return (
    <section className="card">
      <header className="card-head">
        <span className="swatch" style={{ background: hex(c.color) }} />
        <div>
          <h3>{gc.name}</h3>
          <p className="muted small">
            {GOVERNMENT_LABELS[c.government]}
            {capital && <> · Capital: {capital.name}</>}
          </p>
        </div>
      </header>
      <div className="stat-grid">
        <Stat label="Population" value={formatCompact(c.population)} />
        <Stat
          label="GDP per person"
          value={formatMoney(c.gdpPerCapita * 100, true)}
          hint="Yearly"
        />
        <Stat label="Median wage" value={`${formatMoney(c.medianWageCents)}/hr`} />
        <Stat
          label="Minimum wage"
          value={c.minimumWageCents ? `${formatMoney(c.minimumWageCents)}/hr` : "None"}
        />
        <Stat label="Unemployment" value={formatPercent(c.unemployment)} />
        <Stat label="Inflation" value={formatPercent(c.inflation)} />
        <Stat label="Income tax" value={formatPercent(c.taxes.income, 0)} />
        <Stat label="Sales tax" value={formatPercent(c.taxes.sales, 0)} />
      </div>
      <div className="stability">
        <span className="stat-label">Stability</span>
        <StabilityBar value={c.stability} />
        <span className="small">{c.stability}</span>
      </div>
      <h4>Economy</h4>
      <div className="stat-grid compact">
        <Stat label="Economy" value={PHASE_LABELS[c.economy.phase]} />
        <Stat
          label="Growth"
          value={formatPercent(c.economy.growth)}
          hint="Yearly real GDP growth"
        />
        <Stat label="Healthcare" value={HEALTHCARE_LABELS[c.healthcare]} />
        <Stat
          label="Social services"
          value={c.socialServices > 0.6 ? "Strong" : c.socialServices > 0.3 ? "Basic" : "Minimal"}
          hint="Shelters, food banks and welfare"
        />
      </div>
      <h4>Leadership</h4>
      <p className="small">
        {c.headOfStateTitle}
        {ruling ? (
          <>
            {" "}
            · Ruling party: <strong>{ruling.name}</strong>
          </>
        ) : (
          <> · No ruling party</>
        )}
      </p>
      {c.parties.length > 0 && (
        <>
          <h4>
            {c.parties.every((p) => !p.legal) ? "Banned opposition parties" : "Political parties"}
          </h4>
          <ul className="party-list">
            {c.parties.map((p) => (
              <li key={p.id}>
                <span className="swatch small" style={{ background: hex(p.color) }} />
                <span className="party-name">{p.name}</span>
                <span className="muted small">{formatPercent(p.popularity, 0)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

interface ProvinceCardProps {
  geo: WorldGeography;
  world: WorldState;
  provinceId: ProvinceId;
  selectedCityId?: CityId | null;
  onSelectCity?(id: CityId): void;
  cityActionLabel?: string;
}

export function ProvinceCard({
  geo,
  world,
  provinceId,
  selectedCityId,
  onSelectCity,
  cityActionLabel,
}: ProvinceCardProps) {
  const gp = geo.provinces[provinceId];
  const p = world.provinces[provinceId];
  if (!gp || !p) return null;
  const cities = geo.cities.filter((c) => c.provinceId === provinceId);
  return (
    <section className="card">
      <h3>{gp.name}</h3>
      <p className="muted small">
        {BIOME_LABELS[p.biome]}
        {gp.coastal ? " · Coastal" : " · Landlocked"}
      </p>
      <div className="stat-grid">
        <Stat label="Population" value={formatCompact(p.population)} />
        <Stat label="GDP per person" value={formatMoney(p.gdpPerCapita * 100, true)} />
        <Stat label="Urbanization" value={formatPercent(p.urbanization, 0)} />
        <Stat label="Area" value={`${formatCompact(gp.areaKm2)} km²`} />
      </div>
      <div className="stability">
        <span className="stat-label">Stability</span>
        <StabilityBar value={p.stability} />
        <span className="small">{p.stability}</span>
      </div>
      <h4>Resources</h4>
      <p className="small">
        {p.resources.length
          ? p.resources.map((r) => RESOURCE_LABELS[r]).join(", ")
          : "None of note"}
      </p>
      <h4>Cities</h4>
      {cities.length === 0 ? (
        <p className="muted small">No cities in this region.</p>
      ) : (
        <ul className="city-list">
          {cities.map((gc) => {
            const c = world.cities[gc.id]!;
            const selected = gc.id === selectedCityId;
            return (
              <li key={gc.id} className={selected ? "selected" : undefined}>
                <div className="city-main">
                  <span className="city-name">
                    {gc.name}
                    {gc.capital === 2 && <span className="tag">Capital</span>}
                  </span>
                  <span className="muted small">
                    {formatCompact(c.population)} people · Rent {formatMoney(c.rentCents, true)}/mo
                    · Wage {formatMoney(c.medianWageCents)}/hr
                  </span>
                </div>
                {onSelectCity && (
                  <button
                    className={selected ? "btn small primary" : "btn small"}
                    onClick={() => onSelectCity(gc.id)}
                  >
                    {selected ? "Selected" : (cityActionLabel ?? "Select")}
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

export function CitySummary({
  geo,
  world,
  cityId,
}: {
  geo: WorldGeography;
  world: WorldState;
  cityId: CityId;
}) {
  const gc = geo.cities[cityId];
  const c = world.cities[cityId];
  if (!gc || !c) return null;
  const country = geo.countries.find((k) => k.id === gc.countryId);
  const province = geo.provinces[gc.provinceId];
  return (
    <div className="city-summary">
      <div>
        <strong>{gc.name}</strong>
        <span className="muted small">
          {" "}
          {province?.name !== gc.name && province ? `${province.name}, ` : ""}
          {country?.name}
        </span>
      </div>
      <div className="stat-grid compact">
        <Stat label="Population" value={formatCompact(c.population)} />
        <Stat label="Rent (1 bed)" value={`${formatMoney(c.rentCents, true)}/mo`} />
        <Stat label="Living costs" value={`${formatMoney(c.livingCostCents, true)}/mo`} />
        <Stat label="Median wage" value={`${formatMoney(c.medianWageCents)}/hr`} />
      </div>
    </div>
  );
}
