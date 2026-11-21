import { model, Schema, Types } from 'mongoose';
export interface FindingRecord { scan:Types.ObjectId; owner:Types.ObjectId; filePath:string; line:number; severity:string; category:string; message:string; suggestion?:string; riskScore:number }
const schema=new Schema<FindingRecord>({scan:{type:Schema.Types.ObjectId,ref:'Scan',required:true,index:true},owner:{type:Schema.Types.ObjectId,ref:'User',required:true,index:true},filePath:{type:String,required:true},line:{type:Number,required:true},severity:{type:String,required:true},category:{type:String,required:true},message:{type:String,required:true},suggestion:String,riskScore:{type:Number,required:true}},{timestamps:true});
export const Finding=model<FindingRecord>('Finding',schema);
