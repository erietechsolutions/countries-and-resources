import { useState } from "react";
import {
  formatDate,
  formatMoney,
  formatPercent,
  loanOffers,
  monthlyIncomeCents,
  totalDebtCents,
  type LoanOffer,
} from "@cr/sim";
import { useGameUi } from "../game/GameContext";

function dollarsToCents(text: string): number {
  const v = Number(text.replace(/[^0-9.]/g, ""));
  return Number.isFinite(v) ? Math.round(v * 100) : 0;
}

function LoanRow({ offer }: { offer: LoanOffer }) {
  const { act } = useGameUi();
  const [amount, setAmount] = useState("");
  const title = offer.kind === "payday" ? "Payday loan" : "Personal loan";
  const terms =
    offer.kind === "payday"
      ? `${formatPercent(offer.rate, 0)} fee, due in 14 days. Rolls over with another fee if unpaid.`
      : `${formatPercent(offer.rate, 1)} APR, ${offer.termMonths} monthly payments.`;
  return (
    <li>
      <div>
        <strong>{title}</strong>
        <div className="muted small">
          {offer.available ? `Up to ${formatMoney(offer.maxCents, true)} · ${terms}` : offer.reason}
        </div>
      </div>
      {offer.available && (
        <div className="row">
          <input
            className="input small-input"
            placeholder="$"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label={`${title} amount`}
          />
          <button
            className="btn small"
            onClick={() => {
              if (act({ type: "loan.take", kind: offer.kind, amountCents: dollarsToCents(amount) }))
                setAmount("");
            }}
          >
            Borrow
          </button>
        </div>
      )}
    </li>
  );
}

export function MoneyPanel() {
  const { game, act } = useGameUi();
  const p = game.state.player;
  const f = p.finance;
  const weekAgo = game.time - 7 * 24;
  const recent = f.ledger.filter((t) => t.time > weekAgo);
  const income = recent.filter((t) => t.amountCents > 0).reduce((s, t) => s + t.amountCents, 0);
  const spent = recent.filter((t) => t.amountCents < 0).reduce((s, t) => s - t.amountCents, 0);

  return (
    <div className="panel-stack">
      <section className="card">
        <div className="stat-grid">
          <div className="stat">
            <span className="stat-label">Cash</span>
            <span className="stat-value big">{formatMoney(p.cashCents)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Debt</span>
            <span className="stat-value big">{formatMoney(totalDebtCents(p))}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Last 7 days</span>
            <span className="stat-value">
              <span className="good-text">+{formatMoney(income, true)}</span> /{" "}
              <span className="bad-text">−{formatMoney(spent, true)}</span>
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Credit score</span>
            <span className="stat-value">{f.creditScore ?? "No history"}</span>
          </div>
        </div>
        {p.job && (
          <p className="muted small">
            Expected job income: {formatMoney(monthlyIncomeCents(p), true)}/month before tax.
          </p>
        )}
      </section>

      <section className="card">
        <h4 className="no-margin">Debts</h4>
        {f.debts.length === 0 ? (
          <p className="muted small">You don't owe anyone anything.</p>
        ) : (
          <ul className="offer-list">
            {f.debts.map((d) => (
              <li key={d.id}>
                <div>
                  <strong>{d.label}</strong>{" "}
                  <span className="small">{formatMoney(d.balanceCents)}</span>
                  <div className="muted small">
                    {d.dueAt !== null && `Due ${formatDate(d.dueAt)}. `}
                    {d.monthlyPaymentCents > 0 &&
                      `${formatMoney(d.monthlyPaymentCents)} charged monthly. `}
                    {d.apr > 0 && `${formatPercent(d.apr, 1)} interest. `}
                    {d.kind === "medical" && "Goes to collections if unpaid after 4 months."}
                  </div>
                </div>
                <button
                  className="btn small"
                  disabled={p.cashCents <= 0}
                  onClick={() =>
                    act({
                      type: "debt.repay",
                      debtId: d.id,
                      amountCents: Math.min(p.cashCents, d.balanceCents),
                    })
                  }
                >
                  {p.cashCents >= d.balanceCents
                    ? "Pay off"
                    : `Pay ${formatMoney(p.cashCents, true)}`}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h4 className="no-margin">Borrow</h4>
        <ul className="offer-list">
          {loanOffers(game).map((o) => (
            <LoanRow key={o.kind} offer={o} />
          ))}
        </ul>
      </section>

      <section className="card">
        <h4 className="no-margin">Recent transactions</h4>
        {f.ledger.length === 0 ? (
          <p className="muted small">Nothing yet.</p>
        ) : (
          <ul className="ledger">
            {[...f.ledger]
              .reverse()
              .slice(0, 30)
              .map((t, i) => (
                <li key={`${t.time}-${i}`}>
                  <span className="muted small">{formatDate(t.time)}</span>
                  <span className="ledger-desc">{t.description}</span>
                  <span className={t.amountCents >= 0 ? "good-text" : "bad-text"}>
                    {t.amountCents >= 0 ? "+" : "−"}
                    {formatMoney(Math.abs(t.amountCents))}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}
