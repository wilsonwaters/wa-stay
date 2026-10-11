import { ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { Button, PageHeader } from '../components/ui';
import { ROUTES } from './routes';

/** Any address the route table does not know, and the routes reserved for later tasks. */
export function NotFoundPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8 lg:px-8">
      <PageHeader
        title="Page not found"
        description={
          <>
            Nothing in WA Stay lives at <span className="font-semibold text-fg">{pathname}</span>.
            The link may be out of date, or the page may have moved.
          </>
        }
      />
      <Button
        className="mt-6"
        leadingIcon={<ArrowLeft size={18} />}
        onClick={() => navigate(ROUTES.explore())}
      >
        Back to Explore
      </Button>
    </div>
  );
}

export default NotFoundPage;
