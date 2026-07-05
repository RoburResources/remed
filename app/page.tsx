export default function Home() {
  return (
    <main>
      <h1>Robur Autonomous Worker</h1>
      <p>
        Production routes are API-only and protected. Use <code>/api/admin/status</code> with the dashboard bearer token
        for operational status.
      </p>
      <p>External contact remains blocked until Supabase config and compliance ledger are explicitly enabled.</p>
    </main>
  );
}
