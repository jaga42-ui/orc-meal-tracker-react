import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import * as XLSX from "xlsx";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";

export default function App() {
  const [meal, setMeal] = useState("breakfast");
  const [validIDs, setValidIDs] = useState(new Set());
  const [status, setStatus] = useState("Upload Excel");
  const [message, setMessage] = useState("");

  const scannerRef = useRef(null);
  const processing = useRef(false);

  /* ---------- HELPERS ---------- */
  const today = () => new Date().toISOString().split("T")[0];
  const timeNow = () => new Date().toLocaleTimeString();
  const normalize = v => String(v || "").replace(/\s+/g, "").toUpperCase();

  /* ---------- EXCEL ---------- */
  const handleExcel = e => {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = ev => {
      const wb = XLSX.read(new Uint8Array(ev.target.result), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet);

      const ids = new Set();
      rows.forEach(r => ids.add(normalize(Object.values(r)[0])));
      setValidIDs(ids);
      setStatus(`Loaded ${ids.size} IDs`);
    };
    reader.readAsArrayBuffer(file);
  };

  /* ---------- QR ---------- */
  const extractId = text => {
    const clean = normalize(text);
    if (validIDs.has(clean)) return clean;
    for (const id of validIDs) if (clean.includes(id)) return id;
    return null;
  };

  const startScanner = async () => {
    if (!validIDs.size) return;

    if (!scannerRef.current)
      scannerRef.current = new Html5Qrcode("reader");

    const cams = await Html5Qrcode.getCameras();
    const cam =
      cams.find(c => c.label.toLowerCase().includes("back")) || cams[0];

    await scannerRef.current.start(
      cam.id,
      { fps: 10, qrbox: 280 },
      async text => {
        if (processing.current) return;
        processing.current = true;

        await scannerRef.current.stop();

        const id = extractId(text);
        if (!id) {
          setMessage("Invalid QR");
          processing.current = false;
          return startScanner();
        }

        const ref = doc(db, "meal_records", id);
        const snap = await getDoc(ref);

        const keyDate = `${meal}_date`;
        const keyTime = `${meal}_time`;

        if (snap.exists() && snap.data().meals?.[keyDate] === today()) {
          setMessage("Already Taken");
        } else {
          await setDoc(
            ref,
            {
              id,
              meals: {
                ...(snap.exists() ? snap.data().meals : {}),
                [keyDate]: today(),
                [keyTime]: timeNow()
              },
              lastUpdate: new Date()
            },
            { merge: true }
          );
          setMessage("Allowed");
          navigator.vibrate?.(100);
        }

        processing.current = false;
        startScanner();
      }
    );
  };

  /* ---------- UI ---------- */
  return (
    <div style={{ padding: 20 }}>
      <h2>ORC Meal Tracker (React)</h2>

      <input type="file" accept=".xlsx" onChange={handleExcel} />

      <div style={{ marginTop: 10 }}>
        <button onClick={() => setMeal("breakfast")}>Breakfast</button>
        <button onClick={() => setMeal("lunch")}>Lunch</button>
        <button onClick={() => setMeal("dinner")}>Dinner</button>
      </div>

      <div style={{ marginTop: 10 }}>
        <button onClick={startScanner}>Start Scan</button>
      </div>

      <div id="reader" style={{ width: 300, marginTop: 20 }} />

      <p>{status}</p>
      <h3>{message}</h3>
    </div>
  );
}
