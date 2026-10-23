import { useState } from "react";
import { useGameUi } from "../game/GameContext";
import { updateSettings, useSettings } from "../storage/settings";

type Tab =
  "life" | "work" | "business" | "people" | "politics" | "law" | "money" | "home" | "region";

interface Step {
  title: string;
  body: string;
  tab?: Tab;
}

function steps(homeless: boolean): Step[] {
  return [
    {
      title: "Welcome to your new life",
      body: homeless
        ? "You're 18, broke and homeless. Get an address, find work, and save for a place of your own."
        : "You're 18 and living in your parents' basement. They expect you to start working or studying soon.",
    },
    {
      title: "Your living standard",
      body: "Food, clothes and the basics come out of your money every day. Choose how well you live in the Life tab: living better costs more, but keeps you healthier, happier and more presentable to employers.",
      tab: "life",
    },
    {
      title: "Doing things",
      body: "Pick an activity in the Life tab and time moves forward while you do it. The game pauses when you're done (you can change that in Settings).",
      tab: "life",
    },
    {
      title: homeless ? "Getting off the street" : "Finding work",
      body: homeless
        ? "Shelters give you a safer bed and an address for job applications, if there's space. Day labor, cans and panhandling bring in the first dollars."
        : "Look for work once a day. Offers appear in the Work tab. Once hired, you'll head to work automatically when shifts start.",
      tab: homeless ? "home" : "work",
    },
    {
      title: "Time controls",
      body: "Space pauses and resumes. Keys 1, 2 and 3 change speed. Esc opens the menu to save your game.",
    },
  ];
}

/** A short first-game walkthrough. Dismissed for good once finished or skipped. */
export function Tutorial({ onTab }: { onTab(tab: Tab): void }) {
  const { game } = useGameUi();
  const { tutorialDone } = useSettings();
  const [index, setIndex] = useState(0);
  if (tutorialDone) return null;
  const list = steps(game.state.player.housing.kind === "homeless");
  const step = list[index]!;
  const last = index === list.length - 1;
  const go = (i: number) => {
    setIndex(i);
    const tab = list[i]?.tab;
    if (tab) onTab(tab);
  };
  return (
    <aside className="tutorial" aria-label="Tutorial">
      <div className="muted small">
        Tip {index + 1} of {list.length}
      </div>
      <strong>{step.title}</strong>
      <p className="small">{step.body}</p>
      <div className="row">
        <button className="btn small" onClick={() => updateSettings({ tutorialDone: true })}>
          Skip
        </button>
        {index > 0 && (
          <button className="btn small" onClick={() => go(index - 1)}>
            Back
          </button>
        )}
        <button
          className="btn small primary"
          onClick={() => (last ? updateSettings({ tutorialDone: true }) : go(index + 1))}
        >
          {last ? "Got it" : "Next"}
        </button>
      </div>
    </aside>
  );
}
