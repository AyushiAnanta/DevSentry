import { Types } from 'mongoose';
import { Finding } from '../models/Finding';
import { FileRisk } from '../models/FileRisk';
import { FileSource } from '../models/FileSource';
import { Project } from '../models/Project';
import { Scan } from '../models/Scan';
export const listProjects=(owner:string)=>Project.find({owner}).sort({createdAt:-1});
export const createProject=(owner:string,data:{name:string;url:string})=>Project.create({owner,name:data.name,source:{type:'github',url:data.url}});
export async function getProject(owner:string,id:string){if(!Types.ObjectId.isValid(id))return null;return Project.findOne({_id:id,owner});}
export const updateProject=(owner:string,id:string,data:{name?:string;url?:string})=>Types.ObjectId.isValid(id)?Project.findOneAndUpdate({_id:id,owner},{...(data.name?{name:data.name}:{}),...(data.url?{'source.url':data.url}:{})},{new:true,runValidators:true}):null;
export async function deleteProject(owner:string,id:string):Promise<boolean>{if(!Types.ObjectId.isValid(id))return false;const project=await Project.findOne({_id:id,owner});if(!project)return false;const scans=await Scan.find({project:project._id,owner},{_id:1});const ids=scans.map(scan=>scan._id);await Promise.all([Finding.deleteMany({scan:{$in:ids},owner}),FileRisk.deleteMany({scan:{$in:ids},owner}),FileSource.deleteMany({scan:{$in:ids},owner})]);await Scan.deleteMany({project:project._id,owner});await project.deleteOne();return true;}
