import { model, Schema } from 'mongoose';
export interface UserRecord { googleId:string; email:string; name:string; avatar?:string }
const schema=new Schema<UserRecord>({googleId:{type:String,required:true,unique:true},email:{type:String,required:true,unique:true},name:{type:String,required:true},avatar:String},{timestamps:true});
export const User=model<UserRecord>('User',schema);
