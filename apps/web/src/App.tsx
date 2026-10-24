import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";

interface HealthResponse {
  status: string;
  mongo: string;
  timestamp: string;
}

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<HealthResponse>("/api/health")
      .then((res) => setHealth(res.data))
      .catch(() => setError("API unreachable"));
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">SaaS Platform</h1>
        <p className="mt-2 text-sm text-slate-500">Module A scaffold</p>
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        {health && (
          <pre className="mt-4 rounded bg-slate-100 p-3 text-xs text-slate-700">
            {JSON.stringify(health, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
