import { model, Schema, Types } from 'mongoose';
export interface ProjectRecord { owner:Types.ObjectId; name:string; source:{type:'github';url:string} }
const schema=new Schema<ProjectRecord>({owner:{type:Schema.Types.ObjectId,ref:'User',required:true,index:true},name:{type:String,required:true,trim:true},source:{type:{type:String,enum:['github'],required:true},url:{type:String,required:true}}},{timestamps:true});
export const Project=model<ProjectRecord>('Project',schema);
