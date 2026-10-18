// 共通の小さな部品
import type { ReactNode } from "react";
import { gateColor } from "./format";

/** 馬番のゼッケン。画面全体で馬を識別する目印として一貫して使う */
export function SaddleCloth({ gate, size = "md" }: { gate: number; size?: "sm" | "md" | "lg" }) {
  const c = gateColor(gate);
  return (
    <span className={`cloth cloth-${size}`} style={{ background: c.bg, color: c.fg }} aria-label={`${gate}番`}>
      {gate}
    </span>
  );
}

export function StatBar({ label, value, cap }: { label: string; value: number; cap: number }) {
  const max = 130;
  return (
    <div className="statbar">
      <span className="statbar-label">{label}</span>
      <span className="statbar-track" aria-hidden>
        <span className="statbar-cap" style={{ width: `${(cap / max) * 100}%` }} />
        <span className="statbar-fill" style={{ width: `${(value / max) * 100}%` }} />
      </span>
      <span className="statbar-value">
        {value}
        <small>/{cap}</small>
      </span>
    </div>
  );
}

export function Gauge({ value, danger = 80 }: { value: number; danger?: number }) {
  const level = value >= danger ? "danger" : value >= 50 ? "warn" : "ok";
  return (
    <span className={`gauge gauge-${level}`} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${value}%` }} />
    </span>
  );
}

export function Notice({ kind = "info", children }: { kind?: "info" | "error" | "good"; children: ReactNode }) {
  return <p className={`notice notice-${kind}`} role={kind === "error" ? "alert" : "status"}>{children}</p>;
}
