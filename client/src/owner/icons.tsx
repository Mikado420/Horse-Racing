// 線画アイコン（24×24、currentColor）。アイコンは必ずラベルと一緒に使う
export type IconName =
  | "home"
  | "horse"
  | "stable"
  | "race"
  | "chart"
  | "bell"
  | "gear"
  | "close"
  | "back"
  | "next"
  | "alert"
  | "check"
  | "info"
  | "trophy"
  | "report"
  | "spark"
  | "clock"
  | "coin"
  | "save"
  | "cart"
  | "camera"
  | "list"
  | "play"
  | "sound"
  | "mute"
  | "up"
  | "down"
  | "flat";

const PATHS: Record<IconName, string> = {
  home: "M3 11 12 4l9 7M5 9.5V20h5v-6h4v6h5V9.5",
  horse: "M5 20v-6l-2-3 3-1 3-5 4 1 4 3 2 4-2 1-2-2-2 1v7M9 20v-5",
  stable: "M3 10 12 4l9 6v10H3zM8 20v-6h8v6M8 14l8 6M16 14l-8 6",
  race: "M5 21V4M5 4h11l-2 3.5L16 11H5",
  chart: "M4 20V4M4 20h16M8 16l3-4 3 2 5-7",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0",
  gear: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1",
  close: "M6 6l12 12M18 6 6 18",
  back: "M15 5l-7 7 7 7",
  next: "M9 5l7 7-7 7",
  alert: "M12 3 2 20h20zM12 10v4M12 17v.5",
  check: "M4 12.5 9.5 18 20 6",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5V8",
  trophy: "M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8",
  report: "M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h4",
  spark: "M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  coin: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 9.5c0-1.4 1.3-2 3-2s3 .7 3 2-1.3 1.8-3 2.3-3 1-3 2.3 1.3 2 3 2 3-.6 3-2M12 5.5v2M12 16.5v2",
  save: "M5 3h11l3 3v15H5zM8 3v5h8V3M8 21v-7h8v7",
  cart: "M3 4h2l2.5 11h10L20 7H6.5M9 20a1 1 0 1 0 0-.01M17 20a1 1 0 1 0 0-.01",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  play: "M7 4v16l13-8z",
  sound: "M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11",
  mute: "M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  flat: "M5 12h14M13 6l6 6-6 6",
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
