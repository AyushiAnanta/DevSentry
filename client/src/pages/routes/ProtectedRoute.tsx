import { Navigate,Outlet } from 'react-router-dom';import { useAuth } from '../../hooks/useAuth';
export function ProtectedRoute(){const auth=useAuth();if(auth.isLoading)return <div className="loading">Checking your session…</div>;return auth.data?<Outlet/>:<Navigate to="/" replace/>;}
