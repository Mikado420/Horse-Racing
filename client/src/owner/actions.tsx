// 報告の詳細と、報告から直接行える操作（方針変更・出走の検討・休養・分析・調教師への回答）
import { useState } from "react";
import { POLICY_DEFS, POLICY_IDS, shortWeekLabel, type HorsePolicy, type PolicyId } from "@owners/shared";
import { useOwner } from "./context";
import { BottomSheet } from "./feedback";
import { useToast } from "./feedback";
import { Icon } from "./icons";
import { ImportanceTag, trainerName } from "./ui";
import { REPORT_KIND_LABELS, stakesAhead, type ReportVM } from "./vm";

export function PolicyEditor({ horseId, compact }: { horseId: string; compact?: boolean }) {
  const { game, vm, save } = useOwner();
  const toast = useToast();
  const h = vm.horses.find((x) => x.view.id === horseId)?.view;
  if (!h) return <p className="muted">現役の馬ではありません。</p>;
  const set = (p: Partial<HorsePolicy>, msg: string) => {
    try {
      game.setPolicy(horseId, p);
      toast(msg, "good");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const stakes = stakesAhead(save);
  return (
    <div className="policy-editor">
      <div className={`policy-grid2 ${compact ? "is-compact" : ""}`} role="radiogroup" aria-label="育成方針">
        {POLICY_IDS.map((id) => (
          <button
            key={id}
            role="radio"
            aria-checked={h.policy.policy === id}
            className="policy-opt2"
            onClick={() => h.policy.policy !== id && set({ policy: id as PolicyId }, `方針を「${POLICY_DEFS[id].label}」にしました`)}
          >
            <span className="policy-name">
              {h.policy.policy === id && <Icon name="check" size={16} />}
              {POLICY_DEFS[id].label}
            </span>
            {!compact && <span className="policy-desc">{POLICY_DEFS[id].desc}</span>}
          </button>
        ))}
      </div>
      <div className="setting">
        <span className="setting-label">調教師の提案の扱い</span>
        <div className="seg2" role="radiogroup" aria-label="調教師の提案の扱い">
          <button role="radio" aria-checked={h.policy.mode === "follow"} onClick={() => set({ mode: "follow" }, "調教師の提案に従います")}>
            提案に従う
          </button>
          <button role="radio" aria-checked={h.policy.mode === "insist"} onClick={() => set({ mode: "insist" }, "方針を優先させます")}>
            方針を優先
          </button>
        </div>
        {h.policy.mode === "insist" && (
          <p className="hint2 warn-text">
            <Icon name="alert" size={14} /> 疲れていても方針どおりに調教します。故障のリスクが上がり、厩舎との関係も悪くなりがちです。
          </p>
        )}
      </div>
      <label className="setting">
        <span className="setting-label">目標レース</span>
        <select className="select2" value={h.policy.goalRaceId ?? ""} onChange={(e) => set({ goalRaceId: e.target.value || null }, e.target.value ? "目標レースを設定しました" : "目標レースを取り消しました")}>
          <option value="">設定しない</option>
          {stakes.map(({ program: p, weeksAway }) => (
            <option key={p.id} value={p.id}>
              {shortWeekLabel(p.week)}（あと{weeksAway}週） {p.name}・{p.course.surface === "turf" ? "芝" : "ダ"}
              {p.course.distance}m
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** 報告の詳細シート */
export function ReportSheet({ r, onClose }: { r: ReportVM; onClose: () => void }) {
  const { game, nav, save } = useOwner();
  const toast = useToast();
  const [mode, setMode] = useState<"detail" | "policy">("detail");
  const rep = r.report;
  const horse = save.horses.find((h) => h.id === rep.horseId);
  const active = horse?.status === "active";
  const lastRace = save.races.find((x) => x.horseId === rep.horseId);
  const go = (f: () => void) => {
    onClose();
    f();
  };
  const reply = (kind: "race" | "rest" | "keep") => {
    if (kind === "race") return go(() => nav.push({ tab: "race", horseId: rep.horseId }));
    try {
      if (kind === "rest") {
        game.setPolicy(rep.horseId, { policy: "recovery" });
        toast(`${rep.horseName}を休ませるよう伝えました`, "good");
      } else toast("今の方針で続けるよう伝えました", "good");
    } catch (e) {
      toast((e as Error).message, "error");
    }
    onClose();
  };

  return (
    <BottomSheet
      title={`${rep.horseName}の報告`}
      onClose={onClose}
      actions={
        mode === "detail" && active ? (
          <div className="sheet-action-grid">
            <button className="btn btn-ghost" onClick={() => setMode("policy")}>
              <Icon name="list" />
              方針を確認・変更
            </button>
            <button className="btn btn-ghost" onClick={() => go(() => nav.push({ tab: "horses", horseId: rep.horseId, detail: true, horseTab: "ability" }))}>
              <Icon name="spark" />
              能力の見立て
            </button>
            {lastRace && (
              <button className="btn btn-ghost" onClick={() => go(() => nav.push({ tab: "records", sub: "analysis", raceId: lastRace.raceId }))}>
                <Icon name="chart" />
                {lastRace.analyzed ? "前走の分析" : "前走を分析"}
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => go(() => nav.push({ tab: "race", horseId: rep.horseId }))}>
              <Icon name="race" />
              出走計画
            </button>
          </div>
        ) : mode === "policy" ? (
          <button className="btn btn-primary" onClick={() => setMode("detail")}>
            報告に戻る
          </button>
        ) : undefined
      }
    >
      {mode === "policy" ? (
        <PolicyEditor horseId={rep.horseId} />
      ) : (
        <div className="report-detail">
          <p className="report-detail-meta">
            <ImportanceTag level={r.importance} />
            <span>{REPORT_KIND_LABELS[r.kind]}</span>
            <span>{shortWeekLabel(rep.week)}の報告</span>
            <span>{trainerName(rep.trainerId)}調教師</span>
          </p>
          <p className="report-plan">
            <strong>今週の内容：</strong>
            {rep.planLabel}
          </p>
          {rep.lines
            .filter((l) => !l.startsWith("提案："))
            .map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          {rep.workout && (
            <p className="workout">
              <Icon name="clock" size={14} /> 調教時計 {rep.workout}
            </p>
          )}
          {rep.discoveries.map((d, i) => (
            <p key={i} className="discovery">
              <Icon name="spark" size={16} />
              {d}
            </p>
          ))}
          {rep.alerts.map((a, i) => (
            <p key={i} className="alert-line">
              <Icon name="alert" size={16} />
              {a}
            </p>
          ))}
          {r.proposal && (
            <div className="proposal">
              <p>
                <strong>調教師の提案：</strong>
                {r.proposal}
              </p>
              {r.needsReply && active ? (
                <div className="btn-row">
                  <button className="btn btn-primary" onClick={() => reply("race")}>
                    出走を検討する
                  </button>
                  <button className="btn btn-ghost" onClick={() => reply("rest")}>
                    今回は休ませる
                  </button>
                  <button className="btn btn-ghost" onClick={() => reply("keep")}>
                    方針どおり続ける
                  </button>
                </div>
              ) : (
                <p className="hint2">この提案への回答期限は過ぎました。</p>
              )}
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
