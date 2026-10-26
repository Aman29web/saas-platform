import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-slate-50">
      <h1 className="text-2xl font-semibold text-slate-900">404</h1>
      <p className="text-sm text-slate-500">Page not found.</p>
      <Link to="/" className="text-sm font-medium text-slate-900 underline-offset-2 hover:underline">
        Back home
      </Link>
    </div>
  );
}
