import { useEffect, useRef, useState } from 'react';
import { DeviceScene } from './DeviceScene';
import { PARTS, PART_BY_ID, ROLE_NAMES, type PartId, type Role } from './parts';

export function ExplodedView() {
  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<DeviceScene | null>(null);
  const [explode, setExplode] = useState(0);
  const [xray, setXray] = useState(false);
  const [spin, setSpin] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<PartId | null>(null);

  useEffect(() => {
    const host = stageRef.current;
    if (!host) return;
    const scene = new DeviceScene(host, {
      onExplode: setExplode,
      onXray: setXray,
      onSpin: setSpin,
      onBusy: setBusy,
      onStatus: setStatus,
      onSelect: setSelected,
    });
    sceneRef.current = scene;
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __yajai?: DeviceScene }).__yajai = scene;
    // open with a gentle reveal so the first view already shows the layers
    const t = window.setTimeout(() => {
      if (scene.reducedMotion) scene.setExplode(1);
      else void scene.animateExplode(1);
    }, 900);
    return () => {
      window.clearTimeout(t);
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  const s = () => sceneRef.current;
  const part = selected ? PART_BY_ID[selected] : null;
  const exploded = explode > 0.5;

  return (
    <main className="layout">
      <section className="stage-col" aria-label="ตัวเครื่องแบบ 3 มิติ">
        <div className="stage" ref={stageRef}>
          <p className="hint">ลากเพื่อหมุน · ล้อเมาส์หรือสองนิ้วเพื่อซูม · คลิกชิ้นส่วนเพื่ออ่านคำอธิบาย</p>
          <div className={`status${status ? ' on' : ''}`} role="status" aria-live="polite">{status}</div>
        </div>

        <div className="controls">
          <button
            type="button"
            className="btn primary"
            aria-pressed={exploded}
            disabled={busy}
            onClick={() => void s()?.animateExplode(exploded ? 0 : 1)}
          >
            {exploded ? 'ประกอบกลับ' : 'แยกชิ้นส่วน'}
          </button>
          <div className="slider">
            <label htmlFor="explode-range">ประกอบ</label>
            <input
              id="explode-range"
              type="range"
              min={0}
              max={100}
              value={Math.round(explode * 100)}
              disabled={busy}
              onChange={(e) => s()?.setExplode(Number(e.target.value) / 100)}
            />
            <span aria-hidden="true">แยก</span>
          </div>
          <span className="sep" aria-hidden="true" />
          <button type="button" className="btn" aria-pressed={xray} onClick={() => s()?.setXray(!xray)}>มองทะลุ</button>
          <button type="button" className="btn warm" disabled={busy} onClick={() => void s()?.runRound(true)}>▶ ลองจ่ายยา</button>
          <button type="button" className="btn" disabled={busy} onClick={() => void s()?.runRound(false)}>ข้ามรอบ</button>
          <button type="button" className="btn" aria-pressed={spin} onClick={() => s()?.setSpin(!spin)}>หมุนเอง</button>
        </div>
      </section>

      <aside className="guide" aria-label="รายการชิ้นส่วน">
        <h2>ชิ้นส่วนทั้งหมด {PARTS.length} ชิ้น</h2>
        <div className="plist">
          {PARTS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={selected === p.id}
              onClick={() => s()?.select(selected === p.id ? null : p.id)}
            >
              <span className="n">{p.n}</span>
              <span>{p.name}</span>
            </button>
          ))}
        </div>

        {part ? (
          <div className="detail">
            <h3>{part.n} · {part.name}</h3>
            <p>{part.desc}</p>
            <ul>{part.specs.map((x) => <li key={x}>{x}</li>)}</ul>
            <div className="chips">
              <span className="chip">{part.tier}</span>
              {part.roles.map((r) => <span key={r} className="chip role">บทบาท {r}</span>)}
            </div>
          </div>
        ) : (
          <div className="detail empty">
            <p>เลือกชิ้นส่วนจากรายการ หรือคลิกที่ตัวเครื่องหรือหมุดตัวเลข เพื่อดูว่าชิ้นนั้นทำหน้าที่อะไร ใช้ในรุ่นไหน และใครในทีมเป็นคนรับผิดชอบ</p>
          </div>
        )}

        <div className="legend">
          {(Object.keys(ROLE_NAMES) as unknown as Role[]).map((r) => (
            <span key={r}>บทบาท {r} = {ROLE_NAMES[r]}</span>
          ))}
        </div>
      </aside>
    </main>
  );
}
