import { Link } from "react-router";
import { PageShell } from "../components/PageShell";

export default function NotFound() {
  return (
    <PageShell width="narrow">
      <div className="text-center">
        <h1 className="text-foreground mb-4 text-4xl font-bold">404</h1>
        <p className="text-muted-foreground mb-8 text-lg">Page not found</p>
        <Link
          to="/"
          className="bg-primary text-primary-foreground hover:bg-primary/90 inline-block rounded-md px-4 py-2 transition-colors"
        >
          Go to Home
        </Link>
      </div>
    </PageShell>
  );
}
