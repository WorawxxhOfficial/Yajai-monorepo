import { ExplodedView } from './exploded/ExplodedView';

export function App() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="mark" aria-hidden="true">ยใ</div>
        <div className="titles">
          <h1>เครื่องจ่ายยา “ยาใจ” · มุมมองแยกชิ้นส่วน</h1>
          <p>หมุนดูตัวเครื่อง แยกชิ้นส่วนออกมาดูทีละชั้น และลองกดจ่ายยาเพื่อดูว่ายาเดินทางไปที่ไหน</p>
        </div>
        <span className="size-chip">ขนาดจริง 220 × 220 × 150 mm</span>
      </header>
      <ExplodedView />
      <footer className="foot">
        ยาใจ · Get to Know the Project · ขนาดและชิ้นส่วนอ้างอิงจากเอกสารเสนอโครงงาน v1.0 (ภาพเป็นแบบจำลอง ไม่ใช่แบบสำหรับตัดจริง)
      </footer>
    </div>
  );
}
