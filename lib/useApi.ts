"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "./format";

// GET 데이터를 불러오고, reload() 로 다시 불러오는 공용 훅
export function useApi<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    api<T>(url)
      .then((d) => { if (alive) { setData(d); setError(""); } })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : "불러오기 실패"); });
    return () => { alive = false; };
  }, [url, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, reload };
}
