import { api } from './client';
export interface Project { _id:string;name:string;source:{type:'github';url:string};createdAt:string }
export async function listProjects():Promise<Project[]>{return (await api.get<Project[]>('/projects')).data;}
export async function createProject(name:string,url:string):Promise<Project>{return (await api.post<Project>('/projects',{name,url})).data;}
export async function deleteProject(id:string):Promise<void>{await api.delete(`/projects/${id}`);}
export async function getProject(id:string):Promise<Project>{return (await api.get<Project>(`/projects/${id}`)).data;}
