import { useNavigate } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Card, EmptyState, Button } from '../components/ui';

export default function NotFound() {
  const nav = useNavigate();
  return <Card className="mx-auto mt-10 max-w-lg"><EmptyState icon={Compass} title="Page not found" message="This route does not exist in QuantumShift." action={<Button variant="primary" onClick={() => nav('/')}>Back to home</Button>} /></Card>;
}
