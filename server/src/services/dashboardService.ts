import { Project } from '../models/Project';
import { Scan } from '../models/Scan';
export async function getDashboard(owner:string) {
  const [projectCount,scanCount,doneScans,recentScans,trend]=await Promise.all([
    Project.countDocuments({owner}),Scan.countDocuments({owner}),
    Scan.find({owner,status:'done'}).sort({finishedAt:-1}).limit(20).select('summary.riskScore').lean(),
    Scan.find({owner}).sort({createdAt:-1}).limit(5).populate('project','name').lean(),
    Scan.find({owner,status:'done'}).sort({finishedAt:-1}).limit(20).select('summary.riskScore finishedAt createdAt').lean(),
  ]);
  const averageRisk=doneScans.length?doneScans.reduce((sum,scan)=>sum+(scan.summary?.riskScore??0),0)/doneScans.length:0;
  return {projectCount,scanCount,averageRisk,recentScans,riskTrend:trend.reverse().map(scan=>({date:scan.finishedAt??scan.createdAt,riskScore:scan.summary?.riskScore??0}))};
}
