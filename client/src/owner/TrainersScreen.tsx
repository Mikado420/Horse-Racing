// 厩舎（調教師）の一覧。公開されているのは経歴・得意分野・預託料・紹介文だけで、
// 腕や目利きの数値は見えない。預けた馬の見立てと実戦の結果を比べて、自分で見極める。
import { TRAINERS, activeHorses, analysisPlan, racesOf, toHorseView } from "@owners/shared";
import { yen } from "../format";
import type { OwnerGame } from "../offline/useOwnerGame";
import type { OScreen } from "./OwnerApp";

export function TrainersScreen({ game, go }: { game: OwnerGame; go: (s: OScreen) => void }) {
  const save = game.save!;
  const horses = activeHorses(save);
  return (
    <div className="page">
      <h1 className="page-title">厩舎</h1>
      <p className="lead">
        調教師ごとに「調教の腕」と「馬を見る目」は違い、得意・不得意もあります。どれも数値では公開されていません。
        預けた馬の報告と、実戦の結果や自分の分析を比べて、信頼できる厩舎を見極めましょう。
      </p>
      <div className="trainer-cards">
        {TRAINERS.map((t) => {
          const mine = horses.filter((h) => h.trainerId === t.id);
          const raced = save.races.filter((r) => r.trainerId === t.id);
          const wins = raced.filter((r) => r.position === 1).length;
          return (
            <article key={t.id} className="trainer-card">
              <h2>{t.name}</h2>
              <p className="muted">
                開業{t.experience}年 ・ 得意：{t.specialties.note} ・ 預託料 {yen(t.weeklyFee)}／週
              </p>
              <p>{t.profile}</p>
              <p className="small">
                あなたの馬での実績：{raced.length}戦{wins}勝
                {raced.length > 0 && <span className="muted">（{analysisCount(save, t.id)}レース分析済み）</span>}
              </p>
              {mine.length > 0 ? (
                <ul className="trainer-horses">
                  {mine.map((h) => {
                    const v = toHorseView(h, save.week);
                    return (
                      <li key={h.id}>
                        <button className="link" onClick={() => go({ name: "horse", horseId: h.id })}>
                          {h.name}
                        </button>
                        <span className="muted small">
                          {v.age}歳 ・ 関係 {Math.round(h.relationship)} ・ {racesOf(save, h.id).length}戦
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="muted small">預けている馬はいません。</p>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function analysisCount(save: NonNullable<OwnerGame["save"]>, trainerId: string): number {
  return save.races.filter((r) => r.trainerId === trainerId && r.analyzed && analysisPlan(r).length > 0).length;
}
