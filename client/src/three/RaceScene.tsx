// レース観戦の3D表示（React の部品）。中身は three.js で直接描く RaceWorld。
// 馬と騎手の形は最初の1回だけ作る（Web Worker で裏で作るので、画面は止まらない）。
import { useEffect, useRef, useState } from "react";
import type { RaceStartMsg } from "@owners/shared";
import { assetsReady, loadAssets } from "./model/assets";
import { RaceWorld, type CameraMode } from "./world";

export type { CameraMode };

interface Props {
  race: RaceStartMsg;
  serverNow: () => number;
  camera: CameraMode;
  highlight: number;
  /** 描画品質（low は影なし・等倍解像度・細かさ控えめで軽くする） */
  quality?: "high" | "low";
}

export function RaceScene({ race, serverNow, camera, highlight, quality = "high" }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const world = useRef<RaceWorld | null>(null);
  const nowRef = useRef(serverNow);
  nowRef.current = serverNow;
  const [ready, setReady] = useState(assetsReady());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready) return;
    let alive = true;
    void loadAssets().then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [ready]);

  // 世界を作る（レースや品質が変わったときだけ作り直す）
  useEffect(() => {
    if (!ready || !box.current) return;
    let w: RaceWorld;
    try {
      w = new RaceWorld(box.current, race, () => nowRef.current(), quality);
    } catch (e) {
      setError((e as Error).message || "3D表示を開始できませんでした");
      return;
    }
    world.current = w;
    w.setCamera(camera);
    w.setHighlight(highlight);
    return () => {
      w.dispose();
      world.current = null;
    };
  }, [ready, race.raceId, quality]); // eslint-disable-line react-hooks/exhaustive-deps

  // 再生速度の変更・スキップ（開始時刻が変わる）
  const startAt = useRef(race.startAt);
  useEffect(() => {
    const w = world.current;
    if (!w) return;
    w.setRace(race);
    if (race.startAt !== startAt.current) {
      // スキップなどで再生位置が大きく飛んだら、カメラも一気に合わせる
      const jump = Math.abs(race.startAt - startAt.current) > 2000;
      startAt.current = race.startAt;
      if (jump) w.snapCamera();
    }
  }, [race]);
  useEffect(() => world.current?.setCamera(camera), [camera]);
  useEffect(() => world.current?.setHighlight(highlight), [highlight]);

  return (
    <div className="race-scene" ref={box}>
      {!ready && !error && (
        <div className="race-scene-note" role="status">
          <span className="spinner sm" aria-hidden />
          競馬場を準備しています…
        </div>
      )}
      {error && (
        <div className="race-scene-note" role="alert">
          3D表示を開始できませんでした（{error}）。順位と残り距離は画面の表示で確認できます。
        </div>
      )}
    </div>
  );
}
