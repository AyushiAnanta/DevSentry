import {useQuery} from '@tanstack/react-query';
import {getScan} from './api';
export function useScan(id:string){return useQuery({queryKey:['scan',id],queryFn:()=>getScan(id),enabled:Boolean(id),refetchInterval:query=>{const status=query.state.data?.status;return status==='done'||status==='failed'?false:2500;}});}
