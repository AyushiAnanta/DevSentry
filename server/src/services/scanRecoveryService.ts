import { Scan } from '../models/Scan';
export async function markInterruptedScansFailed():Promise<number>{const result=await Scan.updateMany({status:{$in:['queued','running']}},{$set:{status:'failed',stage:null,error:'interrupted by restart',finishedAt:new Date()}});return result.modifiedCount;}
