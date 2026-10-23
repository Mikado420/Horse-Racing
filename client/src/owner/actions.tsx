// 報告の詳細と、報告から直接行える操作（方針変更・出走の検討・休養・分析・調教師への回答）
import { useState } from "react";
import { POLICY_DEFS, POLICY_IDS, shortWeekLabel, type HorsePolicy, type PolicyId } from "@owners/shared";
import { useOwner } from "./context";
import { BottomSheet } from "./feedback";
import { useToast } from "./feedback";
import { Icon } from "./icons";
import { ImportanceTag, trainerName } from "./ui";
import { REPORT_KIND_LABELS, planPreview, stakesAhead, type ReportVM } from "./vm";

/**
 * 育成方針（調教の依頼）の変更。選ぶ → 見込みを確かめる → 依頼する、の順で、選んだだけでは確定しない。
 * 見込みはゲームの規則（調教師が今週どう組むか）から出し、効果の数値は予測しない
 */
export function PolicyEditor({ horseId, compact, onDone }: { horseId: string; compact?: boolean; onDone?: () => void }) {
  const { game, vm, save } = useOwner();
  const toast = useToast();
  const h = vm.horses.find((x) => x.view.id === horseId)?.view;
  const [draft, setDraft] = useState<HorsePolicy | null>(null);
  if (!h) return <p className="muted">現役の馬ではありません。</p>;
  const cur = h.policy;
  const d = draft ?? cur;
  const changed = d.policy !== cur.policy || d.mode !== cur.mode || d.goalRaceId !== cur.goalRaceId;
  const preview = planPreview(save, horseId, d);
  const stakes = stakesAhead(save);
  const goalName = (id: string | null) => (id ? stakes.find((x) => x.program.id === id)?.program.name ?? "設定中のレース" : "なし");
  const apply = () => {
    try {
      game.setPolicy(horseId, { policy: d.policy, mode: d.mode, goalRaceId: d.goalRaceId });
      toast(`${h.name}の調教方針を更新しました`, "good");
      setDraft(null);
      onDone?.();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  return (
    <div className="policy-editor">
      <h3 className="step-title">
        <span className="step-no">1</span>方針を選ぶ
      </h3>
      <div className={`policy-grid2 ${compact ? "is-compact" : ""}`} role="radiogroup" aria-label="育成方針">
        {POLICY_IDS.map((id) => (
          <button key={id} role="radio" aria-checked={d.policy === id} className="policy-opt2" onClick={() => setDraft({ ...d, policy: id as PolicyId })}>
            <span className="policy-name">
              {d.policy === id && <Icon name="check" size={16} />}
              {POLICY_DEFS[id].label}
              {cur.policy === id && <small className="policy-now">現在</small>}
            </span>
            {!compact && <span className="policy-desc">{POLICY_DEFS[id].desc}</span>}
          </button>
        ))}
      </div>
      <div className="setting">
        <span className="setting-label">調教師の提案の扱い</span>
        <div className="seg2" role="radiogroup" aria-label="調教師の提案の扱い">
          <button role="radio" aria-checked={d.mode === "follow"} onClick={() => setDraft({ ...d, mode: "follow" })}>
            提案に従う
          </button>
          <button role="radio" aria-checked={d.mode === "insist"} onClick={() => setDraft({ ...d, mode: "insist" })}>
            方針を優先
          </button>
        </div>
      </div>
      <label className="setting">
        <span className="setting-label">目標レース</span>
        <select className="select2" value={d.goalRaceId ?? ""} onChange={(e) => setDraft({ ...d, goalRaceId: e.target.value || null })}>
          <option value="">設定しない</option>
          {stakes.map(({ program: p, weeksAway }) => (
            <option key={p.id} value={p.id}>
              {shortWeekLabel(p.week)}（あと{weeksAway}週） {p.name}・{p.course.surface === "turf" ? "芝" : "ダ"}
              {p.course.distance}m
            </option>
          ))}
        </select>
      </label>

      <h3 className="step-title">
        <span className="step-no">2</span>内容を確かめて依頼する
      </h3>
      <div className="policy-confirm" aria-live="polite">
        <dl className="facts compact">
          <div>
            <dt>育成方針</dt>
            <dd>
              {POLICY_DEFS[cur.policy].label}
              {d.policy !== cur.policy && <> → <strong>{POLICY_DEFS[d.policy].label}</strong></>}
            </dd>
          </div>
          <div>
            <dt>提案の扱い</dt>
            <dd>
              {cur.mode === "follow" ? "提案に従う" : "方針を優先"}
              {d.mode !== cur.mode && <> → <strong>{d.mode === "follow" ? "提案に従う" : "方針を優先"}</strong></>}
            </dd>
          </div>
          <div>
            <dt>目標レース</dt>
            <dd>
              {goalName(cur.goalRaceId)}
              {d.goalRaceId !== cur.goalRaceId && <> → <strong>{goalName(d.goalRaceId)}</strong></>}
            </dd>
          </div>
          {preview && (
            <div>
              <dt>今週の調教の見込み</dt>
              <dd>
                {preview.label}（{preview.reason}）
              </dd>
            </div>
          )}
        </dl>
        {preview?.adjusted && <p className="hint2">今の馬の状態では、調教師は方針と違う軽めの内容にする見込みです。</p>}
        {(preview?.overridden || d.mode === "insist") && (
          <p className="hint2 warn-text">
            <Icon name="alert" size={14} /> 方針を優先すると、疲れていても方針どおりに調教します。故障のリスクが上がり、厩舎との関係も悪くなりがちです。
          </p>
        )}
        <div className="policy-actions">
          {changed && (
            <button className="btn btn-ghost" onClick={() => setDraft(null)}>
              元に戻す
            </button>
          )}
          <button className="btn btn-primary" disabled={!changed} onClick={apply}>
            この内容で調教を依頼する
          </button>
        </div>
        {!changed && <p className="hint2">変更はまだありません。上で方針を選ぶと、ここで確かめてから依頼できます。</p>}
      </div>
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
