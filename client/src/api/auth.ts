import { api } from './client';
export interface User {id:string;name:string;email:string;avatar?:string}
export async function getMe():Promise<User>{return (await api.get<User>('/auth/me')).data;}
export async function logout():Promise<void>{await api.post('/auth/logout');}
