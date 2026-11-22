import { model, Schema, Types } from 'mongoose';
export interface FileSourceRecord { scan: Types.ObjectId; owner: Types.ObjectId; filePath: string; content: string }
const schema = new Schema<FileSourceRecord>({ scan:{type:Schema.Types.ObjectId,ref:'Scan',required:true,index:true}, owner:{type:Schema.Types.ObjectId,ref:'User',required:true,index:true}, filePath:{type:String,required:true}, content:{type:String,required:true} }, {timestamps:true});
schema.index({scan:1,filePath:1},{unique:true});
export const FileSource = model<FileSourceRecord>('FileSource',schema);
