import { Area,AreaChart,ResponsiveContainer,XAxis } from 'recharts';
const previewData=[{day:'Mon',score:47},{day:'Tue',score:40},{day:'Wed',score:52},{day:'Thu',score:32},{day:'Fri',score:38},{day:'Sat',score:24},{day:'Sun',score:24}];
export function RiskPreviewChart(){return <ResponsiveContainer width="100%" height="100%"><AreaChart data={previewData}><Area type="monotone" dataKey="score" stroke="#69d3b0" fill="#69d3b020" strokeWidth={2}/><XAxis dataKey="day" hide/></AreaChart></ResponsiveContainer>;}
