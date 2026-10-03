import { useState } from "react";
import {
  COURSES,
  courseBlocker,
  CREDENTIAL_LABELS,
  cityCosts,
  companyOfJob,
  formatDate,
  formatMoney,
  formatShift,
  hasAddress,
  MISSED_SHIFT_LIMIT,
  occupationById,
  SKILLS,
  skillLevel,
  xpForLevel,
} from "@cr/sim";
import { Meter } from "../components/Meter";
import { useGameUi } from "../game/GameContext";

export function WorkPanel() {
  const { game, act } = useGameUi();
  const p = game.state.player;
  const job = p.job;
  const company = companyOfJob(game);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const costs = cityCosts(game, p.cityId);

  return (
    <div className="panel-stack">
      <section className="card">
        <h4 className="no-margin">Your job</h4>
        {job ? (
          <>
            <h3>{occupationById(job.occupationId).title}</h3>
            <p className="muted small">
              {company?.name ?? "Unknown employer"} · since {formatDate(job.startedAt)}
            </p>
            <div className="stat-grid">
              <div className="stat">
                <span className="stat-label">Wage</span>
                <span className="stat-value">{formatMoney(job.wageCents)}/hr</span>
              </div>
              <div className="stat">
                <span className="stat-label">Unpaid hours</span>
                <span className="stat-value">{job.unpaidHours}h (paid Fridays)</span>
              </div>
            </div>
            <p className="small">{formatShift(occupationById(job.occupationId).shift)}</p>
            <Meter label="Performance" value={job.performance} />
            {job.missedShifts.length > 0 && (
              <p className="warn-text small">
                Missed shifts (last 30 days): {job.missedShifts.length} of {MISSED_SHIFT_LIMIT - 1}{" "}
                allowed
              </p>
            )}
            <label className="check small">
              <input
                type="checkbox"
                checked={p.prefs.autoWork}
                onChange={(e) => act({ type: "job.setAutoWork", enabled: e.target.checked })}
              />{" "}
              Go to work automatically when a shift starts
            </label>
            {occupationById(job.occupationId).promotesTo && (
              <p className="muted small">
                Promotion path: {occupationById(occupationById(job.occupationId).promotesTo!).title}{" "}
                (keep performance above 75 for 3 months and meet its requirements).
              </p>
            )}
            <div className="row">
              {confirmQuit ? (
                <>
                  <span className="small">Quit this job?</span>
                  <button className="btn small danger" onClick={() => act({ type: "job.quit" })}>
                    Quit
                  </button>
                  <button className="btn small" onClick={() => setConfirmQuit(false)}>
                    Keep it
                  </button>
                </>
              ) : (
                <button className="btn small" onClick={() => setConfirmQuit(true)}>
                  Quit job
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="muted small">
            You're unemployed. Use <strong>Look for work</strong> (once a day, 8 AM–6 PM).
            {!hasAddress(game) &&
              " Without an address, many employers won't consider you: shelters provide one."}
          </p>
        )}
      </section>

      <section className="card">
        <div className="row between">
          <h4 className="no-margin">Job offers</h4>
          <button
            className="btn small"
            onClick={() => act({ type: "activity.start", activityId: "jobSearch" })}
          >
            Look for work
          </button>
        </div>
        {p.jobOffers.length === 0 ? (
          <p className="muted small">No offers right now.</p>
        ) : (
          <ul className="offer-list">
            {p.jobOffers.map((o) => {
              const occ = occupationById(o.occupationId);
              const c = game.state.world.companies.find((x) => x.id === o.companyId);
              return (
                <li key={o.id}>
                  <div>
                    <strong>{occ.title}</strong> <span className="muted small">at {c?.name}</span>
                    <div className="small">
                      {formatMoney(o.wageCents)}/hr · {formatShift(occ.shift)}
                    </div>
                    <div className="muted small">Expires {formatDate(o.expiresAt)}</div>
                  </div>
                  <div className="row">
                    <button
                      className="btn small primary"
                      onClick={() => act({ type: "job.accept", offerId: o.id })}
                    >
                      Accept
                    </button>
                    <button
                      className="btn small"
                      onClick={() => act({ type: "job.decline", offerId: o.id })}
                    >
                      Decline
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <h4 className="no-margin">Skills</h4>
        <div className="skill-grid">
          {SKILLS.map((s) => {
            const xp = p.skills[s.id];
            const level = skillLevel(xp);
            const from = xpForLevel(level);
            const to = xpForLevel(level + 1);
            return (
              <Meter
                key={s.id}
                label={s.label}
                value={xp - from}
                max={to - from}
                display={`Lv ${level}`}
                tone="accent"
                compact
              />
            );
          })}
        </div>
        <p className="muted small">Skills grow with every hour you work.</p>
      </section>

      <section className="card">
        <h4 className="no-margin">Education</h4>
        <p className="small">{p.credentials.map((c) => CREDENTIAL_LABELS[c]).join(" · ")}</p>
        {p.education ? (
          (() => {
            const course = COURSES.find((c) => c.id === p.education!.courseId)!;
            return (
              <>
                <Meter
                  label={course.title}
                  value={p.education.progressHours}
                  max={course.hours}
                  display={`${p.education.progressHours}/${course.hours}h`}
                  tone="accent"
                />
                <div className="row">
                  <button
                    className="btn small"
                    onClick={() => act({ type: "activity.start", activityId: "study" })}
                  >
                    Study (3h)
                  </button>
                  <button className="btn small" onClick={() => act({ type: "education.drop" })}>
                    Drop course
                  </button>
                </div>
              </>
            );
          })()
        ) : (
          <ul className="course-list">
            {COURSES.filter((c) => !p.credentials.includes(c.id)).map((c) => {
              const blocked = courseBlocker(game, c.id);
              return (
                <li key={c.id} title={c.description}>
                  <div>
                    <strong>{c.title}</strong>
                    <div className="muted small">
                      {formatMoney(costs.tuitionCents(c.id), true)} · {c.hours} study hours ·{" "}
                      {c.description}
                    </div>
                  </div>
                  <button
                    className="btn small"
                    disabled={!!blocked}
                    title={blocked ?? undefined}
                    onClick={() => act({ type: "education.enroll", course: c.id })}
                  >
                    Enroll
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
